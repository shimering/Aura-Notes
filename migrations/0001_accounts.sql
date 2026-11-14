-- Aura Notes account storage: users and per-user note metadata.
-- Note payloads (rich text + ink strokes) live in the R2 bucket, keyed by
-- `users/<sub>/notes/<note id>.json`.

CREATE TABLE IF NOT EXISTS users (
  sub TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  picture TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  user_sub TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  color TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_sub, id)
);

CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes (user_sub, updated_at DESC);
