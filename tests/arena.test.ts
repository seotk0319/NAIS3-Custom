import { describe, expect, it } from 'vitest'
import {
  breedCombo,
  comboKey,
  comboString,
  fitModel,
  generateBatch,
  insertArtists,
  insertScene,
  mulberry32,
  orderCandidates,
  pairString,
  parseArtistInput,
  pickQuad,
  roundRobin,
  tuneWeights,
  voteComparisons,
  artistStats,
  comboScore,
  slotLayout,
  estimateTotal,
  MAIN_SLOTS,
  TUNE_SLOTS,
  NEG_SLOTS,
  parseComboString,
  replaceArtistTags,
  makeArtistSlot,
  neighborCombos,
  estimateRefine,
  type ArenaPair,
  type Comparison
} from '../src/shared/arena'

describe('arena combo in the detail prompt', () => {
  it('reads a combo string in order with weights, including weight groups and braces', () => {
    expect(
      parseComboString(
        '1.2::artist:omutatsu::, artist:wanke, 0.9::artist:a, artist:b::, {artist:c}, vivid'
      )
    ).toEqual([
      { tag: 'omutatsu', weight: 1.2 },
      { tag: 'wanke', weight: 1 },
      { tag: 'a', weight: 0.9 },
      { tag: 'b', weight: 0.9 },
      { tag: 'c', weight: 1.1 }
    ])
  })

  it('swaps the artist tags in place and keeps everything else', () => {
    const detail = 'soft lighting, depth of field,\n1.4::artist:x::, artist:y, 0.8::artist:z::'
    expect(replaceArtistTags(detail, '1.1::artist:new::')).toBe(
      'soft lighting, depth of field,\n1.1::artist:new::'
    )
    expect(replaceArtistTags('no artists here', 'q')).toBeNull()
    // 주석 줄은 건드리지 않는다
    expect(replaceArtistTags('# artist:old\nartist:x, blue', 'artist:n')).toBe(
      '# artist:old\nartist:n, blue'
    )
  })

  it('puts the session artist slot at the end, after the scene', () => {
    expect(makeArtistSlot('1girl, vivid colors')).toBe('1girl, vivid colors, {scene}, {artist}')
    expect(makeArtistSlot('1girl, {scene}, soft, artist:a, artist:b')).toBe(
      '1girl, {scene}, soft, {artist}'
    )
    expect(makeArtistSlot('1girl, {artist}, x')).toBe('1girl, {artist}, x')
  })
})

describe('arena refine variants', () => {
  const seed: ArenaPair[] = [
    { tag: 'a', weight: 1.4 },
    { tag: 'b', weight: 1 },
    { tag: 'c', weight: 0.9 },
    { tag: 'd', weight: 1.2 }
  ]
  const opts = { minWeight: 0.8, maxWeight: 1.6, step: 0.3, moves: 2 }

  it('keeps the same artists and nudges only order and weight within range', () => {
    const vs = neighborCombos(seed, 28, opts, mulberry32(5))
    expect(vs).toHaveLength(28)
    expect(vs[0]).toEqual({ pairs: seed, source: 'seed' })
    expect(new Set(vs.map((v) => comboKey(v.pairs))).size).toBe(28)
    for (const v of vs.slice(1)) {
      expect(v.pairs.map((p) => p.tag).sort()).toEqual(['a', 'b', 'c', 'd'])
      let changed = 0
      for (const p of v.pairs) {
        const orig = seed.find((s) => s.tag === p.tag)!
        const d = Math.abs(p.weight - orig.weight)
        expect(d).toBeLessThanOrEqual(0.6 + 1e-9)
        if (d > 1e-9) {
          expect(p.weight).toBeGreaterThanOrEqual(0.8)
          expect(p.weight).toBeLessThanOrEqual(1.6)
          changed++
        }
      }
      // 한 변형에서 가중치가 바뀐 작가는 최대 두 명
      expect(changed).toBeLessThanOrEqual(2)
    }
    expect(vs.some((v) => v.pairs[0].tag !== 'a' || v.pairs[1].tag !== 'b')).toBe(true)
  })

  it('leaves fixed-weight artists alone', () => {
    const vs = neighborCombos(seed, 20, { ...opts, fixed: new Set(['a']) }, mulberry32(9))
    for (const v of vs) expect(v.pairs.find((p) => p.tag === 'a')!.weight).toBe(1.4)
  })

  it('estimates images per scene count', () => {
    expect(estimateRefine('normal', 3)).toEqual({ first: 84, total: 105 })
  })
})

