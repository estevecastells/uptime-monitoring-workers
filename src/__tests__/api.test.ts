import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, createExecutionContext, SELF } from 'cloudflare:test';
import { applyMigrations, resetDB, insertMonitor } from './setup';
import worker from '../index';

const testEnv = env as unknown as import('../types').Env;

// Helper: make an authenticated request
async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  // First, login to get a session cookie
  const loginResp = await SELF.fetch(`https://test.local/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `password=${env.DASHBOARD_PASSWORD}`,
    redirect: 'manual',
  });
  const cookies = loginResp.headers.get('set-cookie') || '';

  return SELF.fetch(`https://test.local${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Cookie: cookies,
    },
  });
}

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  await resetDB();
});

describe('Auth', () => {
  it('redirects to /login when not authenticated', async () => {
    const resp = await SELF.fetch('https://test.local/', { redirect: 'manual' });
    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe('/login');
  });

  it('login page is accessible without auth', async () => {
    const resp = await SELF.fetch('https://test.local/login');
    expect(resp.status).toBe(200);
    const text = await resp.text();
    expect(text).toContain('password');
  });

  it('login with correct password sets session cookie', async () => {
    const resp = await SELF.fetch('https://test.local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `password=${env.DASHBOARD_PASSWORD}`,
      redirect: 'manual',
    });
    expect(resp.status).toBe(302);
    expect(resp.headers.get('set-cookie')).toContain('session=');
  });

  it('login with wrong password returns 401', async () => {
    const resp = await SELF.fetch('https://test.local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
    });
    expect(resp.status).toBe(401);
  });
});

describe('POST /api/monitors', () => {
  it('creates a manual monitor', async () => {
    const resp = await authedFetch('/api/monitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://new-site.com', name: 'New Site' }),
    });
    expect(resp.status).toBe(201);

    const row = await env.DB.prepare("SELECT * FROM monitors WHERE url = 'https://new-site.com'").first();
    expect(row).not.toBeNull();
    expect((row as Record<string, unknown>).source).toBe('manual');
  });

  it('rejects invalid URLs', async () => {
    const resp = await authedFetch('/api/monitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url' }),
    });
    expect(resp.status).toBe(400);
  });

  it('rejects missing URL', async () => {
    const resp = await authedFetch('/api/monitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No URL' }),
    });
    expect(resp.status).toBe(400);
  });

  it('returns 409 for duplicate URL', async () => {
    await insertMonitor(env.DB, 'https://dup.com', 'Dup');

    const resp = await authedFetch('/api/monitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://dup.com' }),
    });
    expect(resp.status).toBe(409);
  });
});

describe('DELETE /api/monitors/:id', () => {
  it('soft-deletes a monitor', async () => {
    const id = await insertMonitor(env.DB, 'https://delete-me.com', 'Delete Me');

    const resp = await authedFetch(`/api/monitors/${id}`, { method: 'DELETE' });
    expect(resp.status).toBe(200);

    const row = await env.DB.prepare('SELECT deleted_at, is_active FROM monitors WHERE id = ?').bind(id).first();
    expect(row).not.toBeNull();
    expect((row as Record<string, unknown>).deleted_at).not.toBeNull();
    expect((row as Record<string, unknown>).is_active).toBe(0);
  });

  it('cleans up checks and incidents on delete', async () => {
    const id = await insertMonitor(env.DB, 'https://cleanup.com', 'Cleanup');
    await env.DB.prepare(
      'INSERT INTO checks (monitor_id, status_code, is_up) VALUES (?, 200, 1)'
    ).bind(id).run();
    await env.DB.prepare(
      'INSERT INTO incidents (monitor_id, notified_down) VALUES (?, 1)'
    ).bind(id).run();

    await authedFetch(`/api/monitors/${id}`, { method: 'DELETE' });

    const checks = await env.DB.prepare('SELECT COUNT(*) as c FROM checks WHERE monitor_id = ?').bind(id).first<{ c: number }>();
    const incidents = await env.DB.prepare('SELECT COUNT(*) as c FROM incidents WHERE monitor_id = ?').bind(id).first<{ c: number }>();
    expect(checks!.c).toBe(0);
    expect(incidents!.c).toBe(0);
  });
});

describe('PUT /api/monitors/:id', () => {
  it('updates monitor URL and name', async () => {
    const id = await insertMonitor(env.DB, 'https://old.com', 'Old Name');

    const resp = await authedFetch(`/api/monitors/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://new.com', name: 'New Name' }),
    });
    expect(resp.status).toBe(200);

    const row = await env.DB.prepare('SELECT url, name FROM monitors WHERE id = ?').bind(id).first();
    expect((row as Record<string, unknown>).url).toBe('https://new.com');
    expect((row as Record<string, unknown>).name).toBe('New Name');
  });

  it('rejects invalid URL on update', async () => {
    const id = await insertMonitor(env.DB, 'https://valid.com', 'Valid');

    const resp = await authedFetch(`/api/monitors/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-valid' }),
    });
    expect(resp.status).toBe(400);
  });
});

describe('POST /api/monitors/:id/toggle', () => {
  it('toggles monitor active state', async () => {
    const id = await insertMonitor(env.DB, 'https://toggle.com', 'Toggle');

    // Toggle off
    await authedFetch(`/api/monitors/${id}/toggle`, { method: 'POST' });
    let row = await env.DB.prepare('SELECT is_active FROM monitors WHERE id = ?').bind(id).first();
    expect((row as Record<string, unknown>).is_active).toBe(0);

    // Toggle back on
    await authedFetch(`/api/monitors/${id}/toggle`, { method: 'POST' });
    row = await env.DB.prepare('SELECT is_active FROM monitors WHERE id = ?').bind(id).first();
    expect((row as Record<string, unknown>).is_active).toBe(1);
  });
});

describe('GET /api/stats', () => {
  it('returns monitor stats as JSON', async () => {
    const id = await insertMonitor(env.DB, 'https://stats.com', 'Stats');
    await env.DB.prepare(
      'INSERT INTO checks (monitor_id, status_code, response_ms, is_up) VALUES (?, 200, 100, 1)'
    ).bind(id).run();

    const resp = await authedFetch('/api/stats');
    expect(resp.status).toBe(200);

    const data = await resp.json() as unknown[];
    expect(data).toHaveLength(1);
  });
});

describe('GET /api/monitors/:id/checks', () => {
  it('returns check history as JSON', async () => {
    const id = await insertMonitor(env.DB, 'https://history.com', 'History');
    await env.DB.prepare(
      'INSERT INTO checks (monitor_id, status_code, response_ms, is_up) VALUES (?, 200, 100, 1)'
    ).bind(id).run();

    const resp = await authedFetch(`/api/monitors/${id}/checks`);
    expect(resp.status).toBe(200);

    const data = await resp.json() as unknown[];
    expect(data).toHaveLength(1);
  });
});
