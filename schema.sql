-- gitster pretotype: D1 schema (binding DB)
-- Apply with: npx wrangler d1 execute gitster --remote --file=./schema.sql
-- No IP addresses or user agents are stored.

CREATE TABLE IF NOT EXISTS signups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL UNIQUE,            -- always stored lowercased
  daw        TEXT,
  pain       TEXT,                               -- capped at 500 characters by the API
  src        TEXT,
  consent    INTEGER NOT NULL CHECK (consent IN (0, 1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  src        TEXT,
  session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_events_name_src ON events (name, src);
CREATE INDEX IF NOT EXISTS idx_events_session  ON events (session_id);
CREATE INDEX IF NOT EXISTS idx_signups_src     ON signups (src);
