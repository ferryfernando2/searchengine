const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

let dbPromise = null;

async function getDb() {
  if (dbPromise) return dbPromise;
  const dbPath = path.join(__dirname, 'data.sqlite');
  dbPromise = open({ filename: dbPath, driver: sqlite3.Database });
  const db = await dbPromise;
  await db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS docs (
      url TEXT PRIMARY KEY,
      title TEXT,
      text TEXT,
      len INTEGER,
      lang TEXT,
      image TEXT
    );
    CREATE TABLE IF NOT EXISTS postings (
      term TEXT,
      url TEXT,
      tf INTEGER,
      PRIMARY KEY(term, url)
    );
    CREATE INDEX IF NOT EXISTS idx_term ON postings(term);
    CREATE TABLE IF NOT EXISTS queries (
      q TEXT PRIMARY KEY,
      cnt INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_queries_q ON queries(q);
  `);
  // Ensure existing DB has `lang` column (SQLite ALTER TABLE add column is safe if missing)
  try {
    const info = await db.all("PRAGMA table_info('docs')");
    const hasLang = info.some(col => col.name === 'lang');
    if (!hasLang) {
      await db.exec("ALTER TABLE docs ADD COLUMN lang TEXT;");
    }
    const hasImage = info.some(col => col.name === 'image');
    if (!hasImage) {
      try { await db.exec("ALTER TABLE docs ADD COLUMN image TEXT;"); } catch (e) { }
    }
  } catch (e) {
    // ignore
  }
  return db;
}

module.exports = { getDb };
