const sites = [
  'https://www.youtube.com',
  'https://youtu.be',
  'https://vimeo.com',
  'https://www.reddit.com',
  'https://twitter.com',
  'https://www.flickr.com',
  'https://www.instagram.com',
  'https://www.tiktok.com'
];

(async () => {
  for (const s of sites) {
    try {
      const res = await fetch('http://localhost:4000/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: s, depth: 1, render: true })
      });
      if (res.ok) console.log('enqueued', s); else console.log('failed', s, res.status);
    } catch (e) {
      console.log('error', s, e.message);
    }
  }
})();
