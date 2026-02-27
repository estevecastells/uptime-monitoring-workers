import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations, resetDB, insertMonitor } from './setup';
import {
  getActiveMonitors,
  getAllMonitors,
  getMonitor,
  insertCheck,
  getRecentChecks,
  getLastNChecks,
  getOpenIncident,
  createIncident,
  resolveIncident,
  getMonitorStats,
  getMonitorIncidents,
  getDownMonitors,
  cleanOldChecks,
} from '../db/queries';

const testEnv = env as unknown as import('../types').Env;

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  await resetDB();
});

describe('Monitor queries', () => {
  it('getActiveMonitors returns only active, non-deleted monitors', async () => {
    await insertMonitor(env.DB, 'https://a.com', 'A');
    const bId = await insertMonitor(env.DB, 'https://b.com', 'B');
    // deactivate B
    await env.DB.prepare('UPDATE monitors SET is_active = 0 WHERE id = ?').bind(bId).run();
    // soft-delete C
    const cId = await insertMonitor(env.DB, 'https://c.com', 'C');
    await env.DB.prepare("UPDATE monitors SET deleted_at = datetime('now') WHERE id = ?").bind(cId).run();

    const active = await getActiveMonitors(testEnv);
    expect(active).toHaveLength(1);
    expect(active[0].url).toBe('https://a.com');
  });

  it('getAllMonitors excludes soft-deleted monitors', async () => {
    await insertMonitor(env.DB, 'https://a.com', 'A');
    const bId = await insertMonitor(env.DB, 'https://b.com', 'B');
    await env.DB.prepare("UPDATE monitors SET deleted_at = datetime('now') WHERE id = ?").bind(bId).run();

    const all = await getAllMonitors(testEnv);
    expect(all).toHaveLength(1);
    expect(all[0].url).toBe('https://a.com');
  });

  it('getMonitor returns a single monitor by id', async () => {
    const id = await insertMonitor(env.DB, 'https://example.com', 'Example');
    const mon = await getMonitor(testEnv, id);
    expect(mon).not.toBeNull();
    expect(mon!.url).toBe('https://example.com');
    expect(mon!.name).toBe('Example');
  });

  it('getMonitor returns null for non-existent id', async () => {
    const mon = await getMonitor(testEnv, 999);
    expect(mon).toBeNull();
  });
});

describe('Check queries', () => {
  it('insertCheck and getRecentChecks round-trip', async () => {
    const id = await insertMonitor(env.DB, 'https://test.com', 'Test');
    await insertCheck(testEnv, id, 200, 150, true, null);
    await insertCheck(testEnv, id, 500, 300, false, 'HTTP 500');

    const checks = await getRecentChecks(testEnv, id, 10);
    expect(checks).toHaveLength(2);
    // Both checks are stored; verify we have one up and one down
    const statuses = checks.map((c) => c.is_up).sort();
    expect(statuses).toEqual([0, 1]);
  });

  it('getLastNChecks limits correctly', async () => {
    const id = await insertMonitor(env.DB, 'https://test.com', 'Test');
    for (let i = 0; i < 5; i++) {
      await insertCheck(testEnv, id, 200, 100, true, null);
    }

    const last2 = await getLastNChecks(testEnv, id, 2);
    expect(last2).toHaveLength(2);
  });
});

describe('Incident queries', () => {
  it('createIncident opens an incident and getOpenIncident finds it', async () => {
    const id = await insertMonitor(env.DB, 'https://down.com', 'Down');
    await createIncident(testEnv, id);

    const incident = await getOpenIncident(testEnv, id);
    expect(incident).not.toBeNull();
    expect(incident!.monitor_id).toBe(id);
    expect(incident!.resolved_at).toBeNull();
    expect(incident!.notified_down).toBe(1);
  });

  it('resolveIncident closes the incident', async () => {
    const id = await insertMonitor(env.DB, 'https://down.com', 'Down');
    await createIncident(testEnv, id);
    const incident = await getOpenIncident(testEnv, id);

    await resolveIncident(testEnv, incident!.id, true);

    const resolved = await getOpenIncident(testEnv, id);
    expect(resolved).toBeNull();
  });

  it('getMonitorIncidents returns incidents in desc order', async () => {
    const id = await insertMonitor(env.DB, 'https://flaky.com', 'Flaky');
    await createIncident(testEnv, id);
    const first = await getOpenIncident(testEnv, id);
    await resolveIncident(testEnv, first!.id, true);
    await createIncident(testEnv, id);

    const incidents = await getMonitorIncidents(testEnv, id);
    expect(incidents).toHaveLength(2);
    // Most recent first
    expect(incidents[0].resolved_at).toBeNull();
    expect(incidents[1].resolved_at).not.toBeNull();
  });
});

