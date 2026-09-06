-- Per-monitor notification channel toggles (email off by default, telegram on)
ALTER TABLE monitors ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monitors ADD COLUMN notify_telegram INTEGER NOT NULL DEFAULT 1;
