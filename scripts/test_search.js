(async () => {
  try {
    const base = 'http://localhost:4000';
    console.log('Checking status...');
    let res = await fetch(base + '/status');
    console.log('status:', await res.text());

    console.log('Queueing https://example.com for crawl...');
    res = await fetch(base + '/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', depth: 0 })
    });
    console.log('enqueue response:', await res.text());

    console.log('Waiting 4 seconds for crawler...');
    await new Promise(r => setTimeout(r, 4000));

    console.log('Searching for "example"...');
    res = await fetch(base + '/search?q=example');
    const data = await res.json();
    console.log('search result:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Test script failed:', e);
    process.exit(1);
  }
})();