describe('getMonitorStats', () => {
  it('returns stats with uptime calculation', async () => {
    const id = await insertMonitor(env.DB, 'https://healthy.com', 'Healthy');
    await insertCheck(testEnv, id, 200, 100, true, null);
    await insertCheck(testEnv, id, 200, 120, true, null);

    const stats = await getMonitorStats(testEnv);
    expect(stats).toHaveLength(1);
    expect(stats[0].up_24h).toBe(2);
    expect(stats[0].total_24h).toBe(2);
    expect(stats[0].current_status).toBe(1);
  });

  it('excludes soft-deleted monitors', async () => {
    const id = await insertMonitor(env.DB, 'https://deleted.com', 'Deleted');
    await insertCheck(testEnv, id, 200, 100, true, null);
    await env.DB.prepare("UPDATE monitors SET deleted_at = datetime('now') WHERE id = ?").bind(id).run();

    const stats = await getMonitorStats(testEnv);
    expect(stats).toHaveLength(0);
  });

  it('sorts down monitors first', async () => {
    const upId = await insertMonitor(env.DB, 'https://up.com', 'AAA Up');
    const downId = await insertMonitor(env.DB, 'https://down.com', 'ZZZ Down');
    await insertCheck(testEnv, upId, 200, 100, true, null);
    await insertCheck(testEnv, downId, 0, null, false, 'timeout');

    const stats = await getMonitorStats(testEnv);
    expect(stats).toHaveLength(2);
    expect(stats[0].name).toBe('ZZZ Down');
    expect(stats[1].name).toBe('AAA Up');
  });
});

describe('getDownMonitors', () => {
  it('returns only monitors whose last check is down', async () => {
    const upId = await insertMonitor(env.DB, 'https://up.com', 'Up');
    const downId = await insertMonitor(env.DB, 'https://down.com', 'Down');
    await insertCheck(testEnv, upId, 200, 100, true, null);
    await insertCheck(testEnv, downId, 0, null, false, 'timeout');

    const down = await getDownMonitors(testEnv);
    expect(down).toHaveLength(1);
    expect(down[0].url).toBe('https://down.com');
  });

  it('excludes soft-deleted monitors', async () => {
    const id = await insertMonitor(env.DB, 'https://deleted-down.com', 'Deleted');
    await insertCheck(testEnv, id, 0, null, false, 'timeout');
    await env.DB.prepare("UPDATE monitors SET deleted_at = datetime('now') WHERE id = ?").bind(id).run();

    const down = await getDownMonitors(testEnv);
    expect(down).toHaveLength(0);
  });
});

describe('cleanOldChecks', () => {
  it('removes checks and resolved incidents older than 30 days', async () => {
    const id = await insertMonitor(env.DB, 'https://old.com', 'Old');

    // Insert old check
    await env.DB.prepare(
      "INSERT INTO checks (monitor_id, status_code, response_ms, is_up, checked_at) VALUES (?, 200, 100, 1, datetime('now', '-31 days'))"
    ).bind(id).run();
    // Insert recent check
    await insertCheck(testEnv, id, 200, 100, true, null);

    // Insert old resolved incident
    await env.DB.prepare(
      "INSERT INTO incidents (monitor_id, started_at, resolved_at, notified_down, notified_up) VALUES (?, datetime('now', '-35 days'), datetime('now', '-31 days'), 1, 1)"
    ).bind(id).run();

    await cleanOldChecks(testEnv);

    const checks = await getRecentChecks(testEnv, id, 100);
    expect(checks).toHaveLength(1); // Only recent one remains

    const incidents = await getMonitorIncidents(testEnv, id);
    expect(incidents).toHaveLength(0); // Old resolved incident removed
  });
});
