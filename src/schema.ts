// The database sets itself up: the first request after a deploy creates any
// table, column or index that is missing, so going live needs no separate
// migration step. Only ever ADD to these lists; never edit a line that shipped.

const TABLES = [
  "CREATE TABLE IF NOT EXISTS memes ( id TEXT PRIMARY KEY, parent_id TEXT REFERENCES memes(id) ON DELETE CASCADE, headline TEXT, source_host TEXT, source_url TEXT, format TEXT NOT NULL, scene TEXT NOT NULL, lines TEXT NOT NULL, nickname TEXT NOT NULL, poster TEXT NOT NULL, delete_key TEXT, reports INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL )",
  "CREATE INDEX IF NOT EXISTS memes_feed ON memes (parent_id, hidden, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS memes_poster ON memes (poster, created_at)",
  "CREATE TABLE IF NOT EXISTS reports ( meme_id TEXT NOT NULL REFERENCES memes(id) ON DELETE CASCADE, reporter TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (meme_id, reporter) )",
  "CREATE TABLE IF NOT EXISTS generations ( poster TEXT NOT NULL, created_at TEXT NOT NULL )",
  "CREATE INDEX IF NOT EXISTS generations_by_time ON generations (created_at)",
  "CREATE INDEX IF NOT EXISTS generations_by_poster ON generations (poster, created_at)",
  "CREATE TABLE IF NOT EXISTS news_seen ( link TEXT PRIMARY KEY, created_at TEXT NOT NULL )",
  // Votes ("lachjes"): one per visitor per meme.
  "CREATE TABLE IF NOT EXISTS votes ( meme_id TEXT NOT NULL REFERENCES memes(id) ON DELETE CASCADE, voter TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (meme_id, voter) )",
  "CREATE INDEX IF NOT EXISTS votes_by_voter ON votes (voter, created_at)",
];

// Columns added after the first release. SQLite has no ADD COLUMN IF NOT EXISTS,
// so each runs on its own and "duplicate column" means it is already there.
const COLUMNS = ["ALTER TABLE memes ADD COLUMN score INTEGER NOT NULL DEFAULT 0"];

const INDEXES_AFTER_COLUMNS = ["CREATE INDEX IF NOT EXISTS memes_score ON memes (parent_id, hidden, score DESC, created_at DESC)"];

let ready: Promise<void> | null = null;

async function setUp(db: D1Database): Promise<void> {
  await db.batch(TABLES.map((s) => db.prepare(s)));
  for (const s of COLUMNS) {
    try {
      await db.prepare(s).run();
    } catch (e) {
      if (!/duplicate column/i.test(String((e as Error)?.message ?? e))) throw e;
    }
  }
  await db.batch(INDEXES_AFTER_COLUMNS.map((s) => db.prepare(s)));
}

export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= setUp(db).catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}
