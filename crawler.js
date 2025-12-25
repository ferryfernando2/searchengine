const axios = require('axios');
const cheerio = require('cheerio');
const indexer = require('./indexer');
const { URL } = require('url');
const robotsParser = require('robots-parser');
const { getDb } = require('./db');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (e) {}

// Basic oEmbed provider map for popular media sites
const OEMBED_PROVIDERS = {
  'www.youtube.com': (u) => `https://www.youtube.com/oembed?url=${encodeURIComponent(u)}&format=json`,
  'youtu.be': (u) => `https://www.youtube.com/oembed?url=${encodeURIComponent(u)}&format=json`,
  'vimeo.com': (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`,
  'www.reddit.com': (u) => `https://www.reddit.com/oembed?url=${encodeURIComponent(u)}`,
  'twitter.com': (u) => `https://publish.twitter.com/oembed?url=${encodeURIComponent(u)}`,
  'www.flickr.com': (u) => `https://www.flickr.com/services/oembed?url=${encodeURIComponent(u)}&format=json`
};

async function tryOEmbed(url) {
  try {
    const p = new URL(url).hostname.toLowerCase();
    const fn = OEMBED_PROVIDERS[p];
    if (!fn) return null;
    const endpoint = fn(url);
    const resp = await axios.get(endpoint, { timeout: 8000, headers: { 'User-Agent': 'SimpleSearchBot/1.0' } });
    if (resp && resp.data) {
      const d = resp.data;
      const title = d.title || d.author_name || '';
      const text = (d.author_name ? d.author_name + ' - ' : '') + (d.description || d.html || d.title || '');
      const image = d.thumbnail_url || d.url || null;
      return { title, text, image };
    }
  } catch (e) {
    // ignore oEmbed failures
  }
  return null;
}

const concurrency = 2;
const queue = [];
let active = 0;
const visited = new Set();
const hostLastRequest = new Map();
const robotsCache = new Map();
const hostPageCount = new Map();
const MAX_PAGES_PER_HOST = parseInt(process.env.MAX_PAGES_PER_HOST || '300', 10);


function enqueue(url, opts = { depth: 1, render: false }) {
  const n = normalize(url);
  if (visited.has(n)) return;
  queue.push({ url: n, depth: opts.depth, render: opts.render });
  processQueue();
}

function queueSize() {
  return queue.length;
}

function visitedCount() {
  return visited.size;
}

function normalize(u) {
  try {
    return new URL(u).toString();
  } catch (e) {
    return u;
  }
}

async function fetchRobots(baseUrl) {
  try {
    const robotsUrl = new URL('/robots.txt', baseUrl).toString();
    if (robotsCache.has(robotsUrl)) return robotsCache.get(robotsUrl);
    const resp = await axios.get(robotsUrl, { timeout: 5000, headers: { 'User-Agent': 'SimpleSearchBot/1.0' } });
    const rp = robotsParser(robotsUrl, resp.data);
    robotsCache.set(robotsUrl, rp);
    return rp;
  } catch (e) {
    return robotsParser('', '');
  }
}

async function waitForPoliteness(url) {
  try {
    const u = new URL(url);
    const host = u.host;
    const last = hostLastRequest.get(host) || 0;
    const now = Date.now();
    const minDelay = 1000; // 1s default politeness
    const wait = Math.max(0, minDelay - (now - last));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    hostLastRequest.set(host, Date.now());
  } catch (e) {}
}

async function processQueue() {
  if (active >= concurrency) return;
  const job = queue.shift();
  if (!job) return;
  active++;
  try {
    await crawl(job.url, job.depth, job.render);
  } catch (e) {
    console.error('crawl error', e.message || e);
  } finally {
    active--;
    setImmediate(processQueue);
  }
}

function findChromeExecutable() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath) return envPath;
  // common Windows install locations
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  const fs = require('fs');
  for (const p of paths) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  return null;
}

