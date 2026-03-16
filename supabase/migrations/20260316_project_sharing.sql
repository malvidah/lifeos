-- ── Project sharing ──────────────────────────────────────────────────────────
-- Add public sharing support: a toggle and a unique share token.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_public   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_token text    UNIQUE DEFAULT NULL;

-- Index for fast token lookups on the public endpoint
CREATE INDEX IF NOT EXISTS projects_share_token_idx ON projects (share_token) WHERE share_token IS NOT NULL;
