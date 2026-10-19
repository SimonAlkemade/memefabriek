// The database sets itself up: the first request after a deploy creates any
// table that is missing, so going live needs no separate migration step.

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS memes ( id TEXT PRIMARY KEY, parent_id TEXT REFERENCES memes(id) ON DELETE CASCADE, headline TEXT, source_host TEXT, source_url TEXT, format TEXT NOT NULL, scene TEXT NOT NULL, lines TEXT NOT NULL, nickname TEXT NOT NULL, poster TEXT NOT NULL, delete_key TEXT, reports INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL )",
  "CREATE INDEX IF NOT EXISTS memes_feed ON memes (parent_id, hidden, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS memes_poster ON memes (poster, created_at)",
  "CREATE TABLE IF NOT EXISTS reports ( meme_id TEXT NOT NULL REFERENCES memes(id) ON DELETE CASCADE, reporter TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (meme_id, reporter) )",
  "CREATE TABLE IF NOT EXISTS generations ( poster TEXT NOT NULL, created_at TEXT NOT NULL )",
  "CREATE INDEX IF NOT EXISTS generations_by_time ON generations (created_at)",
  "CREATE INDEX IF NOT EXISTS generations_by_poster ON generations (poster, created_at)",
  "CREATE TABLE IF NOT EXISTS news_seen ( link TEXT PRIMARY KEY, created_at TEXT NOT NULL )",
];

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= db
    .batch(SCHEMA.map((s) => db.prepare(s)))
    .then(() => undefined)
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}
