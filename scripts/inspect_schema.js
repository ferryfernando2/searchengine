const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
(async () => {
  const db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
  const info = await db.all("PRAGMA table_info('docs')");
  console.log(info);
  await db.close();
})();
