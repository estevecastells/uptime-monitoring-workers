import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Env } from './types';
import { renderDashboard } from './ui/dashboard';
import { renderDetail } from './ui/detail';
import { renderSettings } from './ui/settings';
import { renderLogin } from './ui/login';
import { getAllMonitors, getSetting, setSetting } from './db/queries';
import { getMonitorStats, getRecentChecks } from './db/queries';
import { syncZones } from './cron/discovery';

const app = new Hono<{ Bindings: Env }>();

// ── Auth ───────────────────────────────────────────────

async function hashToken(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

app.get('/login', async (c) => {
  return c.html(renderLogin());
});

app.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const password = body['password'] as string;

  if (password === c.env.DASHBOARD_PASSWORD) {
    const sessionValue = await hashToken(c.env.DASHBOARD_PASSWORD);
    setCookie(c, 'session', sessionValue, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 60 * 60 * 24 * 30,
    });
    return c.redirect('/');
  }

  return c.html(renderLogin('Invalid password'), 401);
});

app.get('/logout', (c) => {
  setCookie(c, 'session', '', { path: '/', maxAge: 0 });
  return c.redirect('/login');
});

// Auth middleware — protect everything except /login
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/login') return next();

  const session = getCookie(c, 'session');
  const expected = await hashToken(c.env.DASHBOARD_PASSWORD);

  if (session !== expected) {
    return c.redirect('/login');
  }

  return next();
});

// ── UI routes ──────────────────────────────────────────

app.get('/', async (c) => {
  return c.html(await renderDashboard(c.env));
});

app.get('/monitor/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.text('Invalid ID', 400);
  return c.html(await renderDetail(c.env, id));
});

app.get('/settings', async (c) => {
  return c.html(await renderSettings(c.env));
});

// ── API routes ─────────────────────────────────────────

app.post('/api/monitors', async (c) => {
  const body = await c.req.json<{ url?: string; name?: string }>();
  const { url, name } = body;

  if (!url) return c.json({ error: 'URL is required' }, 400);
  try {
    new URL(url);
  } catch {
    return c.json({ error: 'Invalid URL' }, 400);
  }

  try {
    await c.env.DB.prepare(
      "INSERT INTO monitors (url, name, source) VALUES (?, ?, 'manual')"
    )
      .bind(url, name || new URL(url).hostname)
      .run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg.includes('UNIQUE')) {
      return c.json({ error: 'Monitor already exists' }, 409);
    }
    return c.json({ error: msg }, 500);
  }

  return c.json({ ok: true }, 201);
});

app.delete('/api/monitors/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  // Soft-delete: mark as deleted so zone sync won't re-add it
  await c.env.DB.prepare(
    "UPDATE monitors SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?"
  ).bind(id).run();
  // Clean up related data
  await c.env.DB.prepare('DELETE FROM checks WHERE monitor_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM incidents WHERE monitor_id = ?').bind(id).run();
  return c.json({ ok: true });
});

app.put('/api/monitors/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const body = await c.req.json<{ url?: string; name?: string }>();
  const { url, name } = body;

  if (url) {
    try { new URL(url); } catch { return c.json({ error: 'Invalid URL' }, 400); }
  }

  if (url && name) {
    await c.env.DB.prepare(
      "UPDATE monitors SET url = ?, name = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(url, name, id).run();
  } else if (url) {
    await c.env.DB.prepare(
      "UPDATE monitors SET url = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(url, id).run();
  } else if (name) {
    await c.env.DB.prepare(
      "UPDATE monitors SET name = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(name, id).run();
  }

  return c.json({ ok: true });
});

app.post('/api/monitors/:id/toggle', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  await c.env.DB.prepare(
    `UPDATE monitors SET
      is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
      user_paused = CASE WHEN is_active = 1 THEN 1 ELSE 0 END,
      updated_at = datetime('now')
    WHERE id = ?`
  )
    .bind(id)
    .run();
  return c.json({ ok: true });
});

app.get('/api/monitors/:id/checks', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const limit = parseInt(c.req.query('limit') || '288');
  const checks = await getRecentChecks(c.env, id, limit);
  return c.json(checks);
});

app.get('/api/stats', async (c) => {
  const stats = await getMonitorStats(c.env);
  return c.json(stats);
});

app.post('/api/sync-zones', async (c) => {
  await syncZones(c.env);
  return c.json({ ok: true });
});

app.get('/api/settings', async (c) => {
  const retentionDays = await getSetting(c.env, 'retention_days') || '7';
  return c.json({ retention_days: parseInt(retentionDays) });
});

app.put('/api/settings', async (c) => {
  const body = await c.req.json<{ retention_days?: number }>();
  if (body.retention_days !== undefined) {
    const days = Math.max(1, Math.min(90, Math.round(body.retention_days)));
    await setSetting(c.env, 'retention_days', String(days));
  }
  return c.json({ ok: true });
});

export { app };
