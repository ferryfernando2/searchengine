const { getDb } = require('./db');
const natural = require('natural');
const stemmer = natural.PorterStemmer;
// Simple lightweight Indonesian stemmer (heuristic)
function stemIndo(token) {
  if (!token) return token;
  // handle common prefix patterns
  token = token.replace(/^meny([aiueo])/, 's$1');
  token = token.replace(/^men([aiueo])/, 't$1');
  token = token.replace(/^mem([aiueo])/, 'p$1');
  token = token.replace(/^(meng|men|mem|me|di|ke|se)/, '');
  // remove common suffixes
  token = token.replace(/(kan|i|nya|lah|kah)$/, '');
  return token;
}

const STOPWORDS = new Set([
  'the','is','at','which','on','and','a','an','of','to','in','for','with','that','this','it','as','are','was','were','be','by','or','from'
]);

const INDONESIAN_STOPWORDS = new Set([
  'yang','dan','di','ke','dari','dengan','untuk','pada','ini','itu','adalah','saat','juga','sebuah','oleh','saya','kamu','kami','atau','tidak','ada','apa','siapa','mengapa','bagaimana'
]);

function detectLanguage(text) {
  if (!text) return 'en';
  const lower = text.toLowerCase();
  let match = 0;
  for (const w of INDONESIAN_STOPWORDS) if (lower.includes(' ' + w + ' ') || lower.startsWith(w + ' ') ) match++;
  return match >= 1 ? 'id' : 'en';
}

function tokenize(text, lang) {
  const language = lang || detectLanguage(text);
  if (language === 'id') {
    return (text || '')
      .toLowerCase()
      .split(/[^a-z0-9áéíóúâêîôûäëïöüçñ]+/)
      .filter(Boolean)
      .map(t => t.trim())
      .filter(t => t && !INDONESIAN_STOPWORDS.has(t))
      .map(t => stemIndo(t));
  }
  // default English/token based path
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(t => t.trim())
    .filter(t => t && !STOPWORDS.has(t))
    .map(t => stemmer.stem(t));
}

async function addDocument(url, { title, text, image = null }) {
  const db = await getDb();
  const combined = (title || '') + ' ' + (text || '');
  const lang = detectLanguage(combined);
  const tokens = tokenize(combined, lang);
  const len = tokens.length;
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;

  try {
    await db.run('BEGIN');
    await db.run('INSERT OR REPLACE INTO docs(url,title,text,len,lang,image) VALUES(?,?,?,?,?,?)', [url, title, text, len, lang, image]);
    const insert = await db.prepare('INSERT OR REPLACE INTO postings(term,url,tf) VALUES(?,?,?)');
    for (const [term, freq] of Object.entries(tf)) {
      await insert.run(term, url, freq);
    }
    await insert.finalize();
    await db.run('COMMIT');
  } catch (e) {
    await db.run('ROLLBACK');
    throw e;
  }
}

