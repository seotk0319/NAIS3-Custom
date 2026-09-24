/**
 * A small, cancellable queue shared by all scene cards.
 * Recently decoded images are kept (bounded) so a card that scrolls back into view,
 * or remounts after the grid window moves, shows its image at once instead of blank.
 */
type Job = { start: () => void; priority: number }
const pending = new Set<Job>()
let active = 0
let activeHighResolution = 0
let scheduled = false

const MAX_ACTIVE = 6
const MAX_ACTIVE_HIGH_RESOLUTION = 3
const KEEP_THUMBNAILS = 400
const KEEP_FULL = 60
// Holding the decoded Image keeps the document's copy available for a new <img> with the same URL.
const recentThumbnails = new Map<string, HTMLImageElement>()
const recentFull = new Map<string, HTMLImageElement>()

function remember(url: string, image: HTMLImageElement, priority: number): void {
  const store = priority >= 2 ? recentFull : recentThumbnails
  store.delete(url)
  store.set(url, image)
  const limit = priority >= 2 ? KEEP_FULL : KEEP_THUMBNAILS
  while (store.size > limit) store.delete(store.keys().next().value as string)
}

/** Whether this image was decoded recently and can be shown without waiting. */
export function isSceneImageReady(url: string | undefined): boolean {
  if (!url) return false
  const store = recentFull.has(url) ? recentFull : recentThumbnails.has(url) ? recentThumbnails : null
  if (!store) return false
  const image = store.get(url)!
  store.delete(url)
  store.set(url, image)
  return true
}

function pump(): void {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    while (active < MAX_ACTIVE && pending.size) {
      const job = [...pending]
        .sort((a, b) => a.priority - b.priority)
        .find((item) => item.priority < 2 || activeHighResolution < MAX_ACTIVE_HIGH_RESOLUTION)
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
    if (success) {
      if (image) remember(url, image, priority)
      ready()
    }
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
// The prefetch area must be measured against the scroll box itself: with the window as root,
// cards outside the scroll box are clipped away and never count as "near", whatever the margin.
const nearObservers = new WeakMap<Element | Document, IntersectionObserver>()
let visibleObserver: IntersectionObserver | undefined

function nearObserverFor(element: Element): IntersectionObserver {
  const root = element.closest('[data-scene-scroll]') ?? document
  let observer = nearObservers.get(root)
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const item = watched.get(entry.target)
          if (!item) continue
          item.near = entry.isIntersecting
          item.change(item.near || item.visible, item.visible)
        }
      },
      { root, rootMargin: '900px 0px' }
    )
    nearObservers.set(root, observer)
  }
  return observer
}

export function watchSceneImage(
  element: Element,
  change: (near: boolean, visible: boolean) => void
): () => void {
  const nearObserver = nearObserverFor(element)
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
    nearObserver.unobserve(element)
    visibleObserver?.unobserve(element)
    watched.delete(element)
  }
}
