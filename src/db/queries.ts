import type { Env, Monitor, Check, Incident, MonitorStats, CfAccount, CheckOutcome, CfAuthType } from '../types';

// Minimum gap between `checks` rows for an unchanged-status monitor. Without
// this the table would only grow on state transitions, which is too sparse
// for uptime graphs. 60 minutes gives ~24 rows/day/monitor as a baseline.
const HEARTBEAT_MS = 60 * 60 * 1000;

export async function getActiveMonitors(env: Env): Promise<Monitor[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM monitors WHERE is_active = 1 AND deleted_at IS NULL ORDER BY name'
  ).all<Monitor>();
  return result.results;
}

export async function getAllMonitors(env: Env): Promise<Monitor[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM monitors WHERE deleted_at IS NULL ORDER BY is_active DESC, name'
  ).all<Monitor>();
  return result.results;
}

export async function getMonitor(env: Env, id: number): Promise<Monitor | null> {
  return env.DB.prepare('SELECT * FROM monitors WHERE id = ?').bind(id).first<Monitor>();
}

/**
 * Seed a check row + sync the monitor's cached state. Used by tests to set
 * up history; production code goes through `recordCheck` which also decides
 * whether to skip the `checks` row based on heartbeat logic.
 */
export async function insertCheck(
  env: Env,
  monitorId: number,
  statusCode: number | null,
  responseMs: number | null,
  isUp: boolean,
  error: string | null
): Promise<void> {
  const status = isUp ? 1 : 0;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO checks (monitor_id, status_code, response_ms, is_up, error) VALUES (?, ?, ?, ?, ?)'
    ).bind(monitorId, statusCode, responseMs, status, error),
    env.DB.prepare(
      `UPDATE monitors SET
         current_status = ?,
         last_response_ms = ?,
         last_status_code = ?,
         last_error = ?,
         last_checked_at = datetime('now'),
         last_logged_at = datetime('now'),
         consecutive_downs = CASE WHEN ? = 1 THEN 0 ELSE consecutive_downs + 1 END
       WHERE id = ?`
    ).bind(status, responseMs, statusCode, error, status, monitorId),
  ]);
}

/**
 * Record a check result against `monitors` (always) and against `checks`
 * (only on state change or once per HEARTBEAT_MS).
 *
 * Returns the status transition + running consecutive_downs counter so the
 * caller can decide whether to open/close an incident without re-querying.
 */
export async function recordCheck(
  env: Env,
  monitor: Monitor,
  statusCode: number | null,
  responseMs: number | null,
  isUp: boolean,
  error: string | null
): Promise<CheckOutcome> {
  const now = new Date();
  const nowIso = now.toISOString().replace('T', ' ').slice(0, 19);
  const newStatus = isUp ? 1 : 0;
  const previousStatus = monitor.current_status;
  const stateChanged = previousStatus !== null && previousStatus !== newStatus;
  const isFirstCheck = previousStatus === null;
  const consecutiveDowns = isUp ? 0 : (monitor.consecutive_downs ?? 0) + 1;

  const lastLogged = monitor.last_logged_at ? Date.parse(monitor.last_logged_at + 'Z') : 0;
  const needHeartbeat = !lastLogged || now.getTime() - lastLogged >= HEARTBEAT_MS;
  const shouldLog = isFirstCheck || stateChanged || needHeartbeat;

  const monitorUpdate = env.DB.prepare(
    `UPDATE monitors SET
       current_status = ?,
       last_response_ms = ?,
       last_status_code = ?,
       last_error = ?,
       last_checked_at = ?,
       consecutive_downs = ?,
       last_status_change_at = CASE WHEN ? THEN ? ELSE last_status_change_at END,
       last_logged_at = CASE WHEN ? THEN ? ELSE last_logged_at END
     WHERE id = ?`
  ).bind(
    newStatus,
    responseMs,
    statusCode,
    error,
    nowIso,
    consecutiveDowns,
    stateChanged || isFirstCheck ? 1 : 0,
    nowIso,
    shouldLog ? 1 : 0,
    nowIso,
    monitor.id
  );

  if (shouldLog) {
    const insert = env.DB.prepare(
      'INSERT INTO checks (monitor_id, status_code, response_ms, is_up, error) VALUES (?, ?, ?, ?, ?)'
    ).bind(monitor.id, statusCode, responseMs, newStatus, error);
    await env.DB.batch([monitorUpdate, insert]);
  } else {
    await monitorUpdate.run();
  }

  return { stateChanged, consecutiveDowns, previousStatus };
}

