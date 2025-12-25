const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
(async () => {
  const db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
  const info = await db.all("PRAGMA table_info('docs')");
  if (!info.some(c => c.name === 'image')) {
    console.log('Adding image column...');
    await db.exec("ALTER TABLE docs ADD COLUMN image TEXT;");
    console.log('Added image column');
  } else {
    console.log('image column already present');
  }
  await db.close();
})();
