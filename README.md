# Simple Search Engine (prototype)

This repo contains a minimal Node.js search engine prototype with:

- `server.js`: Express server with `/crawl`, `/search`, `/status`
- `crawler.js`: simple crawler that fetches pages, extracts text and links
- `indexer.js`: in-memory inverted index and search

Quick start:

```bash
cd "c:\\Users\\ferry fernando\\Documents\\search engine\\search-engine"
npm install
npm start
```

Examples:

- Queue a crawl:

```bash
curl -X POST http://localhost:4000/crawl -H "Content-Type: application/json" -d '{"url":"https://example.com","depth":1}'
```

- Search:

```bash
curl 'http://localhost:4000/search?q=example'
```

Notes:

- This is a small prototype. For production you'd add persistence, politeness (robots.txt), rate-limiting, URL canonicalization, better ranking, and distributed components.
