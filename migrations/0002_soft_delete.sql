-- Add soft-delete support so deleted auto-discovered monitors don't reappear on zone sync
ALTER TABLE monitors ADD COLUMN deleted_at TEXT DEFAULT NULL;
