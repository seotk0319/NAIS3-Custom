export const NAI_MODEL_V45_FULL = 'nai-diffusion-4-5-full'
export const NAI_MODEL_V5_FULL = 'nai-diffusion-5-full'

/** NovelAI 웹의 이미지 프롬프트 한도. V5 Curated도 메타데이터 불러오기를 위해 구분한다. */
export const NAI_TOKEN_LIMIT_V45 = 512
export const NAI_TOKEN_LIMIT_V5_CURATED = 703
export const NAI_TOKEN_LIMIT_V5_FULL = 1471

export function isV5Model(model: string): boolean {
  return model.includes('nai-diffusion-5-')
}

export function tokenLimitForModel(model: string): number {
  if (!isV5Model(model)) return NAI_TOKEN_LIMIT_V45
  return model.includes('curated') ? NAI_TOKEN_LIMIT_V5_CURATED : NAI_TOKEN_LIMIT_V5_FULL
}

export function fullModelForVersion(version: '4.5' | '5', inpainting = false): string {
  const model = version === '5' ? NAI_MODEL_V5_FULL : NAI_MODEL_V45_FULL
  return inpainting ? `${model}-inpainting` : model
}
