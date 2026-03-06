-- Cloudflare accounts for multi-account zone sync
CREATE TABLE IF NOT EXISTS cf_accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  email      TEXT    NOT NULL,
  api_key    TEXT    NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Track which CF account discovered each auto monitor
ALTER TABLE monitors ADD COLUMN cf_account_id INTEGER REFERENCES cf_accounts(id);
