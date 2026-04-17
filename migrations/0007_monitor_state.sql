-- Track the latest known state directly on the monitor row so we don't have
-- to write a `checks` row on every cron tick. `checks` becomes sparse: it
-- logs state transitions and hourly heartbeats only.

ALTER TABLE monitors ADD COLUMN current_status INTEGER;
ALTER TABLE monitors ADD COLUMN last_response_ms INTEGER;
ALTER TABLE monitors ADD COLUMN last_status_code INTEGER;
ALTER TABLE monitors ADD COLUMN last_error TEXT;
ALTER TABLE monitors ADD COLUMN last_checked_at TEXT;
ALTER TABLE monitors ADD COLUMN last_logged_at TEXT;
ALTER TABLE monitors ADD COLUMN last_status_change_at TEXT;
ALTER TABLE monitors ADD COLUMN consecutive_downs INTEGER NOT NULL DEFAULT 0;

-- Seed current_status from the most recent check row so the first tick after
-- migration doesn't treat every monitor as "new".
UPDATE monitors
   SET current_status = (
         SELECT is_up FROM checks c
          WHERE c.monitor_id = monitors.id
          ORDER BY c.checked_at DESC LIMIT 1
       ),
       last_response_ms = (
         SELECT response_ms FROM checks c
          WHERE c.monitor_id = monitors.id
          ORDER BY c.checked_at DESC LIMIT 1
       ),
       last_checked_at = (
         SELECT checked_at FROM checks c
          WHERE c.monitor_id = monitors.id
          ORDER BY c.checked_at DESC LIMIT 1
       ),
       last_logged_at = (
         SELECT checked_at FROM checks c
          WHERE c.monitor_id = monitors.id
          ORDER BY c.checked_at DESC LIMIT 1
       );
