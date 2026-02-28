-- Track whether a monitor was paused by the user (vs deactivated by zone sync)
ALTER TABLE monitors ADD COLUMN user_paused INTEGER NOT NULL DEFAULT 0;
