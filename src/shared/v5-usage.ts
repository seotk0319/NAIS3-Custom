import type { V5UsageStatus } from './types'

// NovelAI 공식 FAQ 및 웹: 23 steps / 약 1MP 기준. 현재 설정으로 환산한 값이 아니다.
export const V5_ESTIMATE_BASIS =
  '23스텝 · 약 1MP 기준 예상치이며 현재 해상도·스텝에 따라 달라집니다'
export function estimateV5Images(usage: V5UsageStatus): number {
  return usage.isNegative ? 0 : Math.floor(Math.max(0, usage.percent) * 17.3)
}
