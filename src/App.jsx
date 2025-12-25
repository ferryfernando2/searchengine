import { useState, useEffect, useRef } from 'react'
import './App.css'
import logo from './assets/logo.svg'

function App() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('')
  const [lang, setLang] = useState('auto')
  const [searchType, setSearchType] = useState('all')
  const [isLoading, setIsLoading] = useState(false)
  const [showLangMenu, setShowLangMenu] = useState(false)
  const [bgImage, setBgImage] = useState('')

  // Helper: derive a poster for common video URLs (YouTube/Vimeo) or fallback to provided image
  function getVideoThumb(url, fallback) {
    try {
      if (fallback) return fallback;
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      if (host.includes('youtube.com')) {
        const m = u.searchParams.get('v'); if (m) return `https://img.youtube.com/vi/${m}/hqdefault.jpg`; 
      }
      if (host.includes('youtu.be')) {
        const id = u.pathname.slice(1); if (id) return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
      }
      // Vimeo thumbnails require API; fallback to generic image placeholder
      return fallback || 'https://via.placeholder.com/480x270?text=Video';
    } catch (e) {
      return fallback || 'https://via.placeholder.com/480x270?text=Video';
    }
  }
  const [bgImageLoaded, setBgImageLoaded] = useState(false)
  const [bgCredit, setBgCredit] = useState({ name: '', url: '' })
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('deepernova-theme')
    if (saved) return saved === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  // Suggestions / Typeahead
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const suggestTimeoutRef = useRef(null)
  const suggestionsRef = useRef(null)

  // API base (configurable) - prefer same-page protocol to avoid mixed-content errors.
  // If the page is served over HTTPS but the API is only HTTP, browser will block requests.
  let defaultApiBase;
  try {
    const remoteHost = '72.61.214.24:4000'
    const pageProto = window.location && window.location.protocol ? window.location.protocol : 'http:'
    // If the page is served over HTTPS (e.g., Vercel), use the local proxy at /api
    // so the browser does not block mixed-content (HTTPS page -> HTTP API).
    if (pageProto === 'https:') {
      defaultApiBase = '/api'
    } else {
      defaultApiBase = `${pageProto}//${remoteHost}`
    }
  } catch (e) {
    defaultApiBase = 'http://72.61.214.24:4000'
  }
  const [apiBase, setApiBase] = useState(() => localStorage.getItem('apiBase') || defaultApiBase)
  const [apiStatus, setApiStatus] = useState(null) // 'ok' | 'error' | null

  useEffect(() => {
    localStorage.setItem('apiBase', apiBase || '')
  }, [apiBase])

  function buildApiUrl(path) {
    if (!path) path = '/'
    if (!path.startsWith('/')) path = '/' + path
    if (!apiBase) return path
    return apiBase.replace(/\/+$/,'') + path
  }

  async function pingApi() {
    if (!apiBase) { setApiStatus(null); return false }
    try {
      const res = await fetch(buildApiUrl('/status'))
      if (res.ok) { setApiStatus('ok'); return true }
    } catch (e) {}
    setApiStatus('error');
    return false
  }


  const langMenuRef = useRef(null)
  const searchTimeoutRef = useRef(null)
  const abortCtrlRef = useRef(null)

  // Close language menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target)) {
        setShowLangMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    localStorage.setItem('deepernova-theme', isDark ? 'dark' : 'light')
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  // Fetch random background image
  useEffect(() => {
    const fetchBackgroundImage = async () => {
      try {
        // Get viewport dimensions for optimal image size
        const width = window.innerWidth
        const height = window.innerHeight
        
        // Use Picsum Photos with dynamic dimensions
        const imageUrl = `https://picsum.photos/${width}/${height}?random=${Date.now()}`
        
        // Try to get photographer info from API
        try {
          const response = await fetch('https://picsum.photos/v2/list?limit=1')
          const data = await response.json()
          if (data && data.length > 0) {
            const photo = data[0]
            setBgCredit({ 
              name: photo.author || 'Unknown Photographer', 
              url: photo.url || `https://picsum.photos/${photo.id}` 
            })
          }
        } catch (err) {
          console.log('Could not fetch photo metadata, using default')
        }

        // Preload the image
        const img = new Image()
        img.onload = () => {
          setBgImageLoaded(false)
          setTimeout(() => {
            setBgImage(imageUrl)
            setBgImageLoaded(true)
          }, 50)
        }
        img.onerror = () => {
          // Fallback to generic image
          const fallbackUrl = `https://picsum.photos/${width}/${height}?random=fallback`
          setBgImageLoaded(false)
          setTimeout(() => {
            setBgImage(fallbackUrl)
            setBgImageLoaded(true)
          }, 50)
        }
        img.src = imageUrl
      } catch (err) {
        console.error('Failed to fetch background image:', err)
        // Use default gradient background
        setBgImage('')
        setBgCredit({ name: '', url: '' })
        setBgImageLoaded(true)
      }
    }
    
    // Fetch initial background
    fetchBackgroundImage()
    
    // Update background on resize
    const handleResize = () => {
      fetchBackgroundImage()
    }
    
    // Rotate background every 3 minutes
    const interval = setInterval(fetchBackgroundImage, 180000)
    window.addEventListener('resize', handleResize)
    
    return () => {
      clearInterval(interval)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  // Trigger search automatically as user types (debounced)
  useEffect(() => {
    const query = q.trim()
    if (!query) {
      setResults([])
      setStatus('')
      return
    }
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      doSearch()
    }, 350)
    
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [q, lang])

  // Fetch suggestions for typeahead (debounced)
  async function fetchSuggestions(query) {
    if (!query || !query.trim()) {
      setSuggestions([])
      setShowSuggestions(false)
      setHighlightIndex(-1)
      return
    }
    try {
      const url = buildApiUrl(`/suggest?q=${encodeURIComponent(query)}&limit=8`);
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const s = data.suggestions || [];
      setSuggestions(s);
      setShowSuggestions(s.length > 0);
      setHighlightIndex(-1);
    } catch (e) {
      // ignore
    }
  }

  function scheduleSuggestions(query) {
    if (suggestTimeoutRef.current) clearTimeout(suggestTimeoutRef.current);
    suggestTimeoutRef.current = setTimeout(() => fetchSuggestions(query), 200);
  }

  // Click outside to hide suggestions
  useEffect(() => {
    function onClick(e) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [])

  // Ping API when apiBase changes
  useEffect(() => {
    if (apiBase) pingApi();
  }, [apiBase])

  async function doSearch() {
    const query = q.trim()
    if (!query) {
      setResults([])
      setStatus('')
      return
    }
    
    setStatus('')
    setIsLoading(true)
    
    try {
      // Abort any previous request
      if (abortCtrlRef.current) {
        abortCtrlRef.current.abort()
      }
      
      const controller = new AbortController()
      abortCtrlRef.current = controller

      let path = `/search?q=${encodeURIComponent(query)}`
      if (lang !== 'auto') path += `&lang=${encodeURIComponent(lang)}`
      if (searchType && searchType !== 'all') path += `&type=${encodeURIComponent(searchType)}`
      const url = buildApiUrl(path)
      const res = await fetch(url, { signal: controller.signal })
      
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        setStatus('Server error: ' + (txt || res.status))
        setResults([])
        return
      }
      
      let data = null
      try { 
        data = await res.json() 
      } catch (e) {
        const txt = await res.text().catch(() => '')
        setStatus('Invalid JSON from server: ' + (txt || e.message))
        setResults([])
        return
      }
      
      setResults(data.results || [])
      setStatus('')
    } catch (e) {
      if (e.name === 'AbortError') {
        return
      }
      setStatus('Error: ' + e.message)
    } finally {
      setIsLoading(false)
      abortCtrlRef.current = null
    }
  }

  // Check if we should show background (no search results and no query)
  const showBackground = results.length === 0 && !isLoading && q === ''

  return (
    <div className="deepernova-root">
      {/* Background Image Container */}
      <div 
        className={`background-container ${showBackground ? 'visible' : 'hidden'}`}
        style={{ 
          backgroundImage: bgImage ? `url('${bgImage}')` : 'none',
          opacity: bgImageLoaded ? 1 : 0
        }}
      >
        <div className="bg-overlay" />
        {bgCredit.name && (
          <div className="bg-credit">
            <span className="credit-text">Photo by <strong>{bgCredit.name}</strong></span>
            {bgCredit.url && (
              <a 
                href={bgCredit.url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="credit-btn" 
                title="View photographer"
                aria-label="View photographer"
              >
                <svg className="info-icon" viewBox="0 0 24 24" fill="none">
                  <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 16V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 8H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </a>
            )}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="main-content-wrapper">
        <header className="app-header">
          <div className="header-content">
            <div 
              className="theme-toggle-btn" 
              onClick={() => setIsDark(!isDark)} 
              title={isDark ? 'Light mode' : 'Dark mode'} 
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? '☀️' : '🌙'}
            </div>
            
            <div className="logo-section">
              <div className="logo-row">
                <div className="lang-selector-wrapper" ref={langMenuRef}>
                  <button 
                    className="lang-flag-btn" 
                    onClick={() => setShowLangMenu(!showLangMenu)}
                    title="Select language"
                    aria-label="Select language"
                    aria-expanded={showLangMenu}
                  >
                    {lang === 'auto' ? '🌐' : lang === 'id' ? '🇮🇩' : '🇺🇸'}
                    <span className="lang-text">{lang === 'auto' ? 'Auto' : lang === 'id' ? 'ID' : 'EN'}</span>
                    <span className="chevron">{showLangMenu ? '▲' : '▼'}</span>
                  </button>
                  
                  {showLangMenu && (
                    <div className="lang-menu">
                      <button 
                        className={`lang-option ${lang === 'auto' ? 'active' : ''}`}
                        onClick={() => { setLang('auto'); setShowLangMenu(false); }}
                      >
                        <span className="flag">🌐</span>
                        <span className="option-text">
                          <span className="option-title">Auto Detect</span>
                          <span className="option-subtitle">Detect language automatically</span>
                        </span>
                      </button>
                      <button 
                        className={`lang-option ${lang === 'id' ? 'active' : ''}`}
                        onClick={() => { setLang('id'); setShowLangMenu(false); }}
                      >
                        <span className="flag">🇮🇩</span>
                        <span className="option-text">
                          <span className="option-title">Indonesia</span>
                          <span className="option-subtitle">Search in Indonesian</span>
                        </span>
                      </button>
                      <button 
                        className={`lang-option ${lang === 'en' ? 'active' : ''}`}
                        onClick={() => { setLang('en'); setShowLangMenu(false); }}
                      >
                        <span className="flag">🇺🇸</span>
                        <span className="option-text">
                          <span className="option-title">English</span>
                          <span className="option-subtitle">Search in English</span>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
                {/* API connection UI removed — requests will go to configured server */}
              </div>
              
              {showBackground && (
                <>
                  <div className="dn-logo" aria-hidden>
                    {['D','e','e','p','e','r','n','o','v','a'].map((ch, i) => (
                      <span key={i} className={`dn-letter dn-letter-${i}`}>{ch}</span>
                    ))}
                  </div>
                  <div className="dn-tagline">Inspiration of Indonesian Technology</div>
                </>
              )}
            </div> 
          </div>
        </header>

        <main className="main-content">
          <div className={`search-container ${!showBackground ? 'wide' : ''}`}>
            <div className="search-wrapper">
              <div className={`search-box ${showBackground ? 'with-background' : ''}`}>
                <div className="input-wrapper">
                  <input
                    value={q}
                    onChange={(e) => { setQ(e.target.value); scheduleSuggestions(e.target.value); }}
                    onKeyDown={(e) => {
                      if (showSuggestions) {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIndex(i => Math.min(i + 1, suggestions.length - 1)); return; }
                        if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIndex(i => Math.max(i - 1, 0)); return; }
                        if (e.key === 'Enter') {
                          if (highlightIndex >= 0 && suggestions[highlightIndex]) {
                            e.preventDefault(); const sel = suggestions[highlightIndex]; setQ(sel); setShowSuggestions(false); doSearch(); return;
                          }
                          doSearch();
                          return;
                        }
                        if (e.key === 'Escape') { setShowSuggestions(false); return; }
                      } else {
                        if (e.key === 'Enter') doSearch();
                      }
                    }}
                    placeholder="What would you like to search?"
                    autoFocus
                    className="search-input"
                    aria-autocomplete="list"
                    aria-expanded={showSuggestions}
                    aria-controls="suggestions-list"
                    aria-activedescendant={highlightIndex >= 0 ? `sugg-${highlightIndex}` : undefined}
                  />
                  <div ref={suggestionsRef} id="suggestions-list" className={`suggestions-dropdown ${showSuggestions ? 'visible' : ''}`} role="listbox">
                    {suggestions.map((s, idx) => (
                      <div
                        key={s + idx}
                        id={`sugg-${idx}`}
                        role="option"
                        aria-selected={highlightIndex === idx}
                        className={`suggestion-item ${highlightIndex === idx ? 'highlight' : ''}`}
                        onMouseEnter={() => setHighlightIndex(idx)}
                        onMouseDown={(e) => { e.preventDefault(); setQ(s); setShowSuggestions(false); doSearch(); }}
                      >{s}</div>
                    ))}
                  </div>
                  <button 
                    className="search-btn" 
                    onClick={doSearch} 
                    disabled={isLoading}
                    aria-label="Search"
                  >
                    {isLoading ? (
                      <div className="spinner"></div>
                    ) : (
                      <svg className="search-icon" viewBox="0 0 24 24" fill="none">
                        <path d="M21 21L15 15M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                </div>
                <div className="search-controls">
                  <div className="search-controls-label">Search in:</div>
                  <div className="search-controls-buttons" role="tablist" aria-label="Search type">
                    {['all','images','news','video','location'].map((t) => (
                      <button
                        key={t}
                        className={`search-control ${searchType === t ? 'active' : ''}`}
                        onClick={() => setSearchType(t)}
                        aria-pressed={searchType === t}
                        type="button"
                      >
                        {t === 'all' ? 'All' : t === 'images' ? 'Images' : t === 'news' ? 'News' : t === 'video' ? 'Video' : 'Location'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {status && (
            <div className="status-message">
              <div className="status-content">{status}</div>
            </div>
          )}

          <div className="results-container">
            {isLoading ? (
              <div className="skeleton-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton-card">
                    <div className="skeleton-thumbnail"></div>
                    <div className="skeleton-content">
                      <div className="skeleton-title"></div>
                      <div className="skeleton-url"></div>
                      <div className="skeleton-text"></div>
                      <div className="skeleton-text short"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : results.length > 0 ? (
              searchType === 'images' ? (
                <div className="image-grid">
                  {results.map((r) => (
                    <a key={r.url} className="image-card" href={r.url} target="_blank" rel="noreferrer noopener">
                      <img src={r.url} alt={r.title || ''} loading="lazy" />
                      <div className="image-caption">{r.title}</div>
                    </a>
                  ))}
                </div>
              ) : searchType === 'video' ? (
                /* Video results: show thumbnail with play overlay and title */
                <div className="video-grid">
                  {results.map((r) => (
                    <a key={r.url} className="video-card" href={r.url} target="_blank" rel="noreferrer noopener">
                      <div className="video-thumb-wrap">
                        <img
                          src={getVideoThumb(r.url, r.image)}
                          alt={r.title || ''}
                          loading="lazy"
                        />
                        <div className="play-overlay">▶</div>
                      </div>
                      <div className="video-caption">{r.title}</div>
                    </a>
                  ))}
                </div>
              ) : searchType === 'news' ? (
                /* News results: compact list with source badge */
                <div className="news-list">
                  {results.map((r) => (
                    <a key={r.url} className="news-item" href={r.url} target="_blank" rel="noreferrer noopener">
                      <div className="news-title" dangerouslySetInnerHTML={{ __html: r.title || r.url }} />
                      <div className="news-meta">
                        <span className="news-source">{(new URL(r.url)).hostname.replace(/^www\./,'')}</span>
                        <span className="news-snippet" dangerouslySetInnerHTML={{ __html: r.snippet || '' }} />
                      </div>
                    </a>
                  ))}
                </div>
              ) : searchType === 'location' ? (
                /* Location results: list with map link if available */
                <div className="location-list">
                  {results.map((r) => (
                    <a key={r.url} className="location-item" href={r.url} target="_blank" rel="noreferrer noopener">
                      <div className="location-title" dangerouslySetInnerHTML={{ __html: r.title || r.url }} />
                      <div className="location-meta">
                        <span className="location-snippet" dangerouslySetInnerHTML={{ __html: r.snippet || '' }} />
                        <div className="location-actions">
                          {/google\.com\/maps|bing\.com\/maps|openstreetmap\.org/.test(r.url) && (
                            <a className="btn-map" href={r.url} target="_blank" rel="noreferrer noopener">Open in Maps</a>
                          )}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="results-grid">
                  {results.map((r) => (
                    <a 
                      key={r.url} 
                      className="result-card" 
                      href={r.url} 
                      target="_blank" 
                      rel="noreferrer noopener"
                    >
                      <div className="card-header">
                        {r.image && (
                          <div className="card-thumbnail">
                            <img src={r.image} alt={r.title} loading="lazy" />
                          </div>
                        )}
                        <div className="card-title-wrap">
                          <h3 className="card-title" dangerouslySetInnerHTML={{ __html: r.title || r.url }} />
                          <div className="card-meta">
                            <div className="card-url">{r.url}</div>
                            {r.lang && (
                              <div className={`lang-badge ${r.lang === 'id' ? 'lang-id' : 'lang-en'}`}>
                                {r.lang.toUpperCase()}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {r.snippet && (
                        <div className="card-snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />
                      )}
                      {typeof r.score === 'number' && (
                        <div className="card-footer">
                          <div className="relevance-score">
                            <span className="score-label">Relevance:</span>
                            <span className="score-value">{r.score.toFixed(3)}</span>
                          </div>
                        </div>
                      )}
                    </a>
                  ))}
                </div>
              )
            ) : q.trim() && !isLoading && (
              <div className="no-results">
                <div className="no-results-icon">🔍</div>
                <h3>No results found</h3>
                <p>Try different keywords or check your spelling</p>
              </div>
            )}
          </div>
        </main>

        
      </div>
    </div>
  )
}

export default App