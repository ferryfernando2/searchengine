const fs = require('fs');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

(async () => {
  try {
    const dbPath = path.join(__dirname, '..', 'data.sqlite');
    // Backup existing again just in case
    if (fs.existsSync(dbPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const bak = path.join(__dirname, '..', `data.sqlite.finalbak.${ts}`);
      fs.copyFileSync(dbPath, bak);
      console.log('Backup created:', bak);
    }

    // Remove existing DB and create a fresh one with only schema
    try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }

    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.exec(`PRAGMA journal_mode = WAL;
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
    await db.close();

    // Vacuum and report size
    const stats = fs.statSync(dbPath);
    console.log('New DB created at', dbPath, 'size:', (stats.size/1024).toFixed(2), 'KB');
  } catch (e) {
    console.error('Reset failed:', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();