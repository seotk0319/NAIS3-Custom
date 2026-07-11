export const MAX_NAI_PIXELS = 1216 * 1216

/** 64 배수로 스냅한 최종 결과도 픽셀 상한 안에 있도록 보정한다. */
export function snapNaiResolution(
  width: number,
  height: number
): { width: number; height: number } {
  let w = Math.max(64, Number.isFinite(width) ? width : 64)
  let h = Math.max(64, Number.isFinite(height) ? height : 64)
  if (w * h > MAX_NAI_PIXELS) {
    const scale = Math.sqrt(MAX_NAI_PIXELS / (w * h))
    w *= scale
    h *= scale
  }

  w = snap64(w)
  h = snap64(h)
  while (w * h > MAX_NAI_PIXELS) {
    if ((w >= h && w > 64) || h === 64) w -= 64
    else h -= 64
  }
  return { width: w, height: h }
}

function snap64(value: number): number {
  return Math.max(64, Math.round(value / 64) * 64)
}
