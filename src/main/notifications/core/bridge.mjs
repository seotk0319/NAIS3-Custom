import http from 'node:http'
import { createStore } from './store.mjs'

// Same protocol as the 0.3.4 Chrome collector. Only one process may own this store.
export async function startBridge(directory, port = 43127) {
  let store
  const server = http.createServer(async (req, res) => {
    const host = `127.0.0.1:${server.address().port}`,
      origin = `http://${host}`
    const send = (status, value) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      })
      res.end(JSON.stringify(value))
    }
    if (req.headers.host !== host) return send(403, { error: 'Invalid host' })
    if (!store) return send(503, { error: 'Starting' })
    const pathname = new URL(req.url, origin).pathname,
      o = req.headers.origin
    const local = (!o || o === origin) && req.headers['sec-fetch-site'] !== 'cross-site'
    const extension = store.authorized(o, req.headers['x-moa-key'])
    if (o && store.allowedOrigin(o)) {
      res.setHeader('Access-Control-Allow-Origin', o)
      res.setHeader('Vary', 'Origin')
    }
    if (req.method === 'OPTIONS') {
      if (
        !store.allowedOrigin(o) &&
        !(pathname === '/api/pair' && /^chrome-extension:\/\/[a-p]{32}$/.test(o || ''))
      )
        return send(403, { error: 'Origin rejected' })
      res.setHeader('Access-Control-Allow-Origin', o)
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Moa-Key')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
      res.writeHead(204)
      res.end()
      return
    }
    async function body() {
      let size = 0
      const parts = []
      for await (const chunk of req) {
        size += chunk.length
        if (size > 4 * 1024 * 1024) throw Error('Payload too large')
        parts.push(chunk)
      }
      return JSON.parse(Buffer.concat(parts).toString('utf8'))
    }
    try {
      if (pathname === '/api/pair' && req.method === 'POST') {
        const value = await store.pair(o, (await body()).code)
        res.setHeader('Access-Control-Allow-Origin', o)
        return send(200, value)
      }
      if (pathname === '/api/heartbeat' && req.method === 'POST' && extension)
        return send(200, await store.heartbeat(await body()))
      if (pathname === '/api/ingest' && req.method === 'POST' && extension)
        return send(200, await store.ingest(await body()))
      if (pathname === '/api/state' && req.method === 'GET' && local)
        return send(200, await store.view())
      if (pathname === '/api/health' && req.method === 'GET' && local)
        return send(200, { service: 'nais3-inbox', version: 1 })
      if (pathname === '/' && req.method === 'GET' && local)
        return send(200, { message: 'NAIS3 Custom 1의 알림 탭에서 확인할 수 있어요.' })
      return send(403, { error: 'Not authorized' })
    } catch (error) {
      // Only this service's own validation wording travels back, never stored content.
      const known = [
        'Invalid batch',
        'Invalid notification ID',
        'Invalid API notification',
        'API schema required',
        'Payload too large',
        'Legacy collector is no longer active',
        'Unsupported collection interval',
        'Pairing rejected'
      ]
      const reason = known.find((value) => value === error?.message) || null
      return send(400, { error: 'Request could not be accepted', ...(reason ? { reason } : {}) })
    }
  })
  server.requestTimeout = 20_000
  server.headersTimeout = 15_000
  // Bind before opening files: a second instance must never mutate the active store.
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  try {
    store = await createStore(directory)
  } catch (error) {
    server.close()
    throw error
  }
  return {
    store,
    port: server.address().port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeIdleConnections()
      })
  }
}
