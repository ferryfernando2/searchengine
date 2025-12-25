let abortController = null
let debounceTimeout = null

async function search(q, signal) {
  const res = await fetch('/search?q=' + encodeURIComponent(q), { signal });
  return res.json();
}

const input = document.getElementById('q');
const btn = document.getElementById('btn');
const status = document.getElementById('status');
const resultsList = document.getElementById('results');

async function doSearch() {
  const q = input.value.trim();
  if (!q) {
    resultsList.innerHTML = '';
    status.textContent = '';
    return;
  }
  status.textContent = 'Searching...';
  resultsList.innerHTML = '';
  try {
    if (abortController) abortController.abort();
    abortController = new AbortController();
    const data = await search(q, abortController.signal);
    status.textContent = '';
    if (!data.results || data.results.length === 0) {
      resultsList.innerHTML = '<li>No results</li>';
      return;
    }
    for (const r of data.results) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = r.url;
      a.target = '_blank';
      a.className = 'title';
      a.textContent = r.title || r.url;
      li.appendChild(a);

      const urlDiv = document.createElement('div');
      urlDiv.className = 'url';
      urlDiv.textContent = r.url;
      li.appendChild(urlDiv);

      if (r.snippet) {
        const sn = document.createElement('div');
        sn.className = 'snippet';
        sn.textContent = r.snippet;
        li.appendChild(sn);
      }

      const scoreDiv = document.createElement('div');
      scoreDiv.className = 'score';
      scoreDiv.textContent = r.score ? r.score.toFixed(3) : '';
      li.appendChild(scoreDiv);

      resultsList.appendChild(li);
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      // request was aborted; ignore
      return
    }
    status.textContent = 'Error: ' + e.message;
  } finally {
    abortController = null;
  }
}

btn.addEventListener('click', doSearch);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
// Live search as you type (debounced)
input.addEventListener('input', () => {
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(doSearch, 250);
});
