-- Key-value settings table
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Default retention: 7 days
INSERT OR IGNORE INTO settings (key, value) VALUES ('retention_days', '7');
