-- A meme with parent_id NULL is a post about a news story; a meme with a
-- parent_id is a reply to that post.
CREATE TABLE memes (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES memes(id) ON DELETE CASCADE,
  headline TEXT,
  source_host TEXT,
  source_url TEXT,
  format TEXT NOT NULL,
  scene TEXT NOT NULL,
  lines TEXT NOT NULL,          -- JSON array of strings
  nickname TEXT NOT NULL,
  poster TEXT NOT NULL,         -- salted hash of the visitor's IP, or 'nieuwsdesk'
  delete_key TEXT,              -- SHA-256 of the secret the poster's browser holds
  reports INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX memes_feed ON memes (parent_id, hidden, created_at DESC);
CREATE INDEX memes_poster ON memes (poster, created_at);

CREATE TABLE reports (
  meme_id TEXT NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
  reporter TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (meme_id, reporter)
);

-- One row per call to Claude, for the per-visitor and daily limits.
CREATE TABLE generations (
  poster TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX generations_by_time ON generations (created_at);
CREATE INDEX generations_by_poster ON generations (poster, created_at);

-- Stories the news desk has already looked at, so it never makes the same meme twice.
CREATE TABLE news_seen (
  link TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
