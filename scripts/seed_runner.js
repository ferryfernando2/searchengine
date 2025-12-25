const axios = require('axios');

const SEEDS = [
  'https://example.com',
  'https://id.wikipedia.org/wiki/Ayam',
  'https://en.wikipedia.org/wiki/Chicken',
  'https://www.britannica.com/animal/chicken',
  'https://www.bbc.com/news',
  'https://www.cnn.com',
  'https://www.nytimes.com',
  'https://techcrunch.com',
  'https://medium.com',
  'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-an-unsorted-array',
  'https://github.com',
  'https://www.reddit.com',
  'https://news.ycombinator.com',
  'https://www.theguardian.com',
  'https://www.wikipedia.org',
  'https://www.healthline.com/nutrition/foods/chicken',
  'https://www.webmd.com/diet/ss/slideshow-healthiest-chicken-preparations',
  'https://en.wikipedia.org/wiki/Food',
  'https://en.wikipedia.org/wiki/Animal',
  'https://www.nationalgeographic.com/animals/birds/facts/chicken',
  'https://www.foodnetwork.com',
  'https://www.allrecipes.com',
  'https://www.cookinglight.com',
  'https://www.khanacademy.org',
  'https://www.bloomberg.com',
  'https://www.forbes.com',
  'https://www.nature.com',
  'https://www.sciencedaily.com',
];

const BASE = process.env.SEARCH_SERVER || 'http://localhost:4000';

async function enqueue(url) {
  try {
    const resp = await axios.post(`${BASE}/crawl`, { url, depth: 0, render: false }, { timeout: 10000 });
    console.log('enqueued', url, resp.data && resp.data.status ? resp.data.status : 'ok');
  } catch (e) {
    console.error('failed enqueue', url, (e && e.message) || e);
  }
}

async function run() {
  console.log('Seeding', SEEDS.length, 'URLs to', BASE);
  for (const u of SEEDS) {
    await enqueue(u);
    await new Promise(r => setTimeout(r, 300));
  }
  console.log('Done enqueuing seeds.');
}

run().catch(e => { console.error(e); process.exit(1); });
