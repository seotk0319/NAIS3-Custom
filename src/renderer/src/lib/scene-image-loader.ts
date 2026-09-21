/** A small, cancellable queue shared by all scene cards. No image payloads retained. */
type Job = { start: () => void; priority: number }
const pending = new Set<Job>()
let active = 0
let activeHighResolution = 0
let scheduled = false

function pump(): void {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    while (active < 4 && pending.size) {
      const job = [...pending]
        .sort((a, b) => a.priority - b.priority)
        .find((item) => item.priority < 2 || activeHighResolution < 2)
      if (!job) break
      pending.delete(job)
      job.start()
    }
  })
}

export function loadSceneImage(url: string, priority: number, ready: () => void): () => void {
  let image: HTMLImageElement | undefined
  let finished = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const finish = (success: boolean): void => {
    if (finished) return
    finished = true
    clearTimeout(timeout)
    pending.delete(job)
    if (image) {
      image.onload = null
      image.onerror = null
      if (!success) image.src = ''
      active--
      if (priority >= 2) activeHighResolution--
    }
    if (success) ready()
    pump()
  }
  const job: Job = {
    priority,
    start: () => {
      active++
      if (priority >= 2) activeHighResolution++
      image = new Image()
      image.decoding = 'async'
      image.onload = () => {
        // Decode before swapping the visible image; keep the preview until ready.
        void image!.decode().then(
          () => finish(true),
          () => finish(false)
        )
      }
      image.onerror = () => finish(false)
      timeout = setTimeout(() => finish(false), 15000)
      image.src = url
    }
  }
  pending.add(job)
  pump()
  return () => finish(false)
}

type Watched = {
  near: boolean
  visible: boolean
  change: (near: boolean, visible: boolean) => void
}
const watched = new Map<Element, Watched>()
let nearObserver: IntersectionObserver | undefined
let visibleObserver: IntersectionObserver | undefined

export function watchSceneImage(
  element: Element,
  change: (near: boolean, visible: boolean) => void
): () => void {
  nearObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const item = watched.get(entry.target)
        if (!item) continue
        item.near = entry.isIntersecting
        item.change(item.near || item.visible, item.visible)
      }
    },
    { rootMargin: '360px 0px' }
  )
  // A separate observer is necessary: entering the actual viewport does not
  // necessarily cross a threshold of the larger prefetch area.
  visibleObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const item = watched.get(entry.target)
        if (!item) continue
        item.visible = entry.isIntersecting && entry.intersectionRatio > 0
        item.change(item.near || item.visible, item.visible)
      }
    },
    { threshold: [0, 0.01] }
  )
  watched.set(element, { near: false, visible: false, change })
  nearObserver.observe(element)
  visibleObserver.observe(element)
  return () => {
    nearObserver?.unobserve(element)
    visibleObserver?.unobserve(element)
    watched.delete(element)
  }
}