// BM25 search
async function search(q, opts = { k1: 1.5, b: 0.75, limit: 20 }) {
  const db = await getDb();
  const terms = tokenize(q, opts.lang);
  if (terms.length === 0) return [];

  const Nrow = await db.get('SELECT COUNT(*) as c FROM docs');
  const N = Nrow ? Nrow.c : 0;
  if (N === 0) return [];
  const avgRow = await db.get('SELECT AVG(len) as avglen FROM docs');
  const avgdl = avgRow && avgRow.avglen ? avgRow.avglen : 1;

  // Ranking parameters with safe defaults
  const { k1 = 1.5, b = 0.75 } = opts || {};

  const scores = new Map();

  let debugCount = 0;
  for (const term of terms) {
    const dfRow = await db.get('SELECT COUNT(DISTINCT url) as df FROM postings WHERE term = ?', [term]);
    const df = dfRow ? dfRow.df : 0;
    if (df === 0) continue;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    let rows = [];
    if (opts && opts.lang) {
      rows = await db.all('SELECT p.url, p.tf FROM postings p JOIN docs d ON p.url = d.url WHERE p.term = ? AND d.lang = ?', [term, opts.lang]);
    } else {
      rows = await db.all('SELECT url, tf FROM postings WHERE term = ?', [term]);
    }
    for (const r of rows) {
      const doc = await db.get('SELECT len FROM docs WHERE url = ?', [r.url]);
      const dl = doc ? doc.len : avgdl;
      const tf = r.tf || 0;
      const denom = tf + k1 * (1 - b + b * (dl / avgdl));
      const score = idf * ((tf * (k1 + 1)) / (denom || 1));
      scores.set(r.url, (scores.get(r.url) || 0) + score);
    }
  }

  let ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.limit);

  let out = [];

  // Helper: detect if a URL is the canonical/root page for a host
  function isDomainRoot(u, host) {
    try {
      const uu = new URL(u);
      const h = uu.hostname.toLowerCase();
      if (!h.includes(host)) return false;
      const p = (uu.pathname || '').replace(/\/+$/, '');
      return p === '' || p === ''; // root path
    } catch (e) { return false }
  }

  // Helper: detect login/account pages
  function isLoginPage(u, title) {
    const s = ((u || '') + ' ' + (title || '')).toLowerCase();
    return /\b(login|sign[- ]?in|signin|masuk|auth|account|log[- ]?in)\b/.test(s);
  }

  // Order prim results: domain root(s) first, then login pages, then the rest (all sorted by score desc)
  function orderPrim(arr, host) {
    const domainRoots = arr.filter(d => isDomainRoot(d.url, host)).sort((a,b) => (b.score||0)-(a.score||0));
    const loginPages = arr.filter(d => !isDomainRoot(d.url, host) && isLoginPage(d.url, d.title)).sort((a,b) => (b.score||0)-(a.score||0));
    const rest = arr.filter(d => !isDomainRoot(d.url, host) && !isLoginPage(d.url, d.title)).sort((a,b) => (b.score||0)-(a.score||0));
    return [...domainRoots, ...loginPages, ...rest];
  }

  const rawQ = q.toLowerCase().trim();
  const qTermsRaw = rawQ.split(/\s+/).filter(Boolean);

  // If query is a single token that is a known media host, inject/promote host watch pages into ranking
  if (qTermsRaw.length === 1) {
    const single = qTermsRaw[0].toLowerCase();
    try {
      // site-specific strong boosts for well-known hosts
      if (single === 'youtube') {
        const hostRows = await db.all("SELECT url FROM docs WHERE url LIKE '%youtube.com/watch%' OR url LIKE '%youtu.be/%' OR title LIKE '%YouTube%' LIMIT ?", [opts.limit]);
        for (const hr of hostRows) {
          scores.set(hr.url, (scores.get(hr.url) || 0) + 10000);
        }
        ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.limit);
      } else if (single === 'vimeo') {
        const hostRows = await db.all("SELECT url FROM docs WHERE url LIKE '%vimeo.com/%' OR title LIKE '%Vimeo%' LIMIT ?", [opts.limit]);
        for (const hr of hostRows) {
          scores.set(hr.url, (scores.get(hr.url) || 0) + 8000);
        }
        ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.limit);
      } else {
        // Generic host/domain promotion: look for URLs or titles containing the token and boost them modestly
        const like = '%' + single + '%';
        const hostRows = await db.all("SELECT url FROM docs WHERE lower(url) LIKE ? OR lower(title) LIKE ? LIMIT ?", [like, like, opts.limit]);
        if (hostRows && hostRows.length) {
          for (const hr of hostRows) scores.set(hr.url, (scores.get(hr.url) || 0) + 5000);
          ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.limit);
        }
      }
    } catch (e) {
      // ignore
    }
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>\"']/g, function(c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function makeHighlightSnippet(text, terms) {
    if (!text) return '';
    const lower = text.toLowerCase();
    // build regex with longest terms first
    const parts = [...new Set(terms.filter(Boolean))].sort((a,b) => b.length - a.length).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (parts.length === 0) return escapeHtml(text.slice(0,300)) + (text.length>300? '...':'');
    const re = new RegExp('\\b(' + parts.join('|') + ')\\b','i');
    const m = lower.search(re);
    const idx = m === -1 ? 0 : m;
    const window = 120;
    const start = Math.max(0, idx - window);
    const end = Math.min(text.length, idx + window);
    let snippet = text.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';
    const escaped = escapeHtml(snippet);
    const highlightRe = new RegExp('(' + parts.join('|') + ')','ig');
    return escaped.replace(highlightRe, '<mark class="hl">$1</mark>');
  }

  for (const [url, score0] of ranked) {
    const doc = await db.get('SELECT title, text, lang, image FROM docs WHERE url = ?', [url]);
    let score = score0;
    const title = doc ? (doc.title || '') : '';
    const text = doc ? (doc.text || '') : '';
    const titleLower = title.toLowerCase();
    const image = doc ? doc.image : null;

    // Boosts for title matches and exact phrase matches
    if (rawQ && titleLower.includes(rawQ)) {
      score *= 1.8;
    } else if (qTermsRaw.length) {
      let titleMatchCount = 0;
      for (const t of qTermsRaw) if (titleLower.includes(t)) titleMatchCount++;
      if (titleMatchCount) score *= (1 + (0.35 * titleMatchCount));
    }
    if (rawQ && text.toLowerCase().includes(rawQ)) {
      score += 5.0;
    }

    // Domain/watch-page boosts for common media hosts (help surface video/watch pages)
    try {
      const uhost = (new URL(url)).hostname || '';
      const isYouTube = uhost.includes('youtube.com') || uhost.includes('youtu.be');
      const isVimeo = uhost.includes('vimeo.com');
      const isWatch = /\/watch\?/i.test(url) || /youtu\.be\//i.test(url);

      // If the user query explicitly mentions the host, strongly promote that host's results
      if (isYouTube && (rawQ.includes('youtube') || qTermsRaw.includes('youtube'))) {
        score *= 2.0;
      }
      if (isVimeo && (rawQ.includes('vimeo') || qTermsRaw.includes('vimeo'))) {
        score *= 1.6;
      }

      // Promote YouTube watch pages when the title matches the query (likely the video itself)
      if (isYouTube && isWatch) {
        if ((rawQ && titleLower.includes(rawQ)) || qTermsRaw.every(t => titleLower.includes(t))) {
          score *= 1.8;
        }
      }

      // Small boost when a doc has an image and query looks media-like
      if (image && (isYouTube || isVimeo)) score *= 1.2;
    } catch (e) {
      // ignore URL parse errors
    }

    // prefer docs that match all terms
    let matchedTerms = 0;
    for (const t of terms) {
      const r = await db.get('SELECT COUNT(*) as c FROM postings WHERE term = ? AND url = ?', [t, url]);
      if (r && r.c > 0) matchedTerms++;
    }
    if (terms.length > 0 && matchedTerms === terms.length) score *= 1.3;

    const snippet = makeHighlightSnippet(text, qTermsRaw.length ? qTermsRaw : terms);
    out.push({ url, title: doc ? doc.title : '', score, snippet, lang: doc ? doc.lang : null });
  }

  // If any query token looks like a domain (contains a dot), promote that host's documents to the top first.
  // Example: "youtube.com" or "www.youtube.com" will promote youtube host results.
  for (const t of qTermsRaw) {
    if (/\w+\.[a-z]{2,}/i.test(t)) {
      let host = t.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
      host = host.replace(/^www\./, '');
      try {
        const like = '%' + host + '%';
        const hostRows = await db.all('SELECT url FROM docs WHERE lower(url) LIKE ? OR lower(title) LIKE ? LIMIT ?', [like, like, opts.limit]);
        if (hostRows && hostRows.length) {
          let prim = out.filter(d => {
            try { const h = (new URL(d.url)).hostname.toLowerCase(); return h.includes(host); } catch (e) { return false }
          });
          prim = orderPrim(prim, host);
          const rest = out.filter(d => !prim.includes(d));
          out = [...prim, ...rest];
          return out;
        }
      } catch (e) { /* ignore */ }
    }
  }

  // General host discovery for tokens without explicit dot (cover worldwide domains)
  // If a query token (length>=3 and not a stopword) frequently appears in URLs/titles,
  // infer a host and promote that host's results (domain root, login, others).
  for (const t of qTermsRaw) {
    if (t.length < 3) continue;
    if (INDONESIAN_STOPWORDS.has(t) || STOPWORDS.has(t)) continue;
    try {
      const like = '%' + t + '%';
      const hostRows = await db.all('SELECT url FROM docs WHERE lower(url) LIKE ? OR lower(title) LIKE ? LIMIT 200', [like, like]);
      if (!hostRows || hostRows.length === 0) continue;
      const hostCount = {};
      for (const r of hostRows) {
        try {
          const h = (new URL(r.url)).hostname.toLowerCase().replace(/^www\./, '');
          hostCount[h] = (hostCount[h] || 0) + 1;
        } catch (e) { }
      }
      const hosts = Object.entries(hostCount).sort((a,b) => b[1]-a[1]);
      if (hosts.length === 0) continue;
      const [topHost, topCount] = hosts[0];
      const totalMatches = hostRows.length;
      // Promote when the top host is a strong signal (>=2 matches or >=50% of matches)
      if (topCount >= 2 || (topCount / totalMatches) >= 0.5) {
        let prim = out.filter(d => {
          try { const h = (new URL(d.url)).hostname.toLowerCase(); return h.includes(topHost); } catch (e) { return false }
        });
        if (prim && prim.length) {
          prim = orderPrim(prim, topHost);
          const rest = out.filter(d => !prim.includes(d));
          out = [...prim, ...rest];
          return out;
        }
      }
    } catch (e) { /* ignore */ }
  }

  // If the query explicitly mentions a domain/host (e.g., "deepernova"), prioritize that host's results first.
  // This also covers single-token host queries and mixed queries that include the host name.
  if (rawQ.includes('deepernova') || qTermsRaw.some(t => t.includes('deepernova') || t.includes('deepernova.com') || t.includes('www.deepernova'))) {
    try {
      let prim = out.filter(d => {
        try { return (new URL(d.url)).hostname.toLowerCase().includes('deepernova'); } catch (e) { return false }
      });
      if (prim && prim.length) {
        prim = orderPrim(prim, 'deepernova');
        const rest = out.filter(d => !prim.includes(d));
        out = [...prim, ...rest];
        // ensure we return early so deepernova domain results stay at the top
        return out;
      }
    } catch (e) { /* ignore errors and continue */ }
  }

  // If the query is a single token that looks like a host (e.g., "youtube"), prioritize that host's results.
  // Also support common short typos (e.g., 'yt' or 'ut' -> 'youtube') and fuzzy matching to known hosts.
  if (qTermsRaw.length === 1) {
    let single = qTermsRaw[0].toLowerCase();

    // common shorthand/typo map for very short queries
    const TYPO_MAP = { yt: 'youtube', ut: 'youtube', ytb: 'youtube', sp: 'spotify', sf: 'spotify' };
    if (TYPO_MAP[single]) single = TYPO_MAP[single];

    // known hosts for fuzzy matching
    const KNOWN_HOSTS = ['youtube','spotify','vimeo','reddit','twitter','flickr','twitch','deepernova'];
    if (!KNOWN_HOSTS.includes(single) && single.length >= 3) {
      let best = null; let bestDist = Infinity;
      for (const k of KNOWN_HOSTS) {
        const d = natural.LevenshteinDistance(single, k);
        if (d < bestDist) { bestDist = d; best = k; }
      }
      if (bestDist <= 2) single = best;
    }

    try {
      const like = '%' + single + '%';
      const hostRows = await db.all('SELECT url FROM docs WHERE lower(url) LIKE ? OR lower(title) LIKE ? LIMIT ?', [like, like, opts.limit]);
      if (hostRows && hostRows.length) {
        const hostSet = new Set(hostRows.map(r => r.url));
        let prim = out.filter(d => hostSet.has(d.url));
        prim = orderPrim(prim, single);
        const rest = out.filter(d => !hostSet.has(d.url));
        // place exact/matching-host docs deterministically at the very top (domain root -> login -> rest)
        out = [...prim, ...rest];
        return out;
      }

      // fallback: existing behaviour for well-known hosts (promote and reorder among prim)
      if (['youtube','vimeo','reddit','twitter','flickr'].includes(single)) {
        let prim = out.filter(d => {
          try { const h = (new URL(d.url)).hostname.toLowerCase(); return h.includes(single) || (single === 'youtube' && h.includes('youtu.be')); } catch (e) { return false }
        });
        const rest = out.filter(d => !prim.includes(d));
        // order prim with domain root first, login pages next, then others
        prim = orderPrim(prim, single);
        out = [...prim, ...rest];
      }
    } catch (e) {
      // ignore errors, fall through
    }
  }

  // Apply type filters if requested (images/news/video/location)
  if (opts && opts.type) {
    const t = (opts.type || '').toLowerCase();
    if (t === 'images' || t === 'image') {
      out = out.filter(d => d.image);
    } else if (t === 'video' || t === 'videos') {
      out = out.filter(d => {
        try {
          const h = (new URL(d.url)).hostname.toLowerCase();
          return h.includes('youtube') || h.includes('vimeo') || /\/watch\?/i.test(d.url) || /youtu\.be\//i.test(d.url);
        } catch (e) { return false }
      });
    } else if (t === 'news') {
      const NEWS_HOSTS = ['bbc.com','cnn.com','nytimes.com','theguardian.com','reuters.com','bloomberg.com','forbes.com','wsj.com'];
      out = out.filter(d => {
        try {
          const h = (new URL(d.url)).hostname.toLowerCase();
          return NEWS_HOSTS.some(n => h.includes(n)) || (d.title && /\bnews\b/i.test(d.title));
        } catch (e) { return false }
      });
    } else if (t === 'location' || t === 'locations') {
      const MAPS = ['google.com/maps','openstreetmap.org','mapquest.com','bing.com/maps'];
      out = out.filter(d => {
        try {
          const u = d.url.toLowerCase();
          return MAPS.some(m => u.includes(m)) || /\/maps|\/location|\/directions/.test(u) || /(address|near|route|directions)/i.test(d.snippet || d.title || '');
        } catch (e) { return false }
      });
    }
  }

  return out;
}

