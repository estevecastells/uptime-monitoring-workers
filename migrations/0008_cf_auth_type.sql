-- How each stored Cloudflare credential authenticates.
--
-- 'global_key' -> legacy X-Auth-Email + X-Auth-Key (a Global API Key, which
--                 grants full account control and is what we are moving off).
-- 'token'      -> Authorization: Bearer <token>, scoped to Zone:Read.
--
-- Existing rows are Global API Keys, so that stays the default for them; new
-- accounts added through the UI are tokens.
ALTER TABLE cf_accounts ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'global_key';
