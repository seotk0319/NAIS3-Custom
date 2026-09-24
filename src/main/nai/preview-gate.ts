// A step preview is only worth sending while someone can see it, and a few per second
// is already smooth: every step of every parallel job was tens of megabytes a minute
// of base64 through the main process.
export function createPreviewGate(
  intervalMs = 250,
  now: () => number = Date.now
): { allow(visible: boolean): boolean } {
  let last = -Infinity
  return {
    allow(visible) {
      if (!visible) return false
      const at = now()
      if (at - last < intervalMs) return false
      last = at
      return true
    }
  }
}