async function renderWithPuppeteer(url) {
  if (!puppeteer) throw new Error('puppeteer-core not installed');
  const executablePath = findChromeExecutable();
  if (!executablePath) throw new Error('No Chrome/Chromium executable found. Set PUPPETEER_EXECUTABLE_PATH to your browser path.');
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('SimpleSearchBot/1.0');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

async function crawl(startUrl, depth = 1, render = false) {
  const url = normalize(startUrl);
  if (visited.has(url) || depth < 0) return;
  visited.add(url);
  try { const h = (new URL(url)).host; hostPageCount.set(h, (hostPageCount.get(h) || 0) + 1); } catch(e){}
  console.log('Crawling', url);
  try {
    const rp = await fetchRobots(url);
    if (!rp.isAllowed(url, 'SimpleSearchBot')) {
      console.log('Disallowed by robots:', url);
        // try oEmbed as an alternate (some providers allow oEmbed even when page is script-heavy)
        const embed = await tryOEmbed(url);
        if (embed) {
          console.log('Indexed via oEmbed (robots disallow):', url);
          await indexer.addDocument(url, { title: embed.title, text: embed.text, image: embed.image });
        }
        return;
      }
      await waitForPoliteness(url);
      let html = null;
      let $ = null;
      let image = null;
      try {
        const resp = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'SimpleSearchBot/1.0' } });
        html = resp.data;
      } catch (e) {
        // try oEmbed if axios failed
        console.warn('axios failed for', url, e.message || e);
        const embedFallback = await tryOEmbed(url);
        if (embedFallback) {
          console.log('Indexed via oEmbed (axios failed):', url);
          await indexer.addDocument(url, { title: embedFallback.title, text: embedFallback.text, image: embedFallback.image });
          return;
        }
      }
    let text = $ ? $('body').text().replace(/\s+/g, ' ').trim() : '';
    const minimalText = (text || '').length < 200;
    if ((render || minimalText) && puppeteer) {
      try {
        console.log('Rendering with Puppeteer:', url);
        const rendered = await renderWithPuppeteer(url);
        $ = cheerio.load(rendered);
        text = $('body').text().replace(/\s+/g, ' ').trim();
        html = rendered;
      } catch (e) {
        console.warn('Puppeteer render failed for', url, e.message || e);
      }
    }

    // Try to extract main article content using Readability
    try {
      const dom = new JSDOM(html || '', { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (article && article.textContent && article.textContent.trim().length > 120) {
        text = article.textContent.replace(/\s+/g, ' ').trim();
        // prefer title from article if available
        if (article.title && article.title.trim().length > 0) $ = cheerio.load('<title>' + article.title + '</title><body>' + article.content + '</body>');
        // attempt to use article's lead image if present
        if (article.lead_image_url) image = (new URL(article.lead_image_url, url)).toString();
      }
    } catch (e) {
      // ignore readability failures
    }

    if (!$ && html) $ = cheerio.load(html);
    const title = $('title').text() || url;

    // try meta og:image or twitter:image
    // reuse `image` variable declared earlier
    image = null;
    try {
      const og = $('meta[property="og:image"]').attr('content') || $('meta[name="og:image"]').attr('content');
      const tw = $('meta[name="twitter:image"]').attr('content') || $('meta[property="twitter:image:src"]').attr('content');
      const linkImg = $('link[rel="image_src"]').attr('href');
      const imgFromMeta = og || tw || linkImg;
      if (imgFromMeta) {
        try { image = (new URL(imgFromMeta, url)).toString(); } catch (e) { image = imgFromMeta }
      }
    } catch (e) {}

    // fallback: first image in article content
    try {
      if (!image) {
        const firstImg = $('article img[src], body img[src]').first().attr('src');
        if (firstImg) {
          try { image = (new URL(firstImg, url)).toString(); } catch (e) { image = firstImg }
        }
      }
    } catch (e) {}

    // --- New: index images found on the page as first-class documents ---
    try {
      const imgEls = $('article img[src], article figure img[src], body img[src]');
      const seen = new Set();
      const MAX_IMAGES_PER_PAGE = 20;
      let imgCount = 0;
      for (let i = 0; i < imgEls.length && imgCount < MAX_IMAGES_PER_PAGE; i++) {
        const el = imgEls[i];
        const src = $(el).attr('src');
        if (!src || src.startsWith('data:')) continue;
        let imgUrl = null;
        try { imgUrl = (new URL(src, url)).toString(); } catch (e) { continue }
        if (seen.has(imgUrl)) continue;
        seen.add(imgUrl);
        // Heuristics: skip obvious UI/assets
        if (/\b(spr(ite)?|icon|logo|spinner|thumb|pixel)\b/i.test(imgUrl)) continue;
        // Prefer images with extension or common img patterns
        if (!/\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i.test(imgUrl) && imgCount > 6) continue;

        const alt = $(el).attr('alt') || $(el).attr('title') || '';
        const captionEl = $(el).closest('figure').find('figcaption').text() || '';
        const imageText = (alt ? alt + ' ' : '') + (captionEl ? captionEl + ' ' : '') + (title || '');
        try {
          // index image as its own document so image searches return the image resource
          await indexer.addDocument(imgUrl, { title: alt || title || imgUrl, text: imageText.trim(), image: imgUrl });
          imgCount++;
          // optional: small delay to avoid DB contention
        } catch (e) {
          // ignore individual image indexing errors
        }
      }
    } catch (e) {
      console.warn('Image extraction failed for', url, e.message || e);
    }

    // Skip indexing very low-content pages to avoid noisy results
    if ((text || '').length < 100) {
      console.log('Skipping low-content page:', url);
    } else {
      await indexer.addDocument(url, { title, text, image });
    }

    if (depth > 0) {
      const links = [];
      $('a[href]').each((i, el) => {
        let href = $(el).attr('href');
        if (!href) return;
        try {
          const absolute = new URL(href, url).toString();
          links.push(absolute);
        } catch (e) {
        }
      });
      for (const l of links) {
        if (visited.has(l)) continue;
        try {
          const host = (new URL(l)).host;
          const count = hostPageCount.get(host) || 0;
          if (count >= MAX_PAGES_PER_HOST) continue;
          enqueue(l, { depth: depth - 1, render: false });
        } catch (e) {}
      }
    }
  } catch (e) {
    console.error('Failed fetching', url, e.message || e);
  }
}

