const { spawn, exec } = require('child_process');
const open = require('open');

const dev = spawn('npm', ['run', 'dev'], { shell: true });
let opened = false;

dev.stdout.setEncoding('utf8');
dev.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (opened) return;
  if (chunk.includes('Local:') || chunk.includes('http://localhost') || chunk.includes('http://127.0.0.1')) {
    const m = chunk.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?/);
    const url = m ? m[0] : 'http://localhost:5173/';
    opened = true;
    (async () => {
      try {
        await open(url, { app: { name: 'chrome' } });
      } catch (e) {
        try {
          await open(url);
        } catch (e2) {
          exec(`start "" "chrome" "${url}"`);
        }
      }
    })();
  }
});

dev.stderr.pipe(process.stderr);
dev.on('close', (code) => process.exit(code));
