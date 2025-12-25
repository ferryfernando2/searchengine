// Vercel serverless proxy — forwards requests from the frontend to the backend server
// This avoids mixed-content and CORS issues when the frontend is served over HTTPS.

const REMOTE = 'http://72.61.214.24:4000'
const REMOTE_HTTPS = REMOTE.replace(/^http:/, 'https:')

export default async function handler(req, res) {
  try {
    // Use the raw request URL (path + query) and remove the leading /api
    const rawUrl = req.url || ''
    const targetPath = rawUrl.replace(/^\/api/, '') || '/'
    const target = REMOTE.replace(/\/+$/, '') + targetPath

    const fetchOptions = {
      method: req.method,
      headers: {}
    }

    // Copy headers except host/origin/connection
    for (const h of Object.keys(req.headers || {})) {
      if (['host','origin','connection','content-length'].includes(h.toLowerCase())) continue
      fetchOptions.headers[h] = req.headers[h]
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : undefined
      if (fetchOptions.body) fetchOptions.headers['content-type'] = req.headers['content-type'] || 'application/json'
    }

    // Try HTTP first, then fallback to HTTPS if HTTP fails (useful if remote supports HTTPS)
    let upstream
    let lastErr = null
    try {
      upstream = await fetch(target, fetchOptions)
    } catch (e) {
      lastErr = e
    }

    if (!upstream || upstream.type === 'error' || upstream.status >= 500) {
      // attempt HTTPS fallback
      try {
        const httpsTarget = target.replace(/^http:/, 'https:')
        upstream = await fetch(httpsTarget, fetchOptions)
      } catch (e2) {
        lastErr = e2
      }
    }

    if (!upstream) {
      console.error('Proxy upstream unreachable', lastErr)
      return res.status(502).json({ error: 'Upstream unreachable', detail: String(lastErr) })
    }

    // Forward status and headers (filter certain headers)
    res.status(upstream.status)
    upstream.headers.forEach((value, name) => {
      if (['transfer-encoding','content-encoding','connection'].includes(name.toLowerCase())) return
      res.setHeader(name, value)
    })

    try {
      const buffer = await upstream.arrayBuffer()
      res.send(Buffer.from(buffer))
    } catch (e3) {
      console.error('Proxy read error', e3)
      res.status(502).json({ error: 'Proxy read error', detail: String(e3) })
    }
  } catch (err) {
    console.error('Proxy error', err)
    res.status(502).json({ error: 'Proxy error', detail: String(err) })
  }
}
