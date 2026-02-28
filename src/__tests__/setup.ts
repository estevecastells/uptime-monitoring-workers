import { env } from 'cloudflare:test';

/**
 * Apply all migrations to the test D1 database.
 * Call this in beforeAll() of any test that uses the DB.
 */
export async function applyMigrations(): Promise<void> {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS monitors (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, name TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'auto', is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT DEFAULT NULL, user_paused INTEGER NOT NULL DEFAULT 0);"
  );

  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS checks (id INTEGER PRIMARY KEY AUTOINCREMENT, monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE, status_code INTEGER, response_ms INTEGER, is_up INTEGER NOT NULL, error TEXT, checked_at TEXT NOT NULL DEFAULT (datetime('now')));"
  );

  await env.DB.exec(
    'CREATE INDEX IF NOT EXISTS idx_checks_monitor_time ON checks(monitor_id, checked_at DESC);'
  );

  await env.DB.exec(
    'CREATE INDEX IF NOT EXISTS idx_checks_checked_at ON checks(checked_at);'
  );

  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS incidents (id INTEGER PRIMARY KEY AUTOINCREMENT, monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE, started_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT, notified_down INTEGER NOT NULL DEFAULT 0, notified_up INTEGER NOT NULL DEFAULT 0);"
  );

  await env.DB.exec(
    'CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents(monitor_id, resolved_at);'
  );

  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
  );

  await env.DB.exec(
    "INSERT OR IGNORE INTO settings (key, value) VALUES ('retention_days', '7');"
  );
}

/** Clear all tables between tests */
export async function resetDB(): Promise<void> {
  await env.DB.exec('DELETE FROM incidents;');
  await env.DB.exec('DELETE FROM checks;');
  await env.DB.exec('DELETE FROM monitors;');
  await env.DB.exec("DELETE FROM settings; INSERT INTO settings (key, value) VALUES ('retention_days', '7');");
}

/** Insert a monitor and return its id */
export async function insertMonitor(
  db: D1Database,
  url: string,
  name: string,
  source: 'auto' | 'manual' = 'manual'
): Promise<number> {
  const result = await db
    .prepare('INSERT INTO monitors (url, name, source) VALUES (?, ?, ?)')
    .bind(url, name, source)
    .run();
  return result.meta.last_row_id as number;
}
