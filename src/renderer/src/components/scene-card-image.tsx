import { useEffect, useRef, useState } from 'react'
import { isSceneImageReady, loadSceneImage, watchSceneImage } from '../lib/scene-image-loader'

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
  // 최근에 본 이미지는 기다리지 않고 바로 보여준다 (스크롤을 되돌리거나 카드가 다시 그려질 때)
  const [loaded, setLoaded] = useState<string | null>(() => (isSceneImageReady(src) ? src : null))
  const [fullLoaded, setFullLoaded] = useState<string | null>(() =>
    fullSrc && isSceneImageReady(fullSrc) ? fullSrc : null
  )
  const fullReady = !!fullSrc && fullLoaded === fullSrc

  useEffect(() => {
    if (!ref.current) return
    return watchSceneImage(ref.current, (near, visible) => {
      setRange((old) => (old.near === near && old.visible === visible ? old : { near, visible }))
    })
  }, [])

  useEffect(() => {
    if (!range.near || live || !src || fullReady || loaded === src) return
    return loadSceneImage(src, range.visible ? 0 : 1, () => setLoaded(src))
  }, [src, range.near, range.visible, live, fullReady, loaded])

  useEffect(() => {
    // 화면 근처 카드는 원본도 미리 받는다 (보이는 카드가 먼저). 썸네일이 먼저 떠 있어야 시작.
    if (!range.near || live || !fullSrc || fullReady || loaded !== src) return
    let cancel: (() => void) | undefined
    // Fast scrolling should not start large reads for every card it passes.
    const timer = setTimeout(() => {
      cancel = loadSceneImage(fullSrc, range.visible ? 2 : 3, () => setFullLoaded(fullSrc))
    }, 180)
    return () => {
      clearTimeout(timer)
      cancel?.()
    }
  }, [fullSrc, src, loaded, range.near, range.visible, live, fullReady])

  const display = live
    ? `data:image/png;base64,${live}`
    : fullReady
      ? fullSrc
      : loaded === src
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