async function documentCount() {
  const db = await getDb();
  const row = await db.get('SELECT COUNT(*) as c FROM docs');
  return row ? row.c : 0;
}

// Suggest helper: return short list of suggestion strings based on prefix
async function suggest(q, opts = { limit: 10 }) {
  const db = await getDb();
  const raw = (q || '').toLowerCase().trim();
  const out = [];
  if (!raw) return out;
  const like = raw + '%';
  try {
    // Recent queries (full text matches)
    const recent = await db.all('SELECT q FROM queries WHERE lower(q) LIKE ? ORDER BY cnt DESC LIMIT ?', [like, opts.limit]);
    for (const r of recent) out.push(r.q);

    // Titles that start with the prefix (use original title text)
    const titles = await db.all('SELECT title FROM docs WHERE lower(title) LIKE ? AND title IS NOT NULL LIMIT ?', [like, opts.limit]);
    for (const t of titles) {
      if (t.title && !out.includes(t.title)) out.push(t.title);
    }

    // Stemmed terms suggestions from postings (terms are stored stemmed; present them as-is)
    const terms = await db.all('SELECT term, SUM(tf) as f FROM postings WHERE term LIKE ? GROUP BY term ORDER BY f DESC LIMIT ?', [like, opts.limit * 2]);
    for (const t of terms) {
      if (t.term && !out.includes(t.term)) out.push(t.term);
      if (out.length >= opts.limit) break;
    }

    // If still not many, try substring matches in titles
    if (out.length < opts.limit) {
      const more = await db.all('SELECT title FROM docs WHERE lower(title) LIKE ? LIMIT ?', ['%' + raw + '%', opts.limit]);
      for (const m of more) if (m.title && !out.includes(m.title)) { out.push(m.title); if (out.length >= opts.limit) break; }
    }

    return out.slice(0, opts.limit);
  } catch (e) {
    return out;
  }
}

module.exports = { addDocument, search, documentCount, suggest };
