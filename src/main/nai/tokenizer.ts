import { app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { inflateRawSync } from 'zlib'
import { isV5Model } from '../../shared/nai-models'

/**
 * T5 unigram 토크나이저 — V4/4.5 프롬프트 토큰 카운트용 (한도 512).
 *
 * NAI 웹 번들의 자체 JS 구현을 미러링한다 (resources/t5_tokenizer.json =
 * novelai.net/tokenizer/compressed/t5_tokenizer.def 해제본):
 * - normalizer: 웹은 Precompiled charsmap을 "무시"하고 identity — 동일하게 함
 * - pre-tokenize: 공백 분할 → 각 조각 앞에 ▁ (Metaspace, add_prefix_space)
 * - encode 전에 웹과 동일하게 가중치 문자 []{} 제거
 * - 결과에 EOS 1토큰 포함 (웹 카운트 방식)
 */

interface T5TokenizerDef {
  model: { vocab: [string, number][]; unk_id: number }
}

interface Vocab {
  pieces: Map<string, { id: number; score: number }>
  maxPieceLength: number
  unkScore: number
}

let t5Vocab: Vocab | null = null

function loadT5(): Vocab {
  if (t5Vocab) return t5Vocab
  const def = JSON.parse(
    readFileSync(join(app.getAppPath(), 'resources', 't5_tokenizer.json'), 'utf-8')
  ) as T5TokenizerDef

  const pieces = new Map<string, { id: number; score: number }>()
  let maxPieceLength = 0
  let minScore = Infinity
  def.model.vocab.forEach(([piece, score], id) => {
    pieces.set(piece, { id, score })
    maxPieceLength = Math.max(maxPieceLength, piece.length)
    if (score < minScore) minScore = score
  })
  t5Vocab = { pieces, maxPieceLength, unkScore: minScore - 10 }
  return t5Vocab
}

/** sentencepiece unigram Viterbi — 한 조각(▁포함)을 최적 분할했을 때의 토큰 수 */
function viterbiCount(piece: string, v: Vocab): number {
  const n = piece.length
  // best[i] = [0,i) 구간 최적 (score, tokenCount)
  const bestScore = new Float64Array(n + 1).fill(-Infinity)
  const bestCount = new Int32Array(n + 1)
  bestScore[0] = 0
  for (let i = 0; i < n; i++) {
    if (bestScore[i] === -Infinity) continue
    const maxLen = Math.min(v.maxPieceLength, n - i)
    let matched = false
    for (let len = 1; len <= maxLen; len++) {
      const sub = piece.slice(i, i + len)
      const entry = v.pieces.get(sub)
      if (!entry) continue
      matched = true
      const score = bestScore[i] + entry.score
      if (score > bestScore[i + len]) {
        bestScore[i + len] = score
        bestCount[i + len] = bestCount[i] + 1
      }
    }
    if (!matched) {
      // unk 1글자 소비 (sentencepiece unk 처리와 동일 취지)
      const score = bestScore[i] + v.unkScore
      if (score > bestScore[i + 1]) {
        bestScore[i + 1] = score
        bestCount[i + 1] = bestCount[i] + 1
      }
    }
  }
  return bestCount[n]
}

/**
 * 웹과 동일한 카운트: []{} 및 수치 가중치(N:: / ::) 제거 → 공백 분할 → ▁조각 unigram → +EOS(1)
 * (전처리 정규식은 NAI 웹 encode()에서 그대로 — 원본 코드와 카운트 일치 검증 완료)
 */
function countT5Tokens(text: string): number {
  const v = loadT5()
  const cleaned = text.replace(/[[\]{}]/g, '').replace(/-?\d*\.?\d*::/g, '')
  const parts = cleaned.split(/\s+/).filter((p) => p.length > 0)
  let total = 1 // EOS
  for (const part of parts) {
    total += viterbiCount('▁' + part, v)
  }
  return total
}

interface QwenTokenizerDef {
  config: {
    splitRegex: string
    ignoreMerges: boolean
    normalization?: string
  }
  specialTokens: string[]
  vocab: Record<string, number>
  merges: [string, string][]
}

interface QwenTokenizer {
  count(text: string): number
}

let qwenTokenizer: QwenTokenizer | null = null

/** GPT-2/Qwen byte-level BPE의 0..255 → 가역 유니코드 문자 표. */
function byteUnicodeTable(): string[] {
  const bytes: number[] = []
  for (let i = 33; i <= 126; i++) bytes.push(i)
  for (let i = 161; i <= 172; i++) bytes.push(i)
  for (let i = 174; i <= 255; i++) bytes.push(i)
  const chars = [...bytes]
  let extra = 0
  for (let i = 0; i < 256; i++) {
    if (bytes.includes(i)) continue
    bytes.push(i)
    chars.push(256 + extra++)
  }
  const table = new Array<string>(256)
  bytes.forEach((byte, i) => (table[byte] = String.fromCodePoint(chars[i])))
  return table
}

function loadQwen(): QwenTokenizer {
  if (qwenTokenizer) return qwenTokenizer

  // NovelAI 공식 qwen35_tokenizer.def는 raw DEFLATE JSON이다.
  const packed = readFileSync(join(app.getAppPath(), 'resources', 'qwen35_tokenizer.def'))
  const def = JSON.parse(inflateRawSync(packed).toString('utf-8')) as QwenTokenizerDef
  const ranks = new Map<string, number>()
  def.merges.forEach(([left, right], rank) => ranks.set(`${left}\0${right}`, rank))
  const splitRegex = new RegExp(def.config.splitRegex, 'gu')
  const byteChars = byteUnicodeTable()
  const cache = new Map<string, number>()
  const specialSet = new Set(def.specialTokens)

  const bpeCount = (word: string): number => {
    const cached = cache.get(word)
    if (cached !== undefined) return cached
    if (def.config.ignoreMerges && def.vocab[word] !== undefined) return 1

    let pieces = Array.from(word)
    while (pieces.length > 1) {
      let bestRank = Infinity
      let bestLeft = ''
      let bestRight = ''
      for (let i = 0; i < pieces.length - 1; i++) {
        const rank = ranks.get(`${pieces[i]}\0${pieces[i + 1]}`)
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank
          bestLeft = pieces[i]
          bestRight = pieces[i + 1]
        }
      }
      if (bestRank === Infinity) break

      const merged: string[] = []
      for (let i = 0; i < pieces.length; i++) {
        if (i < pieces.length - 1 && pieces[i] === bestLeft && pieces[i + 1] === bestRight) {
          merged.push(bestLeft + bestRight)
          i++
        } else {
          merged.push(pieces[i])
        }
      }
      pieces = merged
    }

    // 공식 vocab에 없는 조각은 byte 문자 단위로 떨어진다. 정상 def에서는 항상 매핑된다.
    const count = pieces.reduce(
      (total, piece) => total + (def.vocab[piece] !== undefined ? 1 : Array.from(piece).length),
      0
    )
    cache.set(word, count)
    return count
  }

  const ordinaryCount = (text: string): number => {
    let total = 0
    for (const match of text.matchAll(splitRegex)) {
      const bytes = Buffer.from(match[0], 'utf-8')
      let encoded = ''
      for (const byte of bytes) encoded += byteChars[byte]
      total += bpeCount(encoded)
    }
    return total
  }

  const count = (input: string): number => {
    const text = def.config.normalization ? input.normalize(def.config.normalization as 'NFC') : input
    let total = 0
    let cursor = 0
    while (cursor < text.length) {
      let nextIndex = text.length
      let nextSpecial = ''
      for (const special of def.specialTokens) {
        const index = text.indexOf(special, cursor)
        if (index >= 0 && index < nextIndex) {
          nextIndex = index
          nextSpecial = special
        }
      }
      if (nextIndex > cursor) total += ordinaryCount(text.slice(cursor, nextIndex))
      if (!nextSpecial) break
      if (specialSet.has(nextSpecial)) total++
      cursor = nextIndex + nextSpecial.length
    }
    return total
  }

  qwenTokenizer = { count }
  return qwenTokenizer
}

/** 실제 선택 모델과 같은 토크나이저로 센다: V4.5=T5(+EOS), V5=Qwen BPE. */
export function countTokens(text: string, model: string): number {
  const cleaned = text.replace(/[[\]{}]/g, '').replace(/-?\d*\.?\d*::/g, '')
  return isV5Model(model) ? loadQwen().count(cleaned) : countT5Tokens(cleaned)
}
