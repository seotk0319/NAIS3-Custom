import sharp from 'sharp'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf'])
const WEBP_METADATA_CHUNKS = new Set(['EXIF', 'XMP '])
const STEALTH_SIGNATURES = ['stealth_pnginfo', 'stealth_pngcomp'] as const

export async function sanitizeImageMetadata(
  input: Buffer,
  format: 'png' | 'webp'
): Promise<Buffer> {
  const withoutContainerMetadata = stripImageMetadata(input, format)
  return stripStealthMetadata(withoutContainerMetadata, format)
}

export function stripImageMetadata(input: Buffer, format: 'png' | 'webp'): Buffer {
  return format === 'png' ? stripPngMetadata(input) : stripWebpMetadata(input)
}

export function stripPngMetadata(input: Buffer): Buffer {
  if (input.length < PNG_SIGNATURE.length || !input.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return input
  }

  const chunks: Buffer[] = [input.subarray(0, 8)]
  let offset = 8
  let foundEnd = false

  while (offset + 12 <= input.length) {
    const dataLength = input.readUInt32BE(offset)
    const end = offset + 12 + dataLength
    if (end > input.length) return input

    const type = input.toString('ascii', offset + 4, offset + 8)
    if (!PNG_METADATA_CHUNKS.has(type)) chunks.push(input.subarray(offset, end))
    offset = end

    if (type === 'IEND') {
      foundEnd = true
      break
    }
  }

  if (!foundEnd || offset !== input.length) return input
  return Buffer.concat(chunks)
}

export function stripWebpMetadata(input: Buffer): Buffer {
  if (
    input.length < 12 ||
    input.toString('ascii', 0, 4) !== 'RIFF' ||
    input.toString('ascii', 8, 12) !== 'WEBP' ||
    input.readUInt32LE(4) + 8 !== input.length
  ) {
    return input
  }

  const chunks: Buffer[] = []
  let offset = 12

  while (offset + 8 <= input.length) {
    const type = input.toString('ascii', offset, offset + 4)
    const dataLength = input.readUInt32LE(offset + 4)
    const paddedLength = dataLength + (dataLength & 1)
    const end = offset + 8 + paddedLength
    if (end > input.length) return input

    if (!WEBP_METADATA_CHUNKS.has(type)) {
      if (type === 'VP8X' && dataLength >= 10) {
        const chunk = Buffer.from(input.subarray(offset, end))
        chunk[8] &= ~(0x08 | 0x04)
        chunks.push(chunk)
      } else {
        chunks.push(input.subarray(offset, end))
      }
    }
    offset = end
  }

  if (offset !== input.length) return input

  const body = Buffer.concat(chunks)
  const output = Buffer.alloc(12 + body.length)
  output.write('RIFF', 0, 'ascii')
  output.writeUInt32LE(output.length - 8, 4)
  output.write('WEBP', 8, 'ascii')
  body.copy(output, 12)
  return output
}

async function stripStealthMetadata(input: Buffer, format: 'png' | 'webp'): Promise<Buffer> {
  try {
    const { data, info } = await sharp(input)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.channels !== 4) return input
    const stealth = readStealthHeader(data, info.width, info.height, info.channels)
    if (!stealth) return input

    let minAlpha = 255
    for (let offset = 3; offset < data.length; offset += info.channels) {
      minAlpha = Math.min(minAlpha, data[offset])
    }

    if (minAlpha >= 254) {
      const rgb = Buffer.alloc(info.width * info.height * 3)
      for (let src = 0, dest = 0; src < data.length; src += info.channels, dest += 3) {
        rgb[dest] = data[src]
        rgb[dest + 1] = data[src + 1]
        rgb[dest + 2] = data[src + 2]
      }
      return encodeRaw(rgb, info.width, info.height, 3, format)
    }

    const sanitized = Buffer.from(data)
    const totalBits = Math.min(info.width * info.height, 19 * 8 + stealth.payloadBits)
    for (let bitIndex = 0; bitIndex < totalBits; bitIndex++) {
      const x = Math.floor(bitIndex / info.height)
      const y = bitIndex % info.height
      const offset = (y * info.width + x) * info.channels + 3
      sanitized[offset] = (sanitized[offset] & 0xfe) | ((x + y) & 1)
    }
    return encodeRaw(sanitized, info.width, info.height, info.channels, format)
  } catch {
    return input
  }
}

function readStealthHeader(
  rgba: Buffer,
  width: number,
  height: number,
  channels: number
): { signature: (typeof STEALTH_SIGNATURES)[number]; payloadBits: number } | null {
  if (channels < 4 || width * height < 19 * 8) return null

  const header = Buffer.alloc(19)
  for (let byteIndex = 0; byteIndex < header.length; byteIndex++) {
    let value = 0
    for (let bit = 0; bit < 8; bit++) {
      const bitIndex = byteIndex * 8 + bit
      const x = Math.floor(bitIndex / height)
      const y = bitIndex % height
      const offset = (y * width + x) * channels + 3
      value = (value << 1) | (rgba[offset] & 1)
    }
    header[byteIndex] = value
  }

  const signature = STEALTH_SIGNATURES.find((candidate) =>
    header.subarray(0, candidate.length).equals(Buffer.from(candidate, 'ascii'))
  )
  if (!signature) return null
  return { signature, payloadBits: header.readUInt32BE(15) }
}

function encodeRaw(
  data: Buffer,
  width: number,
  height: number,
  channels: 3 | 4,
  format: 'png' | 'webp'
): Promise<Buffer> {
  const image = sharp(data, { raw: { width, height, channels } })
  return format === 'png'
    ? image.png({ compressionLevel: 9 }).toBuffer()
    : image.webp({ lossless: true, quality: 100 }).toBuffer()
}
