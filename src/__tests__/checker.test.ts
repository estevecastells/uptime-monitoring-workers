import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations, resetDB, insertMonitor } from './setup';
import { insertCheck, getOpenIncident, getLastNChecks } from '../db/queries';
import { runChecks, recheckDown } from '../cron/checker';

const testEnv = env as unknown as import('../types').Env;

// Mock fetch to avoid real HTTP requests
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  await resetDB();
  // Reset fetch mock
  globalThis.fetch = originalFetch;
});

describe('runChecks', () => {
  it('checks all active monitors and stores results', async () => {
    const id = await insertMonitor(env.DB, 'https://mock-ok.test', 'Mock OK');

    // Mock fetch to return 200
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('OK', { status: 200 })
    );

    await runChecks(testEnv);

    const checks = await getLastNChecks(testEnv, id, 1);
    expect(checks).toHaveLength(1);
    expect(checks[0].is_up).toBe(1);
    expect(checks[0].status_code).toBe(200);
  });

  it('records failure when fetch throws', async () => {
    const id = await insertMonitor(env.DB, 'https://mock-fail.test', 'Mock Fail');

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    await runChecks(testEnv);

    const checks = await getLastNChecks(testEnv, id, 1);
    expect(checks).toHaveLength(1);
    expect(checks[0].is_up).toBe(0);
    expect(checks[0].error).toBe('Connection refused');
  });

  it('marks non-2xx/3xx as down', async () => {
    const id = await insertMonitor(env.DB, 'https://mock-500.test', 'Mock 500');

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Error', { status: 500 })
    );

    await runChecks(testEnv);

    const checks = await getLastNChecks(testEnv, id, 1);
    expect(checks[0].is_up).toBe(0);
    expect(checks[0].error).toBe('HTTP 500');
  });

  it('skips inactive monitors', async () => {
    const id = await insertMonitor(env.DB, 'https://paused.test', 'Paused');
    await env.DB.prepare('UPDATE monitors SET is_active = 0 WHERE id = ?').bind(id).run();

    globalThis.fetch = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));

    await runChecks(testEnv);

    const checks = await getLastNChecks(testEnv, id, 1);
    expect(checks).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('recheckDown', () => {
  it('only rechecks monitors whose last check was down', async () => {
    const upId = await insertMonitor(env.DB, 'https://up.test', 'Up');
    const downId = await insertMonitor(env.DB, 'https://down.test', 'Down');

    await insertCheck(testEnv, upId, 200, 100, true, null);
    await insertCheck(testEnv, downId, 0, null, false, 'timeout');

    globalThis.fetch = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));

    await recheckDown(testEnv);

    // Only the down monitor should have been rechecked
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe('https://down.test');
  });
});

describe('Incident logic', () => {
  it('creates incident after 2 consecutive failures', async () => {
    const id = await insertMonitor(env.DB, 'https://flaky.test', 'Flaky');

    // Mock notifications to avoid real API calls
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', { status: 500 })
    );

    // First failure — no incident yet
    await runChecks(testEnv);
    let incident = await getOpenIncident(testEnv, id);
    expect(incident).toBeNull();

    // Second consecutive failure — incident created
    await runChecks(testEnv);
    incident = await getOpenIncident(testEnv, id);
    expect(incident).not.toBeNull();
    expect(incident!.notified_down).toBe(1);
  });

  it('resolves incident when monitor recovers', async () => {
    const id = await insertMonitor(env.DB, 'https://recover.test', 'Recover');

    // Two failures to trigger incident
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    await runChecks(testEnv);
    await runChecks(testEnv);

    let incident = await getOpenIncident(testEnv, id);
    expect(incident).not.toBeNull();

    // Now recover
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));
    await runChecks(testEnv);

    incident = await getOpenIncident(testEnv, id);
    expect(incident).toBeNull();
  });

  it('does not create duplicate incidents', async () => {
    const id = await insertMonitor(env.DB, 'https://still-down.test', 'Still Down');

    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 500 }));

    // Multiple failures
    await runChecks(testEnv);
    await runChecks(testEnv);
    await runChecks(testEnv);
    await runChecks(testEnv);

    // Should only have 1 incident
    const result = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM incidents WHERE monitor_id = ?'
    ).bind(id).first<{ count: number }>();
    expect(result!.count).toBe(1);
  });
});
