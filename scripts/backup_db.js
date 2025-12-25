const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const dbPath = path.join(__dirname, '..', 'data.sqlite');
    if (!fs.existsSync(dbPath)) {
      console.log('No data.sqlite found at', dbPath);
      process.exit(0);
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(__dirname, '..', `data.sqlite.bak.${ts}`);
    fs.copyFileSync(dbPath, dest);
    // also copy wal/shm if present
    const wal = dbPath + '-wal';
    const shm = dbPath + '-shm';
    if (fs.existsSync(wal)) fs.copyFileSync(wal, dest + '.wal');
    if (fs.existsSync(shm)) fs.copyFileSync(shm, dest + '.shm');
    const s = fs.statSync(dest);
    console.log('Backup created:', dest, `(${(s.size/1024/1024).toFixed(2)} MB)`);
  } catch (e) {
    console.error('Backup failed:', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();