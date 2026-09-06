import { Hono } from 'hono';
import type { Env } from './types';
import { renderDashboard } from './ui/dashboard';
import { renderDetail } from './ui/detail';
import { renderSettings } from './ui/settings';
import { renderMonitors } from './ui/monitors';
import { renderDenied } from './ui/denied';
import { verifyAccessJwt, readAccessToken } from './auth/access';
import { getSetting, setSetting } from './db/queries';
import { getMonitorStats, getRecentChecks } from './db/queries';
import { getAllCfAccounts, addCfAccount, deleteCfAccount, toggleCfAccount } from './db/queries';
import { syncZones } from './cron/discovery';
import { normalizeUrl, parseHttpUrl } from './utils';

const app = new Hono<{ Bindings: Env }>();

// ── Auth (Cloudflare Access / Zero Trust) ──────────────
//
// There is no in-app login. Access authenticates users at the edge before the
// request reaches this Worker, and the middleware below verifies the signed
// JWT it attaches. See src/auth/access.ts for what is verified and why the
// signature — not the `Cf-Access-Authenticated-User-Email` header — is the
// thing we trust.
//
// Who may sign in is defined by the Access application policy in the
// Cloudflare Zero Trust dashboard, so the allowlist lives in exactly one place
// and is not duplicated here.

app.use('*', async (c, next) => {
  const token = readAccessToken(c.req.raw);
  if (!token) {
    return c.html(renderDenied('No Access token was present on this request.'), 403);
  }

  let identity;
  try {
    identity = await verifyAccessJwt(token, c.env);
  } catch (err) {
    // Misconfiguration (missing bindings) or the JWKS endpoint being
    // unreachable. Fail closed rather than serving the dashboard.
    console.error('Access verification error:', err);
    return c.html(renderDenied('Access verification is unavailable right now.'), 503);
  }

  if (!identity) {
    return c.html(renderDenied('Your Access token is not valid for this application.'), 403);
  }

  return next();
});

// ── CSRF ───────────────────────────────────────────────
//
// Several state-changing endpoints take no request body (toggle, sync-zones),
// so a cross-site form post would be a valid request if the browser attached
// the Access session cookie. Rather than depend on the cookie's SameSite
// attribute — which is set by Cloudflare, not by us — require that unsafe
// methods come from our own origin.
//
// Origin is sent by browsers on every cross-origin request and cannot be
// forged by page JavaScript. Requests with no Origin at all (curl, the
// dashboard's own same-origin fetches in older browsers) fall back to Referer,
// and are allowed only if neither header is present — a non-browser client,
// which cannot be a CSRF victim.

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

app.use('*', async (c, next) => {
  if (!UNSAFE_METHODS.has(c.req.method)) return next();

  const target = new URL(c.req.url).origin;
  const origin = c.req.header('Origin');
  const referer = c.req.header('Referer');

  if (origin) {
    if (origin !== target) return c.json({ error: 'Cross-origin request rejected' }, 403);
  } else if (referer) {
    let refererOrigin: string;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      return c.json({ error: 'Cross-origin request rejected' }, 403);
    }
    if (refererOrigin !== target) return c.json({ error: 'Cross-origin request rejected' }, 403);
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

app.get('/monitors', async (c) => {
  return c.html(await renderMonitors(c.env));
});

app.get('/settings', async (c) => {
  return c.html(await renderSettings(c.env));
});

// ── API routes ─────────────────────────────────────────

app.post('/api/monitors', async (c) => {
  const body = await c.req.json<{ url?: string; name?: string }>();
  const { url, name } = body;

  if (!url) return c.json({ error: 'URL is required' }, 400);
  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl) {
    return c.json({ error: 'URL must be a valid http(s) URL' }, 400);
  }

  const normalized = normalizeUrl(url);
  try {
    await c.env.DB.prepare(
      "INSERT INTO monitors (url, name, source) VALUES (?, ?, 'manual')"
    )
      .bind(normalized, name || parsedUrl.hostname)
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

  if (url && !parseHttpUrl(url)) {
    return c.json({ error: 'URL must be a valid http(s) URL' }, 400);
  }

  const normalized = url ? normalizeUrl(url) : undefined;
  if (normalized && name) {
    await c.env.DB.prepare(
      "UPDATE monitors SET url = ?, name = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(normalized, name, id).run();
  } else if (normalized) {
    await c.env.DB.prepare(
      "UPDATE monitors SET url = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(normalized, id).run();
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

app.post('/api/monitors/:id/notify', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const body = await c.req.json<{ notify_email?: boolean; notify_telegram?: boolean }>();
  if (body.notify_email !== undefined) {
    await c.env.DB.prepare(
      "UPDATE monitors SET notify_email = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(body.notify_email ? 1 : 0, id).run();
  }
  if (body.notify_telegram !== undefined) {
    await c.env.DB.prepare(
      "UPDATE monitors SET notify_telegram = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(body.notify_telegram ? 1 : 0, id).run();
  }
  return c.json({ ok: true });
});

app.get('/api/monitors/:id/checks', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const requested = parseInt(c.req.query('limit') || '288');
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 1000) : 288;
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

// ── CF Accounts API ─────────────────────────────────────

app.get('/api/cf-accounts', async (c) => {
  const accounts = await getAllCfAccounts(c.env);
  // Mask API keys in response
  return c.json(accounts.map(a => ({ ...a, api_key: a.api_key.slice(0, 6) + '...' })));
});

app.post('/api/cf-accounts', async (c) => {
  const body = await c.req.json<{ name?: string; email?: string; api_key?: string }>();
  const { name, email, api_key } = body;

  if (!name || !email || !api_key) {
    return c.json({ error: 'Name, email, and API key are required' }, 400);
  }

  await addCfAccount(c.env, name, email, api_key);
  return c.json({ ok: true }, 201);
});

app.delete('/api/cf-accounts/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  await deleteCfAccount(c.env, id);
  return c.json({ ok: true });
});

app.post('/api/cf-accounts/:id/toggle', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  await toggleCfAccount(c.env, id);
  return c.json({ ok: true });
});

export { app };
