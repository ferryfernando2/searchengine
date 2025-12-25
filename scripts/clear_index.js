const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');

(async () => {
  try {
    const dbPath = path.join(__dirname, '..', 'data.sqlite');
    if (!fs.existsSync(dbPath)) {
      console.log('No data.sqlite found at', dbPath);
      process.exit(0);
    }

    // Safety: make an automatic backup before destructive action
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const bak = path.join(__dirname, '..', `data.sqlite.preclear.${ts}`);
    fs.copyFileSync(dbPath, bak);
    console.log('Created automatic backup at', bak);

    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    // Delete index content
    console.log('Deleting rows from postings, docs, queries...');
    await db.run('BEGIN');
    await db.run('DELETE FROM postings;');
    await db.run('DELETE FROM docs;');
    try { await db.run('DELETE FROM queries;'); } catch (e) { /* ignore if table missing */ }
    await db.run('COMMIT');

    // VACUUM to shrink the file
    console.log('Vacuuming database (this may take a moment)...');
    await db.run('VACUUM;');
    await db.close();

    // Report size
    const s = fs.statSync(dbPath);
    console.log('Cleared DB. New size:', (s.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('WAL/SHM files (if present) are not removed here. Remove them manually if desired.');
  } catch (e) {
    console.error('Clear failed:', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();