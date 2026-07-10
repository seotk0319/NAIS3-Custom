import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { sanitizeImageMetadata, stripImageMetadata } from '../src/main/images/strip-metadata'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let value = n
    for (let k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[n] = value >>> 0
  }
  return table
})()

function crc32(bytes: Buffer): number {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function pngChunk(typeName: string, data: Buffer): Buffer {
  const type = Buffer.from(typeName, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  type.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length)
  return chunk
}

function insertPngChunks(png: Buffer, chunks: Buffer[]): Buffer {
  const iendOffset = png.lastIndexOf(Buffer.from('IEND', 'ascii')) - 4
  return Buffer.concat([png.subarray(0, iendOffset), ...chunks, png.subarray(iendOffset)])
}

function webpChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(8 + data.length + (data.length & 1))
  chunk.write(type, 0, 'ascii')
  chunk.writeUInt32LE(data.length, 4)
  data.copy(chunk, 8)
  return chunk
}

function appendWebpChunks(webp: Buffer, chunks: Buffer[]): Buffer {
  const output = Buffer.concat([webp, ...chunks])
  output.writeUInt32LE(output.length - 8, 4)
  return output
}

function embedStealthMetadata(
  rgba: Buffer,
  width: number,
  height: number,
  payload: Buffer
): Buffer {
  const signature = Buffer.from('stealth_pngcomp', 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length * 8)
  const hidden = Buffer.concat([signature, length, payload])
  const output = Buffer.from(rgba)
  let bitIndex = 0

  for (const byte of hidden) {
    for (let bit = 7; bit >= 0; bit--) {
      const x = Math.floor(bitIndex / height)
      const y = bitIndex % height
      const offset = (y * width + x) * 4 + 3
      output[offset] = (output[offset] & 0xfe) | ((byte >> bit) & 1)
      bitIndex++
    }
  }
  return output
}

async function readStealthSignature(image: Buffer): Promise<string> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const bytes = Buffer.alloc(15)
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    let value = 0
    for (let bit = 0; bit < 8; bit++) {
      const bitIndex = byteIndex * 8 + bit
      const x = Math.floor(bitIndex / info.height)
      const y = bitIndex % info.height
      const offset = (y * info.width + x) * info.channels + 3
      value = (value << 1) | (data[offset] & 1)
    }
    bytes[byteIndex] = value
  }
  return bytes.toString('ascii')
}

describe('stripImageMetadata', () => {
  it('removes PNG text and EXIF chunks without changing pixels', async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#cc5500' }
    })
      .png()
      .toBuffer()
    const tagged = insertPngChunks(png, [
      pngChunk('tEXt', Buffer.from('Comment\0secret prompt', 'latin1')),
      pngChunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0private', 'latin1')),
      pngChunk('eXIf', Buffer.from('private exif', 'latin1'))
    ])

    const stripped = stripImageMetadata(tagged, 'png')
    expect(stripped.includes(Buffer.from('secret prompt'))).toBe(false)
    expect(stripped.includes(Buffer.from('private exif'))).toBe(false)
    expect((await sharp(stripped).raw().toBuffer()).equals(await sharp(png).raw().toBuffer())).toBe(
      true
    )
  })

  it('removes WEBP EXIF and XMP chunks without re-encoding the image chunk', async () => {
    const webp = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#2255cc' }
    })
      .webp({ lossless: true })
      .toBuffer()
    const tagged = appendWebpChunks(webp, [
      webpChunk('EXIF', Buffer.from('private exif')),
      webpChunk('XMP ', Buffer.from('secret prompt'))
    ])

    const stripped = stripImageMetadata(tagged, 'webp')
    expect(stripped.includes(Buffer.from('private exif'))).toBe(false)
    expect(stripped.includes(Buffer.from('secret prompt'))).toBe(false)
    expect(
      (await sharp(stripped).raw().toBuffer()).equals(await sharp(webp).raw().toBuffer())
    ).toBe(true)
  })

  it('returns malformed input untouched', () => {
    const malformed = Buffer.from('not an image')
    expect(stripImageMetadata(malformed, 'png')).toBe(malformed)
    expect(stripImageMetadata(malformed, 'webp')).toBe(malformed)
  })

  it.each(['png', 'webp'] as const)(
    'removes NovelAI stealth metadata from opaque %s pixels',
    async (format) => {
      const width = 32
      const height = 32
      const rgba = Buffer.alloc(width * height * 4)
      for (let offset = 0; offset < rgba.length; offset += 4) {
        rgba[offset] = 180
        rgba[offset + 1] = 90
        rgba[offset + 2] = 210
        rgba[offset + 3] = 255
      }
      const hidden = embedStealthMetadata(
        rgba,
        width,
        height,
        Buffer.from('{"Comment":{"prompt":"secret prompt"}}', 'utf8')
      )
      const tagged = await (format === 'png'
        ? sharp(hidden, { raw: { width, height, channels: 4 } })
            .png()
            .toBuffer()
        : sharp(hidden, { raw: { width, height, channels: 4 } })
            .webp({ lossless: true })
            .toBuffer())

      expect(await readStealthSignature(tagged)).toBe('stealth_pngcomp')
      const stripped = await sanitizeImageMetadata(tagged, format)
      expect(await readStealthSignature(stripped)).not.toBe('stealth_pngcomp')
      expect(stripped.includes(Buffer.from('secret prompt'))).toBe(false)

      const originalRgb = await sharp(tagged).removeAlpha().raw().toBuffer()
      const strippedRgb = await sharp(stripped).removeAlpha().raw().toBuffer()
      expect(strippedRgb.equals(originalRgb)).toBe(true)
    }
  )
})
