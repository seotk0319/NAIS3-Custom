// A minimal Chrome DevTools Protocol client over the browser's own endpoint.
export interface CdpConnection {
  send<T = unknown>(method: string, params?: object, sessionId?: string): Promise<T>
  close(): void
  readonly closed: boolean
}

export async function connectCdp(url: string, timeoutMs = 10_000): Promise<CdpConnection> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP_CONNECT_TIMEOUT')), timeoutMs)
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        reject(new Error('CDP_CONNECT_FAILED'))
      },
      { once: true }
    )
  })
  let next = 0,
    closed = false
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (e: Error) => void }
  >()
  socket.addEventListener('message', (event) => {
    let data: { id?: number; result?: unknown; error?: { message?: string } }
    try {
      data = JSON.parse(String(event.data))
    } catch {
      return
    }
    const waiter = data.id === undefined ? undefined : pending.get(data.id)
    if (!waiter || data.id === undefined) return
    pending.delete(data.id)
    if (data.error) waiter.reject(new Error('CDP ' + (data.error.message || 'error')))
    else waiter.resolve(data.result)
  })
  socket.addEventListener('close', () => {
    closed = true
    for (const waiter of pending.values()) waiter.reject(new Error('CDP_CLOSED'))
    pending.clear()
  })
  return {
    send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
      if (closed) return Promise.reject(new Error('CDP_CLOSED'))
      const id = ++next
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error('CDP_TIMEOUT ' + method))
        }, 30_000)
      })
    },
    close() {
      try {
        socket.close()
      } catch {
        /* already closed */
      }
    },
    get closed() {
      return closed
    }
  }
}
