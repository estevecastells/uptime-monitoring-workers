import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations, resetDB, insertMonitor } from './setup';
import { syncZones } from '../cron/discovery';
import { getAllMonitors } from '../db/queries';

const testEnv = env as unknown as import('../types').Env;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  await resetDB();
  globalThis.fetch = originalFetch;
});

function mockCFZonesResponse(zones: string[]): void {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        result: zones.map((name) => ({ name })),
        result_info: { total_pages: 1 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  );
}

describe('syncZones', () => {
  it('discovers and inserts new zones', async () => {
    mockCFZonesResponse(['example.com', 'test.org']);

    await syncZones(testEnv);

    const monitors = await getAllMonitors(testEnv);
    expect(monitors).toHaveLength(2);
    expect(monitors.map((m) => m.url).sort()).toEqual([
      'https://example.com',
      'https://test.org',
    ]);
    expect(monitors[0].source).toBe('auto');
  });

  it('deactivates monitors whose zones are removed', async () => {
    // First sync with 2 zones
    mockCFZonesResponse(['a.com', 'b.com']);
    await syncZones(testEnv);

    // Second sync — b.com removed
    mockCFZonesResponse(['a.com']);
    await syncZones(testEnv);

    const all = await env.DB.prepare('SELECT url, is_active FROM monitors ORDER BY url').all();
    const map = Object.fromEntries(all.results.map((r: Record<string, unknown>) => [r.url, r.is_active]));
    expect(map['https://a.com']).toBe(1);
    expect(map['https://b.com']).toBe(0);
  });

  it('does NOT re-add soft-deleted monitors', async () => {
    // Initial sync
    mockCFZonesResponse(['keep.com', 'deleted.com']);
    await syncZones(testEnv);

    // User deletes one
    const row = await env.DB.prepare("SELECT id FROM monitors WHERE url = 'https://deleted.com'").first<{ id: number }>();
    await env.DB.prepare("UPDATE monitors SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").bind(row!.id).run();

    // Re-sync — same zones still exist in CF
    mockCFZonesResponse(['keep.com', 'deleted.com']);
    await syncZones(testEnv);

    // The deleted one should still be deleted
    const deleted = await env.DB.prepare("SELECT deleted_at, is_active FROM monitors WHERE url = 'https://deleted.com'").first();
    expect((deleted as Record<string, unknown>).deleted_at).not.toBeNull();
    expect((deleted as Record<string, unknown>).is_active).toBe(0);

    // Only keep.com should appear in active monitors
    const active = await getAllMonitors(testEnv);
    expect(active).toHaveLength(1);
    expect(active[0].url).toBe('https://keep.com');
  });

  it('re-activates zones that come back', async () => {
    mockCFZonesResponse(['temp.com', 'other.com']);
    await syncZones(testEnv);

    // Zone removed (but other.com remains so allDomains.length > 0 triggers deactivation)
    mockCFZonesResponse(['other.com']);
    await syncZones(testEnv);

    let row = await env.DB.prepare("SELECT is_active FROM monitors WHERE url = 'https://temp.com'").first<{ is_active: number }>();
    expect(row!.is_active).toBe(0);

    // Zone comes back
    mockCFZonesResponse(['temp.com', 'other.com']);
    await syncZones(testEnv);

    row = await env.DB.prepare("SELECT is_active FROM monitors WHERE url = 'https://temp.com'").first<{ is_active: number }>();
    expect(row!.is_active).toBe(1);
  });
});
