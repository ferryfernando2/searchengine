const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const crawler = require('./crawler');
const indexer = require('./indexer');
const natural = require('natural');
const { getDb } = require('./db');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/crawl', async (req, res) => {
  const { url, depth = 1, render = false } = req.body || {};
  if (!url) return res.status(400).json({ error: 'missing url' });
  try {
    crawler.enqueue(url, { depth, render });
    return res.json({ status: 'queued', url });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// Auto-crawl control endpoints
app.post('/autocrawl/start', (req, res) => {
  const interval = parseInt(req.body && req.body.interval, 10) || undefined;
  const qth = parseInt(req.body && req.body.queueThreshold, 10) || undefined;
  try {
    crawler.startAutoCrawl(interval, qth);
    res.json({ status: 'started', intervalSec: interval, queueThreshold: qth });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/autocrawl/stop', (req, res) => {
  try {
    crawler.stopAutoCrawl();
    res.json({ status: 'stopped' });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/autocrawl/status', (req, res) => {
  try {
    res.json(crawler.autoCrawlStatus());
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const k1 = parseFloat(req.query.k1) || undefined;
    const b = parseFloat(req.query.b) || undefined;
    const limit = parseInt(req.query.limit || '20', 10) || 20;
    const opts = {};
    if (!isNaN(k1)) opts.k1 = k1;
    if (!isNaN(b)) opts.b = b;
    opts.limit = limit;
    if (req.query.lang) opts.lang = req.query.lang;
    if (req.query.type) opts.type = req.query.type;
    let results = await indexer.search(q, opts);

    // Log query for suggestion frequency (non-empty)
    try {
      if (q && q.trim()) {
        const db = await getDb();
        await db.run("INSERT INTO queries(q,cnt) VALUES(?,1) ON CONFLICT(q) DO UPDATE SET cnt = cnt + 1;", [q.toLowerCase().trim()]);
      }
    } catch (e) { /* ignore logging errors */ }

    // If no results, attempt auto-host discovery + crawl for single-token queries (typos mapped/fuzzy)
    if ((!results || results.length === 0) && q && q.trim().length > 0) {
      const raw = q.toLowerCase().trim();
      const tokens = raw.split(/\s+/).filter(Boolean);
      if (tokens.length === 1) {
        let single = tokens[0];
        const TYPO_MAP = { yt: 'youtube', ut: 'youtube', ytb: 'youtube', sp: 'spotify', depsek: 'deepseek' };
        if (TYPO_MAP[single]) single = TYPO_MAP[single];
        const KNOWN_HOSTS = ['youtube','spotify','deepseek','vimeo','reddit','twitter','flickr','twitch','deepernova'];
        if (!KNOWN_HOSTS.includes(single) && single.length >= 2) {
          // fuzzy match to known hosts using Levenshtein
          let best = null; let bestDist = Infinity;
          for (const k of KNOWN_HOSTS) {
            const d = natural.LevenshteinDistance(single, k);
            if (d < bestDist) { bestDist = d; best = k; }
          }
          if (bestDist <= 2) single = best;
        }

        // Check DB first
        const db = await getDb();
        const like = '%' + single + '%';
        const foundRow = await db.get('SELECT COUNT(*) as c FROM docs WHERE lower(url) LIKE ? OR lower(title) LIKE ? OR lower(text) LIKE ?', [like, like, like]);
        if (foundRow && foundRow.c > 0) {
          // re-run search now that DB has host matches
          results = await indexer.search(q, opts);
          return res.json({ query: q, results, note: 'matched existing host in index' });
        }

        // Not indexed yet - try enqueuing likely host variants and wait briefly for indexing
        const candidates = [];
        if (single.includes('.')) {
          candidates.push(single.startsWith('http') ? single : 'https://' + single);
        } else {
          candidates.push('https://' + single + '.com', 'https://www.' + single + '.com', 'https://' + single);
        }
        for (const c of candidates) {
          try { crawler.enqueue(c, { depth: 1, render: true }); } catch (e) {}
        }

        // Poll DB for up to 8 seconds for new docs matching host
        const timeoutMs = 8000; const start = Date.now(); let indexed = false;
        while (Date.now() - start < timeoutMs) {
          await new Promise(r => setTimeout(r, 1000));
          const chk = await db.get('SELECT COUNT(*) as c FROM docs WHERE lower(url) LIKE ? OR lower(title) LIKE ? OR lower(text) LIKE ?', [like, like, like]);
          if (chk && chk.c > 0) { indexed = true; break; }
        }
        if (indexed) {
          results = await indexer.search(q, opts);
          return res.json({ query: q, results, note: 'auto-crawled and indexed host' });
        }
        // If nothing found after timeout, fall through and return empty results plus note
        return res.json({ query: q, results: results || [], note: 'no results; attempted auto-crawl' });
      }
    }

    return res.json({ query: q, results });
  } catch (err) {
    console.error('Search error', err);
    return res.status(500).json({ error: String(err) });
  }
});

app.get('/suggest', async (req, res) => {
  try {
    const q = (req.query.q || '').toString();
    if (!q || q.trim().length === 0) return res.json({ query: q, suggestions: [] });
    const limit = parseInt(req.query.limit || '10', 10) || 10;
    const suggestions = await indexer.suggest(q, { limit });
    return res.json({ query: q, suggestions });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

app.get('/status', (req, res) => {
  res.json({
    queued: crawler.queueSize(),
    visited: crawler.visitedCount(),
    indexed: indexer.documentCount()
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Search server running on http://localhost:${PORT}`);
  // start auto-crawl on server boot unless explicitly disabled
  const autoEnabled = process.env.AUTOCRAWL_ENABLED !== 'false';
  if (autoEnabled && crawler && typeof crawler.startAutoCrawl === 'function') {
    const interval = parseInt(process.env.AUTOCRAWL_INTERVAL || '60', 10);
    const qth = parseInt(process.env.AUTOCRAWL_QUEUE_THRESHOLD || '150', 10);
    crawler.startAutoCrawl(interval, qth);
    console.log('Auto-crawl started: interval', interval, 'sec, queueThreshold', qth);
  }
});
