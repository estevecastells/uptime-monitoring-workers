import type { Env, Monitor, Check, Incident, MonitorStats } from '../types';

export async function getActiveMonitors(env: Env): Promise<Monitor[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM monitors WHERE is_active = 1 AND deleted_at IS NULL ORDER BY name'
  ).all<Monitor>();
  return result.results;
}

export async function getAllMonitors(env: Env): Promise<Monitor[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM monitors WHERE deleted_at IS NULL ORDER BY name'
  ).all<Monitor>();
  return result.results;
}

export async function getMonitor(env: Env, id: number): Promise<Monitor | null> {
  return env.DB.prepare('SELECT * FROM monitors WHERE id = ?').bind(id).first<Monitor>();
}

export async function insertCheck(
  env: Env,
  monitorId: number,
  statusCode: number | null,
  responseMs: number | null,
  isUp: boolean,
  error: string | null
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO checks (monitor_id, status_code, response_ms, is_up, error) VALUES (?, ?, ?, ?, ?)'
  ).bind(monitorId, statusCode, responseMs, isUp ? 1 : 0, error).run();
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
  const result = await env.DB.prepare(`
    SELECT
      m.id, m.url, m.name, m.is_active, m.source,
      (SELECT COUNT(*) FROM checks c WHERE c.monitor_id = m.id AND c.is_up = 1 AND c.checked_at > datetime('now', '-24 hours')) as up_24h,
      (SELECT COUNT(*) FROM checks c WHERE c.monitor_id = m.id AND c.checked_at > datetime('now', '-24 hours')) as total_24h,
      (SELECT response_ms FROM checks c WHERE c.monitor_id = m.id ORDER BY c.checked_at DESC LIMIT 1) as last_response_ms,
      (SELECT is_up FROM checks c WHERE c.monitor_id = m.id ORDER BY c.checked_at DESC LIMIT 1) as current_status
    FROM monitors m
    WHERE m.is_active = 1 AND m.deleted_at IS NULL
    ORDER BY
      CASE WHEN (SELECT is_up FROM checks c WHERE c.monitor_id = m.id ORDER BY c.checked_at DESC LIMIT 1) = 0 THEN 0 ELSE 1 END,
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
  const result = await env.DB.prepare(`
    SELECT m.* FROM monitors m
    WHERE m.is_active = 1 AND m.deleted_at IS NULL
    AND (SELECT is_up FROM checks c WHERE c.monitor_id = m.id ORDER BY c.checked_at DESC LIMIT 1) = 0
  `).all<Monitor>();
  return result.results;
}

export async function cleanOldChecks(env: Env): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM checks WHERE checked_at < datetime('now', '-7 days')"
  ).run();
  await env.DB.prepare(
    "DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < datetime('now', '-7 days')"
  ).run();
}
