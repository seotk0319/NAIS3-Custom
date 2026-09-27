import { Loader2, TriangleAlert } from 'lucide-react'
import {
  MANGA_H,
  MANGA_W,
  pageLayout,
  polyCenter,
  type MangaPage,
  type MangaProject,
  type Poly
} from '@shared/manga'
import { imageUrl } from '../../lib/constants'
import { cn } from '../../lib/utils'

function pts(p: Poly): string {
  return p.map((q) => q[0] + ',' + q[1]).join(' ')
}

/** 페이지 한 장. 다 그렸으면 완성 이미지, 아니면 칸 모양과 컷 번호·대사 */
export function MangaPageView({
  project,
  page,
  className,
  detail = false,
  showState = true
}: {
  project: MangaProject
  page: MangaPage
  className?: string
  /** 그리기 전 칸 안에 컷 설명까지 보여 준다 */
  detail?: boolean
  showState?: boolean
}): React.JSX.Element {
  const polys = pageLayout(page, project.panels)
  const panels = page.panelIds.map((id) => project.panels.find((p) => p.id === id))
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08)]',
        className
      )}
      style={{ aspectRatio: MANGA_W + ' / ' + MANGA_H }}
    >
      {page.filePath ? (
        <img
          src={imageUrl(page.filePath)}
          className="absolute inset-0 size-full object-contain"
          draggable={false}
        />
      ) : (
        <svg viewBox={'0 0 ' + MANGA_W + ' ' + MANGA_H} className="absolute inset-0 size-full">
          {polys.map((p, i) => {
            const c = polyCenter(p)
            const panel = panels[i]
            return (
              <g key={i}>
                <polygon
                  points={pts(p)}
                  fill="#f1f1f7"
                  stroke="#16161c"
                  strokeWidth={6}
                  strokeLinejoin="round"
                />
                <circle cx={c[0]} cy={c[1] - (detail ? 40 : 0)} r={34} fill="#5b5bd6" />
                <text
                  x={c[0]}
                  y={c[1] - (detail ? 40 : 0) + 13}
                  textAnchor="middle"
                  fontSize={38}
                  fontWeight={800}
                  fill="#fff"
                >
                  {i + 1}
                </text>
                {detail && panel && (
                  <foreignObject x={c[0] - 150} y={c[1]} width={300} height={140}>
                    <div className="line-clamp-3 text-center text-[26px] font-semibold leading-snug text-[#4e5968]">
                      {panel.descriptionKo}
                    </div>
                  </foreignObject>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {showState && page.state === 'queued' && (
        <div className="absolute inset-0 grid place-items-center bg-black/35 text-white">
          <span className="flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-[12px] font-semibold">
            <Loader2 size={14} className="animate-spin" /> 그리는 중
          </span>
        </div>
      )}
      {showState && page.state === 'failed' && (
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5 rounded-lg bg-danger/90 px-2 py-1 text-[11px] font-semibold text-white">
          <TriangleAlert size={12} />{' '}
          <span className="truncate">{page.error ?? '그리지 못했어요'}</span>
        </div>
      )}
    </div>
  )
}
