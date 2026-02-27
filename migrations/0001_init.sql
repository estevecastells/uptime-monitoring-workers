-- Monitors: each row is a site to check
CREATE TABLE IF NOT EXISTS monitors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  source     TEXT    NOT NULL DEFAULT 'auto',
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Check results: one row per health check
CREATE TABLE IF NOT EXISTS checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id  INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status_code INTEGER,
  response_ms INTEGER,
  is_up       INTEGER NOT NULL,
  error       TEXT,
  checked_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_checks_monitor_time ON checks(monitor_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_checks_checked_at ON checks(checked_at);

-- Incidents: contiguous downtime periods for notification dedup
CREATE TABLE IF NOT EXISTS incidents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id    INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_at   TEXT,
  notified_down INTEGER NOT NULL DEFAULT 0,
  notified_up   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents(monitor_id, resolved_at);
