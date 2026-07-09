import type { GenerationRequest, ImageMetadata, UcPresetIndex } from '@shared/types'

type MetadataFallbacks = Partial<
  Pick<GenerationRequest, 'steps' | 'cfgScale' | 'cfgRescale' | 'sampler' | 'noiseSchedule'>
>

interface RequestFromMetadataInput {
  meta: ImageMetadata
  imageBase64: string
  dimensions?: { width: number; height: number }
  width?: number
  height?: number
  fallbackWidth?: number
  fallbackHeight?: number
  fallbacks?: MetadataFallbacks
  maskBase64?: string
  strength: number
  noise?: number
  useCoords?: boolean
}

/** NAI PNG Source 청크의 모델 표기 → 생성 모델 id */
export function modelFromMetadata(name?: string): string {
  if (!name) return 'nai-diffusion-4-5-full'
  const lower = name.toLowerCase()
  if (lower.includes('4.5') || lower.includes('4-5')) {
    return lower.includes('curated') ? 'nai-diffusion-4-5-curated' : 'nai-diffusion-4-5-full'
  }
  if (lower.includes('furry')) return 'nai-diffusion-furry-3'
  if (lower.includes('v4') || lower.includes('4')) {
    return lower.includes('curated') ? 'nai-diffusion-4-curated-preview' : 'nai-diffusion-4-full'
  }
  if (lower.includes('v3') || lower.includes('3')) return 'nai-diffusion-3'
  return 'nai-diffusion-4-5-full'
}

export function snap64(value: number): number {
  return Math.max(64, Math.round(value / 64) * 64)
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]+,/, ''))
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다'))
    reader.readAsDataURL(file)
  })
}

export function imageDimensions(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ width: 0, height: 0 })
    img.src = `data:image/png;base64,${base64}`
  })
}

function randomSeed(): number {
  return Math.floor(Math.random() * 4294967295)
}

export function requestFromMetadata(input: RequestFromMetadataInput): GenerationRequest {
  const { meta, fallbacks = {} } = input
  const characterPrompts = (meta.characterPrompts ?? []).map((c) => ({
    prompt: c.prompt,
    negativePrompt: c.negativePrompt,
    center: c.center,
    enabled: true
  }))

  return {
    prompt: meta.prompt,
    negativePrompt: meta.negativePrompt,
    model: modelFromMetadata(meta.model),
    width:
      input.width ?? snap64(meta.width || input.dimensions?.width || input.fallbackWidth || 832),
    height:
      input.height ??
      snap64(meta.height || input.dimensions?.height || input.fallbackHeight || 1216),
    steps: meta.steps ?? fallbacks.steps ?? 28,
    cfgScale: meta.cfgScale ?? fallbacks.cfgScale ?? 5,
    cfgRescale: meta.cfgRescale ?? fallbacks.cfgRescale ?? 0,
    sampler: meta.sampler ?? fallbacks.sampler ?? 'k_euler',
    noiseSchedule: meta.noiseSchedule ?? fallbacks.noiseSchedule ?? 'native',
    seed: randomSeed(),
    variety: meta.variety ?? false,
    qualityToggle: false,
    ucPreset: 4 as UcPresetIndex,
    characterPrompts,
    useCoords: input.useCoords ?? meta.useCoords ?? characterPrompts.length > 0,
    skipWildcards: true,
    source: {
      imageBase64: input.imageBase64,
      maskBase64: input.maskBase64,
      strength: input.strength,
      noise: input.noise ?? 0
    }
  }
}
