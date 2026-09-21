import { useEffect, useRef, useState } from 'react'
import { loadSceneImage, watchSceneImage } from '../lib/scene-image-loader'

/** Keep sortable card geometry, but only load/decode nearby images. */
export function SceneCardImage({
  src,
  fullSrc,
  live
}: {
  src: string
  fullSrc?: string
  live?: string | null
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ near: false, visible: false })
  const [loaded, setLoaded] = useState<string | null>(null)
  const [fullLoaded, setFullLoaded] = useState<string | null>(null)

  useEffect(() => {
    if (!ref.current) return
    return watchSceneImage(ref.current, (near, visible) => {
      setRange((old) => (old.near === near && old.visible === visible ? old : { near, visible }))
    })
  }, [])

  useEffect(() => {
    if (!range.near || live || !src) return
    return loadSceneImage(src, range.visible ? 0 : 1, () => setLoaded(src))
  }, [src, range.near, range.visible, live])

  useEffect(() => {
    if (!range.visible || live || !fullSrc || loaded !== src) return
    let cancel: (() => void) | undefined
    // Fast scrolling should not start large reads for every card it passes.
    const timer = setTimeout(() => {
      cancel = loadSceneImage(fullSrc, 2, () => setFullLoaded(fullSrc))
    }, 180)
    return () => {
      clearTimeout(timer)
      cancel?.()
    }
  }, [fullSrc, src, loaded, range.visible, live])

  const display = live
    ? `data:image/png;base64,${live}`
    : range.visible && fullSrc && fullLoaded === fullSrc
      ? fullSrc
      : range.near && loaded === src
        ? src
        : null
  return (
    <div ref={ref} className="h-full w-full cursor-pointer bg-surface-2">
      {display && (
        <img
          src={display}
          decoding="async"
          className="h-full w-full object-cover"
          draggable={false}
          alt=""
        />
      )}
    </div>
  )
}