describe('arena scene count', () => {
  it('keeps the old fixed slots for 12-scene sessions', () => {
    const l = slotLayout(12)
    expect(l.all).toHaveLength(12)
    expect(l.main).toEqual(MAIN_SLOTS)
    expect(l.tune).toEqual(TUNE_SLOTS)
    expect(l.neg).toEqual(NEG_SLOTS)
  })

  it('uses every scene for main when there are only three', () => {
    expect(slotLayout(3)).toEqual({ all: [0, 1, 2], main: [0, 1, 2], tune: [0, 1], neg: [0, 1] })
    expect(slotLayout(1)).toEqual({ all: [0], main: [0], tune: [0], neg: [0] })
    expect(slotLayout(6).main).toEqual([0, 1, 3, 4])
  })

  it('estimates fewer images with fewer scenes', () => {
    expect(estimateTotal('normal', 12)).toBe(400)
    expect(estimateTotal('normal', 3)).toBe(280)
  })
})

describe('arena prompt', () => {
  it('writes NAI weight syntax like the original, 1.0 without weight', () => {
    expect(pairString({ tag: 'omutatsu', weight: 1.6 })).toBe('1.6::artist:omutatsu::')
    expect(pairString({ tag: 'ningen mame', weight: 1 })).toBe('artist:ningen mame')
    expect(pairString({ tag: 'tag99', weight: 1.2 })).toBe('1.2::artist:tag99 ::')
  })

  it('replaces only the exact {artist} token and keeps other braces', () => {
    const p = '1girl,\n{artist},\n{{best quality}}, -3::artist collaboration ::'
    const out = insertArtists(p, '1.2::artist:a::, artist:b')
    expect(out).toBe(
      '1girl,\n1.2::artist:a::, artist:b,\n{{best quality}}, -3::artist collaboration ::'
    )
    expect(insertArtists('a, {artist}, b', '')).toBe('a, b')
  })

  it('puts the scene at {scene} or at the end', () => {
    expect(insertScene('1girl, {scene}, soft', 'rain')).toBe('1girl, rain, soft')
    expect(insertScene('1girl, soft,\n', 'rain')).toBe('1girl, soft, rain')
  })

  it('pulls artist names out of a pasted prompt', () => {
    const got = parseArtistInput(
      '1.2::artist:omutatsu::, {artist:wanke}, vivid colors,\n# note, artist:foo_bar'
    )
    expect(got).toEqual([
      { name: 'omutatsu', hadPrefix: true },
      { name: 'wanke', hadPrefix: true },
      { name: 'vivid colors', hadPrefix: false }
    ])
  })
})

describe('arena order matters', () => {
  it('treats a different order as a different combo', () => {
    const a: ArenaPair[] = [
      { tag: 'x', weight: 1.2 },
      { tag: 'y', weight: 0.8 }
    ]
    expect(comboKey(a)).not.toBe(comboKey([...a].reverse()))
    expect(comboString(a)).toBe('1.2::artist:x::, 0.8::artist:y::')
  })

  it('learns that putting an artist first wins', () => {
    // 같은 두 작가, 순서만 다른 두 조합. x가 앞인 쪽이 계속 이긴다
    const front: ArenaPair[] = [
      { tag: 'x', weight: 1 },
      { tag: 'y', weight: 1 }
    ]
    const back: ArenaPair[] = [
      { tag: 'y', weight: 1 },
      { tag: 'x', weight: 1 }
    ]
    const combos = new Map([
      [1, front],
      [2, back]
    ])
    const comps: Comparison[] = Array.from({ length: 30 }, () => ({
      winner: 1,
      loser: 2,
      weight: 1,
      slot: 0
    }))
    const model = fitModel(combos, comps)
    expect(comboScore(model, 1, front).score).toBeGreaterThan(comboScore(model, 2, back).score)
    const x = model.theta.get('x')!
    const y = model.theta.get('y')!
    expect(x[3]).toBeGreaterThan(y[3])
    const order = orderCandidates(back, model.theta)
    expect(order[0].map((p) => p.tag)).toEqual(['y', 'x'])
    expect(order.some((o) => o[0].tag === 'x')).toBe(true)
  })

  it('breeding inherits weights and parent order', () => {
    const rng = mulberry32(7)
    const a: ArenaPair[] = [
      { tag: 'p', weight: 1.5 },
      { tag: 'q', weight: 0.9 },
      { tag: 'r', weight: 1.1 }
    ]
    const b: ArenaPair[] = [
      { tag: 'p', weight: 1.3 },
      { tag: 'q', weight: 1.1 },
      { tag: 's', weight: 1.0 }
    ]
    const pool = ['p', 'q', 'r', 's'].map((tag) => ({ tag, fixedWeight: null }))
    const child = breedCombo(
      a,
      b,
      pool,
      { minArtists: 3, maxArtists: 3, minWeight: 0.5, maxWeight: 2 },
      rng,
      { sigma: 0 }
    )
    expect(child.map((c) => c.tag).slice(0, 2)).toEqual(['p', 'q'])
    expect(child[0].weight).toBe(1.4)
    expect(child[1].weight).toBe(1)
  })
})

