import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
}

// Chromium's file:// loader stops at the 259-character Windows path limit, and scene
// folders that repeat a long scene name pass it easily; Node's fs has no such limit.
export function serveImageFile(filePath: string): Response {
  let size: number
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return new Response(null, { status: 404 })
    size = stat.size
  } catch {
    return new Response(null, { status: 404 })
  }
  const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>
  return new Response(body, {
    headers: {
      'Content-Type': TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': String(size)
    }
  })
}
