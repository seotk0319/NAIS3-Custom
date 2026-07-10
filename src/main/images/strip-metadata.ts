const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf'])
const WEBP_METADATA_CHUNKS = new Set(['EXIF', 'XMP '])

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
