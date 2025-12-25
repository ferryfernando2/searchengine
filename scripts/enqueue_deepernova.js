// Small helper to enqueue deepernova for immediate crawl
const crawler = require('../crawler');
(async () => {
  try {
    console.log('Enqueuing https://www.deepernova.com for crawl...');
    crawler.enqueue('https://www.deepernova.com', { depth: 1, render: true });
    console.log('Enqueued. Check /status and wait for indexed count to increase.');
  } catch (e) {
    console.error('Failed to enqueue:', e.message || e);
    process.exit(1);
  }
})();