describe('arena model and matchmaking', () => {
  const pool = Array.from({ length: 20 }, (_, i) => ({ tag: 'a' + i, fixedWeight: null }))
  const shape = { minArtists: 3, maxArtists: 5, minWeight: 0.8, maxWeight: 1.6 }

  it('makes unique random combos within the shape', () => {
    const batch = generateBatch({
      count: 200,
      pool,
      shape,
      model: null,
      ranked: [],
      existingKeys: new Set(),
      rng: mulberry32(1)
    })
    expect(batch).toHaveLength(200)
    expect(new Set(batch.map((b) => comboKey(b.pairs))).size).toBe(200)
    for (const b of batch) {
      expect(b.pairs.length).toBeGreaterThanOrEqual(3)
      expect(b.pairs.length).toBeLessThanOrEqual(5)
      for (const p of b.pairs) {
        expect(p.weight).toBeGreaterThanOrEqual(0.8)
        expect(p.weight).toBeLessThanOrEqual(1.6)
      }
    }
  })

  it('finds the artist the voter likes and uses the model for new combos', () => {
    const rng = mulberry32(3)
    const batch = generateBatch({
      count: 120,
      pool,
      shape,
      model: null,
      ranked: [],
      existingKeys: new Set(),
      rng
    })
    const combos = new Map(batch.map((b, i) => [i + 1, b.pairs]))
    // 가상의 취향: a3이 들어 있으면 좋고, a7이 있으면 싫다
    const taste = (p: ArenaPair[]): number =>
      p.reduce((s, x) => s + (x.tag === 'a3' ? 2 : x.tag === 'a7' ? -2 : 0), 0)
    const comps: Comparison[] = []
    for (let g = 0; g < 150; g++) {
      const ids = [0, 1, 2, 3].map(() => 1 + Math.floor(rng() * 120))
      const best = ids.reduce((b, id) => (taste(combos.get(id)!) > taste(combos.get(b)!) ? id : b))
      comps.push(
        ...voteComparisons({
          duel: { kind: 'quad', stage: 'prelim', slot: 0, comboIds: ids },
          result: { kind: 'quad', best }
        })
      )
    }
    const model = fitModel(combos, comps)
    const stats = artistStats(model, combos, ['a3', 'a7'], shape)
    expect(stats[0].effect!).toBeGreaterThan(5)
    expect(stats[1].effect!).toBeLessThan(-5)
    const next = generateBatch({
      count: 30,
      pool,
      shape,
      model,
      ranked: [],
      existingKeys: new Set(),
      rng
    })
    const modelMade = next.filter((n) => n.source === 'model')
    expect(modelMade.length).toBeGreaterThan(15)
    const withA3 = modelMade.filter((n) => n.pairs.some((p) => p.tag === 'a3')).length
    expect(withA3 / modelMade.length).toBeGreaterThan(0.6)
  })

  it('picks four combos that all have an image on the same scene', () => {
    const has = new Set(['1:0', '2:0', '3:0', '4:0', '5:0', '6:1'])
    const pick = pickQuad({
      pool: [1, 2, 3, 4, 5, 6],
      slots: [0, 1],
      hasRender: (id, slot) => has.has(id + ':' + slot),
      appear: new Map([[5, 3]]),
      slotUse: new Map(),
      score: new Map(),
      rng: mulberry32(2)
    })
    expect(pick!.slot).toBe(0)
    expect(pick!.comboIds).toHaveLength(4)
    expect(pick!.comboIds).not.toContain(6)
  })

  it('round robin covers every pair once', () => {
    const pairs = roundRobin([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(4))
    expect(pairs).toHaveLength(28)
    expect(new Set(pairs.map(([a, b]) => [a, b].sort().join('-'))).size).toBe(28)
  })

  it('optician weights keep the current value', () => {
    expect(tuneWeights(1.6)).toEqual([1, 1.3, 1.6, 1.9])
    expect(tuneWeights(0.4)).toEqual([0.3, 0.4, 0.7, 1])
  })
})
