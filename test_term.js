(async ()=>{
  const idx = require('./indexer');
  const r = await idx.search('Waymos', { limit: 20 });
  console.log('results:', r.map(x => ({url: x.url, score: x.score})).slice(0,20));
})();