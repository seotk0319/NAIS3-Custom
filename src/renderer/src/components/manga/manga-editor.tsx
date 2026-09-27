import { ArrowLeft, Brush, Combine, Move, RotateCcw, Scissors, Undo2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import {
  MANGA_H,
  MANGA_MARGIN,
  MANGA_W,
  autoLayout,
  mergePolys,
  pageLayout,
  pointInPoly,
  polyCenter,
  readingOrder,
  splitPoly,
  type Poly,
  type Pt
} from '@shared/manga'
import { cn } from '../../lib/utils'
import { useMangaStore } from '../../stores/manga-store'
import { toast } from '../../stores/toast-store'

type Tool = 'line' | 'move' | 'merge'

function pts(p: Poly): string {
  return p.map((q) => q[0] + ',' + q[1]).join(' ')
}

/** 칸 직접 나누기: 선을 그어 칸을 나누고, 꼭짓점을 끌어 모양을 바꾸고, 두 칸을 합친다 */
export function MangaEditor(): React.JSX.Element | null {
  const snap = useMangaStore((s) => s.snap)
  const pageId = useMangaStore((s) => s.pageId)
  const setView = useMangaStore((s) => s.setView)
  const setLayout = useMangaStore((s) => s.setLayout)
  const render = useMangaStore((s) => s.render)
  const p = snap?.project
  const page = p?.pages.find((g) => g.id === pageId) ?? null
  const initial = useMemo(() => (p && page ? pageLayout(page, p.panels) : []), [p, page])
  const [polys, setPolys] = useState<Poly[]>(initial)
  const [history, setHistory] = useState<Poly[][]>([])
  const [tool, setTool] = useState<Tool>('line')
  const [gutter, setGutter] = useState(24)
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null)
  const [vertex, setVertex] = useState<{ i: number; j: number } | null>(null)
  const [pick, setPick] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  if (!p || !page) return null
  const n = page.panelIds.length
  const panels = page.panelIds.map((id) => p.panels.find((x) => x.id === id))
  const numberOf = new Map(p.panels.map((x, k) => [x.id, k + 1]))

  const commit = (next: Poly[], order = true): void => {
    setHistory((h) => [...h.slice(-40), polys])
    setPolys(order ? readingOrder(next) : next)
  }
  const at = (e: React.PointerEvent): Pt => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const q = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return [Math.round(q.x), Math.round(q.y)]
  }
  const snapLine = (a: Pt, b: Pt, shift: boolean): Pt => {
    if (!shift) return b
    return Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? [b[0], a[1]] : [a[0], b[1]]
  }

  const onDown = (e: React.PointerEvent): void => {
    if (tool === 'line') {
      const a = at(e)
      setDrag({ a, b: a })
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    } else if (tool === 'merge') {
      const q = at(e)
      const hit = polys.findIndex((poly) => pointInPoly(q, poly))
      if (hit < 0) return
      if (pick == null || pick === hit) {
        setPick(pick === hit ? null : hit)
        return
      }
      const merged = mergePolys(polys[pick], polys[hit])
      commit([...polys.filter((_, k) => k !== pick && k !== hit), merged])
      setPick(null)
    }
  }
  const onMove = (e: React.PointerEvent): void => {
    if (drag) setDrag({ a: drag.a, b: snapLine(drag.a, at(e), e.shiftKey) })
    else if (vertex) {
      const q = at(e)
      const x = Math.max(MANGA_MARGIN / 2, Math.min(MANGA_W - MANGA_MARGIN / 2, q[0]))
      const y = Math.max(MANGA_MARGIN / 2, Math.min(MANGA_H - MANGA_MARGIN / 2, q[1]))
      setPolys(
        polys.map((poly, k) =>
          k === vertex.i ? poly.map((v, j) => (j === vertex.j ? ([x, y] as Pt) : v)) : poly
        )
      )
    }
  }
  const onUp = (): void => {
    if (drag) {
      const { a, b } = drag
      setDrag(null)
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 20) return
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const hit = polys.findIndex((poly) => pointInPoly(mid, poly))
      if (hit < 0) {
        toast('칸 안쪽을 지나가게 선을 그어 주세요', 'info')
        return
      }
      const parts = splitPoly(polys[hit], a, b, gutter)
      if (!parts) {
        toast('나눈 칸이 너무 작아져요', 'info')
        return
      }
      commit([...polys.slice(0, hit), ...parts, ...polys.slice(hit + 1)])
    }
    if (vertex) {
      setVertex(null)
      setPolys((cur) => readingOrder(cur))
    }
  }
  const undo = (): void => {
    const last = history[history.length - 1]
    if (!last) return
    setHistory(history.slice(0, -1))
    setPolys(last)
  }
  const presets = [1, 2, 3, 4].map((s) => ({
    key: 'a' + s,
    label: '기울인 ' + s,
    polys: autoLayout(n, { seed: page.seed + s * 7919 })
  }))
  presets.push({
    key: 'flat',
    label: '반듯한 칸',
    polys: autoLayout(n, { seed: page.seed, tilt: 0 })
  })
  const match = polys.length === n
  const save = async (andRender: boolean): Promise<void> => {
    if (!match) {
      toast('칸 ' + polys.length + '개 · 컷 ' + n + '개 — 수를 맞춰 주세요', 'info')
      return
    }
    await setLayout(page.id, polys)
    setView('work')
    if (andRender) void render(page.id)
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-w-0 flex-1 flex-col items-center rounded-2xl bg-paper p-4">
        <div className="flex w-full items-center gap-2">
          <button
            onClick={() => setView('work')}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-surface px-3 text-[13px] font-semibold text-muted hover:text-ink"
          >
            <ArrowLeft size={15} /> 작업실
          </button>
          <div className="mx-auto flex gap-1 rounded-xl bg-surface p-1 shadow-sm">
            <ToolBtn
              on={tool === 'line'}
              onClick={() => setTool('line')}
              icon={<Scissors size={15} />}
              label="선 긋기"
            />
            <ToolBtn
              on={tool === 'move'}
              onClick={() => setTool('move')}
              icon={<Move size={15} />}
              label="꼭짓점 옮기기"
            />
            <ToolBtn
              on={tool === 'merge'}
              onClick={() => {
                setTool('merge')
                setPick(null)
              }}
              icon={<Combine size={15} />}
              label="칸 합치기"
            />
            <i className="mx-1 w-px bg-line" />
            <ToolBtn on={false} onClick={undo} icon={<Undo2 size={15} />} label="되돌리기" />
            <ToolBtn
              on={false}
              onClick={() => commit(initial, false)}
              icon={<RotateCcw size={15} />}
              label="처음대로"
            />
          </div>
        </div>
        <div className="mt-2 text-[12px] text-faint">
          {tool === 'line'
            ? '칸 안을 가로지르게 끌면 그 칸이 둘로 나뉘어요 · Shift를 누르면 수평·수직'
            : tool === 'move'
              ? '흰 동그라미를 끌어 칸 모양을 바꿔요'
              : '합칠 두 칸을 차례로 눌러요'}
        </div>
        <div className="mt-3 flex min-h-0 flex-1 items-center">
          <svg
            ref={svgRef}
            viewBox={'0 0 ' + MANGA_W + ' ' + MANGA_H}
            className={cn(
              'h-full max-h-full touch-none rounded-md bg-white shadow-[0_10px_30px_rgba(30,30,70,0.12)]',
              tool === 'line' ? 'cursor-crosshair' : 'cursor-default'
            )}
            style={{ aspectRatio: MANGA_W + ' / ' + MANGA_H }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          >
            {polys.map((poly, i) => {
              const c = polyCenter(poly)
              const over = i < n
              return (
                <g key={i}>
                  <polygon
                    points={pts(poly)}
                    fill={pick === i ? '#d9d9fb' : over ? '#eef0ff' : '#ffe9ea'}
                    stroke={pick === i ? '#5b5bd6' : '#16161c'}
                    strokeWidth={pick === i ? 8 : 6}
                    strokeLinejoin="round"
                  />
                  <circle cx={c[0]} cy={c[1]} r={32} fill={over ? '#5b5bd6' : '#e5484d'} />
                  <text
                    x={c[0]}
                    y={c[1] + 12}
                    textAnchor="middle"
                    fontSize={34}
                    fontWeight={800}
                    fill="#fff"
                  >
                    {i + 1}
                  </text>
                  {tool === 'move' &&
                    poly.map((v, j) => (
                      <circle
                        key={j}
                        cx={v[0]}
                        cy={v[1]}
                        r={13}
                        fill="#fff"
                        stroke="#5b5bd6"
                        strokeWidth={5}
                        className="cursor-grab"
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          setHistory((h) => [...h.slice(-40), polys])
                          setVertex({ i, j })
                          svgRef.current?.setPointerCapture(e.pointerId)
                        }}
                      />
                    ))}
                </g>
              )
            })}
            {drag && (
              <line
                x1={drag.a[0]}
                y1={drag.a[1]}
                x2={drag.b[0]}
                y2={drag.b[1]}
                stroke="#5b5bd6"
                strokeWidth={5}
                strokeDasharray="14 10"
              />
            )}
          </svg>
        </div>
      </div>

      <aside className="flex w-[300px] shrink-0 flex-col gap-2 overflow-y-auto no-scrollbar">
        <div className="text-[14px] font-bold text-ink">
          칸과 컷 <span className="text-[12px] font-medium text-faint">번호가 읽는 순서예요</span>
        </div>
        {panels.map((panel, i) => (
          <div
            key={panel?.id ?? i}
            className="flex items-center gap-2.5 rounded-2xl bg-paper px-3 py-2.5"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-extrabold text-white dark:text-paper">
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-ink">
                {panel?.descriptionKo}
              </div>
              <div className="truncate text-[11.5px] text-faint">
                {numberOf.get(panel?.id ?? '')}번째 컷 · {panel?.framing}
                {panel?.dialogueKo ? ' · "' + panel.dialogueKo + '"' : ''}
              </div>
            </div>
          </div>
        ))}
        <div
          className={cn(
            'rounded-xl px-3 py-2 text-[12.5px] font-semibold',
            match ? 'bg-accent-soft text-accent' : 'bg-danger/10 text-danger'
          )}
        >
          칸 {polys.length}개 · 컷 {n}개
          {match
            ? ' — 맞아요'
            : polys.length > n
              ? ' — 칸을 합쳐 주세요'
              : ' — 칸을 더 나눠 주세요'}
        </div>
        <div className="mt-2 text-[13px] font-bold text-ink">시작 배치</div>
        <div className="grid grid-cols-3 gap-2">
          {presets.map((pr) => (
            <button
              key={pr.key}
              onClick={() => commit(pr.polys, false)}
              className="rounded-xl bg-paper p-1.5 text-[10.5px] font-semibold text-faint hover:text-ink"
            >
              <svg
                viewBox={'0 0 ' + MANGA_W + ' ' + MANGA_H}
                className="mb-1 block w-full rounded bg-white"
              >
                {pr.polys.map((poly, k) => (
                  <polygon key={k} points={pts(poly)} fill="#cfd0e6" />
                ))}
              </svg>
              {pr.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold text-muted">
          칸 사이
          {[12, 24, 36].map((g) => (
            <button
              key={g}
              onClick={() => setGutter(g)}
              className={cn(
                'h-7 rounded-lg px-2.5',
                gutter === g ? 'bg-accent text-white dark:text-paper' : 'bg-paper'
              )}
            >
              {g}px
            </button>
          ))}
        </div>
        <div className="mt-auto flex flex-col gap-1.5 pt-3">
          <button
            onClick={() => void save(false)}
            className="h-10 rounded-xl bg-paper text-[13px] font-semibold text-ink hover:bg-surface-2"
          >
            이 배치로 저장
          </button>
          <button
            onClick={() => void save(true)}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-accent text-[14px] font-bold text-white dark:text-paper"
          >
            <Brush size={15} /> 저장하고 그리기 · V5 1장
          </button>
        </div>
      </aside>
    </div>
  )
}

function ToolBtn(props: {
  on: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}): React.JSX.Element {
  return (
    <button
      onClick={props.onClick}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition',
        props.on ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
      )}
    >
      {props.icon}
      {props.label}
    </button>
  )
}
