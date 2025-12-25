(async ()=>{
  try{
    const { getDb } = require('./db');
    const db = await getDb();
    const N = (await db.get('SELECT COUNT(*) as c FROM docs')).c;
    const avg = (await db.get('SELECT AVG(len) as avglen FROM docs')).avglen;
    console.log('docs N=', N, 'avglen=', avg);
    const df = await db.get("SELECT COUNT(DISTINCT url) as df FROM postings WHERE term = 'youtube'");
    console.log('df youtube=', df && df.df);
    const sample = await db.get("SELECT url, tf FROM postings WHERE term = 'youtube' LIMIT 1");
    console.log('sample posting', sample);
    if (sample) {
      const d = await db.get('SELECT len FROM docs WHERE url = ?', [sample.url]);
      console.log('doc len', d && d.len);
    }
  }catch(e){ console.error('err', e); }
})();