// Auto-crawl scheduler
let _autoInterval = null;
let _autoSettings = { intervalSec: parseInt(process.env.AUTOCRAWL_INTERVAL || '60', 10), queueThreshold: parseInt(process.env.AUTOCRAWL_QUEUE_THRESHOLD || '150', 10) };

async function loadSeeds() {
  try {
    const fs = require('fs');
    const p = require('path').join(__dirname, 'scripts', 'seeds.json');
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {}
  return [];
}

async function autoCrawlOnce() {
  try {
    // If queue is full enough, skip
    if (queue.length >= _autoSettings.queueThreshold) return;
    const seeds = await loadSeeds();
    if (seeds.length === 0) return;
    // enqueue a subset of seeds
    const sample = seeds.slice(0, Math.min(12, seeds.length));
    for (const s of sample) {
      if (!visited.has(s)) enqueue(s, { depth: 1, render: true });
    }
    // re-enqueue some visited urls for freshness
    const visitedArr = Array.from(visited);
    for (let i=0;i<8 && visitedArr.length;i++) {
      const idx = Math.floor(Math.random() * visitedArr.length);
      const u = visitedArr[idx];
      enqueue(u, { depth: 0, render: false });
    }
  } catch (e) {
    console.warn('autocrawl error', e.message || e);
  }
}

function startAutoCrawl(intervalSec, queueThreshold) {
  if (_autoInterval) return; // already running
  if (intervalSec) _autoSettings.intervalSec = intervalSec;
  if (queueThreshold) _autoSettings.queueThreshold = queueThreshold;
  _autoInterval = setInterval(autoCrawlOnce, _autoSettings.intervalSec * 1000);
  // do one immediately
  autoCrawlOnce();
}

function stopAutoCrawl() {
  if (_autoInterval) {
    clearInterval(_autoInterval);
    _autoInterval = null;
  }
}

function autoCrawlStatus() {
  return { running: !!_autoInterval, intervalSec: _autoSettings.intervalSec, queueThreshold: _autoSettings.queueThreshold };
}

module.exports = { enqueue, queueSize, visitedCount, startAutoCrawl, stopAutoCrawl, autoCrawlStatus };
