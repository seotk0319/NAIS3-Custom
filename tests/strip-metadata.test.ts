import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { stripImageMetadata } from '../src/main/images/strip-metadata'

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
})
