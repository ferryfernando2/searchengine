const sites = [
  'https://www.google.com','https://www.youtube.com','https://twitter.com','https://www.facebook.com','https://www.instagram.com','https://www.linkedin.com','https://www.reddit.com','https://news.ycombinator.com','https://www.bbc.com','https://www.cnn.com','https://www.nytimes.com','https://www.theguardian.com','https://en.wikipedia.org','https://stackoverflow.com','https://github.com','https://medium.com','https://techcrunch.com','https://www.forbes.com','https://www.bloomberg.com','https://www.nature.com','https://www.sciencedaily.com','https://www.healthline.com','https://www.webmd.com','https://www.allrecipes.com','https://www.foodnetwork.com','https://www.nationalgeographic.com','https://www.khanacademy.org','https://www.spotify.com','https://www.apple.com','https://www.microsoft.com','https://www.amazon.com','https://www.ebay.com','https://www.npr.org','https://www.wsj.com','https://dev.to','https://www.coursera.org','https://www.edx.org','https://www.stackexchange.com','https://www.quora.com','https://www.wired.com'
];

(async () => {
  for (const s of sites) {
    try {
      const res = await fetch('http://localhost:4000/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: s, depth: 1, render: true })
      });
      if (res.ok) {
        console.log('enqueued', s);
      } else {
        console.log('failed', s, res.status);
      }
    } catch (err) {
      console.log('error', s, err.message);
    }
  }
})();