export async function getRecentChecks(env: Env, monitorId: number, limit = 288): Promise<Check[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ?'
  ).bind(monitorId, limit).all<Check>();
  return result.results;
}

export async function getLastNChecks(env: Env, monitorId: number, n: number): Promise<Check[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ?'
  ).bind(monitorId, n).all<Check>();
  return result.results;
}

export async function getOpenIncident(env: Env, monitorId: number): Promise<Incident | null> {
  return env.DB.prepare(
    'SELECT * FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL'
  ).bind(monitorId).first<Incident>();
}

export async function createIncident(env: Env, monitorId: number): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO incidents (monitor_id, notified_down) VALUES (?, 1)'
  ).bind(monitorId).run();
}

export async function resolveIncident(env: Env, incidentId: number, notifyUp: boolean): Promise<void> {
  await env.DB.prepare(
    'UPDATE incidents SET resolved_at = datetime(\'now\'), notified_up = ? WHERE id = ?'
  ).bind(notifyUp ? 1 : 0, incidentId).run();
}

export async function getMonitorStats(env: Env): Promise<MonitorStats[]> {
  // current_status / last_response_ms come from the monitors row directly
  // (updated on every check). up_24h / total_24h are derived from the sparse
  // checks table — post-migration this table only contains state changes and
  // hourly heartbeats, so the ratio still reflects uptime accurately.
  const result = await env.DB.prepare(`
    SELECT
      m.id, m.url, m.name, m.is_active, m.source,
      m.current_status as current_status,
      m.last_response_ms as last_response_ms,
      (SELECT COUNT(*) FROM checks c WHERE c.monitor_id = m.id AND c.is_up = 1 AND c.checked_at > datetime('now', '-24 hours')) as up_24h,
      (SELECT COUNT(*) FROM checks c WHERE c.monitor_id = m.id AND c.checked_at > datetime('now', '-24 hours')) as total_24h
    FROM monitors m
    WHERE m.is_active = 1 AND m.deleted_at IS NULL
    ORDER BY
      CASE WHEN m.current_status = 0 THEN 0 ELSE 1 END,
      CASE WHEN total_24h > 0 THEN CAST(up_24h AS REAL) / total_24h ELSE 1.0 END ASC,
      m.name
  `).all<MonitorStats>();
  return result.results;
}

export async function getMonitorIncidents(env: Env, monitorId: number, limit = 20): Promise<Incident[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM incidents WHERE monitor_id = ? ORDER BY started_at DESC LIMIT ?'
  ).bind(monitorId, limit).all<Incident>();
  return result.results;
}

export async function getDownMonitors(env: Env): Promise<Monitor[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM monitors
      WHERE is_active = 1 AND deleted_at IS NULL AND current_status = 0`
  ).all<Monitor>();
  return result.results;
}

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(key, value).run();
}

// ── CF Accounts ─────────────────────────────────────────

export async function getCfAccounts(env: Env): Promise<CfAccount[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM cf_accounts WHERE is_active = 1 ORDER BY name'
  ).all<CfAccount>();
  return result.results;
}

export async function getAllCfAccounts(env: Env): Promise<CfAccount[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM cf_accounts ORDER BY name'
  ).all<CfAccount>();
  return result.results;
}

export async function addCfAccount(
  env: Env,
  name: string,
  email: string,
  apiKey: string,
  authType: CfAuthType = 'token'
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO cf_accounts (name, email, api_key, auth_type) VALUES (?, ?, ?, ?)'
  ).bind(name, email, apiKey, authType).run();
}

export async function deleteCfAccount(env: Env, id: number): Promise<void> {
  await env.DB.prepare('DELETE FROM cf_accounts WHERE id = ?').bind(id).run();
  // Clear the reference from monitors that belonged to this account
  await env.DB.prepare('UPDATE monitors SET cf_account_id = NULL WHERE cf_account_id = ?').bind(id).run();
}

export async function toggleCfAccount(env: Env, id: number): Promise<void> {
  await env.DB.prepare(
    'UPDATE cf_accounts SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?'
  ).bind(id).run();
}

export async function cleanOldChecks(env: Env): Promise<void> {
  const days = parseInt(await getSetting(env, 'retention_days') || '7') || 7;
  // Bound and bind rather than interpolate. parseInt already guarantees a
  // number here, but this is the only statement in the file that built SQL by
  // string concatenation, and that is not a property worth relying on.
  const window = `-${Math.min(Math.max(days, 1), 365)} days`;
  await env.DB.prepare(
    "DELETE FROM checks WHERE checked_at < datetime('now', ?)"
  ).bind(window).run();
  await env.DB.prepare(
    "DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < datetime('now', ?)"
  ).bind(window).run();
}
