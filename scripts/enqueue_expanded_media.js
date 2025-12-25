const sites = [
  { url: 'https://www.youtube.com', depth: 3, render: true },
  { url: 'https://www.reddit.com', depth: 2, render: true },
  { url: 'https://twitter.com', depth: 2, render: true },
  { url: 'https://vimeo.com', depth: 2, render: true }
];

(async () => {
  for (const s of sites) {
    try {
      const res = await fetch('http://localhost:4000/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s)
      });
      if (res.ok) console.log('enqueued', s.url); else console.log('failed', s.url, res.status);
    } catch (e) {
      console.log('error', s.url, e.message);
    }
  }
})();
