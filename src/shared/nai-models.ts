export const NAI_MODEL_V45_FULL = 'nai-diffusion-4-5-full'
export const NAI_MODEL_V5_FULL = 'nai-diffusion-5-full'

/** NovelAI 웹의 이미지 프롬프트 한도. V5 Curated도 메타데이터 불러오기를 위해 구분한다. */
export const NAI_TOKEN_LIMIT_V45 = 512
export const NAI_TOKEN_LIMIT_V5_CURATED = 703
export const NAI_TOKEN_LIMIT_V5_FULL = 1471

export function isV5Model(model: string): boolean {
  return model.includes('nai-diffusion-5-')
}

/** NAI 웹 모델 설정: V4.5는 캐릭터 6명, V5는 32명까지 (NAI 웹 코드 확인) */
export function maxCharactersForModel(model: string): number {
  return isV5Model(model) ? 32 : 6
}

/** V5는 캐릭터 위치를 0~1 자유 좌표로, V4.5는 5×5 칸(0.1~0.9)으로만 받는다 */
export function freeformPositionForModel(model: string): boolean {
  return isV5Model(model)
}

const GRID = [0.1, 0.3, 0.5, 0.7, 0.9]
/** 가장 가까운 5×5 칸 좌표로 맞춘다 (V4.5용) */
export function snapToGrid(center: { x: number; y: number }): { x: number; y: number } {
  const snap = (v: number): number =>
    GRID.reduce((best, g) => (Math.abs(g - v) < Math.abs(best - v) ? g : best), 0.5)
  return { x: snap(center.x), y: snap(center.y) }
}

/**
 * 새 캐릭터를 놓을 빈 자리 (NAI 웹과 같은 순서): 가운데 줄 0.5 → 0.3 → 0.7 → 0.1 → 0.9,
 * 그다음 가운데에서 가까운 칸부터. 자유 좌표에서는 0.1보다 가까우면 겹친 것으로 본다.
 */
const PLACEMENT_ORDER = [
  ...[0.5, 0.3, 0.7, 0.1, 0.9].map((x) => ({ x, y: 0.5 })),
  ...[0.1, 0.3, 0.7, 0.9]
    .flatMap((y) => GRID.map((x) => ({ x, y })))
    .sort(
      (a, b) =>
        Math.hypot(a.x - 0.5, a.y - 0.5) - Math.hypot(b.x - 0.5, b.y - 0.5) ||
        Math.abs(a.y - 0.5) - Math.abs(b.y - 0.5) ||
        a.x - b.x ||
        a.y - b.y
    )
]
export const CHARACTER_OVERLAP_DISTANCE = 0.1
export function nextFreeCenter(taken: { x: number; y: number }[]): { x: number; y: number } {
  for (const spot of PLACEMENT_ORDER)
    if (!taken.some((c) => Math.hypot(c.x - spot.x, c.y - spot.y) < CHARACTER_OVERLAP_DISTANCE))
      return spot
  return { x: 0.5, y: 0.5 }
}

export function tokenLimitForModel(model: string): number {
  if (!isV5Model(model)) return NAI_TOKEN_LIMIT_V45
  return model.includes('curated') ? NAI_TOKEN_LIMIT_V5_CURATED : NAI_TOKEN_LIMIT_V5_FULL
}

export function fullModelForVersion(version: '4.5' | '5', inpainting = false): string {
  const model = version === '5' ? NAI_MODEL_V5_FULL : NAI_MODEL_V45_FULL
  return inpainting ? `${model}-inpainting` : model
}
