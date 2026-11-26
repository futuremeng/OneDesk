/**
 * 对校 side-by-side collate view: the second rendering of a redline document,
 * shown as an in-place overlay that splits the document area in two columns —
 * the previous version on the left (read-only), the current one on the right.
 * Instead of one row per block, every textblock is segmented at its change
 * points: unchanged runs form identical paired rows, and each deleted/inserted
 * run falls into its own row (or one shared row for a replacement), so the two
 * columns stay character-aligned: text following a change sits at the same
 * height on both sides, with filler space in the column the change skips.
 * The halves come from the live doc itself (ins/del marks), not a second
 * document instance; navigation and per-change Accept/Reject run through
 * collectRevisions / buildReviewEntries / applyRevisions on the live editor.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Editor } from '@tiptap/core'
import { DOMSerializer, Fragment, type Node as PmNode } from '@tiptap/pm/model'
import { useI18n } from '../i18n/locale'
import { applyRevisions, collectRevisions } from '../editor/revisions'
import { buildReviewEntries, type ReviewEntry } from '../editor/revision-filters'

interface CollateRow {
  /** doc-position range this row covers, for entry navigation */
  pos: number
  end: number
  left: string
  right: string
  /** paragraph-mark revision: the missing column shows a chip instead */
  chip?: 'paraIns' | 'paraDel'
}

interface CollateModel {
  rows: CollateRow[]
  /** body revisions only; story (header/footer) rows are excluded from navigation */
  entries: ReviewEntry[]
  /** per entry, the index of the row its change lands in */
  entryRow: number[]
}

/** the paragraph element's own flow margins: a segmented paragraph must only
 *  carry them at its first/last row, never between the segments */
function tuneFlow(elm: Element, first: boolean, last: boolean) {
  const css = (elm as HTMLElement).style
  if (!first) {
    css.textIndent = '0'
    css.marginTop = '0'
  }
  if (!last) css.marginBottom = '0'
}

/** one side of a child run: the left drops inserted text, the right deletions */
function onSide(child: PmNode, side: 'left' | 'right'): boolean {
  const ins = child.marks.some((m) => m.type.name === 'ins')
  const del = child.marks.some((m) => m.type.name === 'del')
  return side === 'left' ? !ins || del : !del || ins
}

/** the textblock's children split into change-aligned paired segments: an
 *  unchanged run pairs with itself, a deleted/inserted region shares one row */
function pairedSegments(node: PmNode): { kids: PmNode[]; start: number; end: number }[] {
  const kids: PmNode[] = []
  node.forEach((child) => kids.push(child))
  const isText = kids.every((k) => k.isText)
  if (!isText) {
    // atomics and mixed inline content: one row, both sides show it whole
    return kids.length ? [{ kids, start: 0, end: node.content.size }] : []
  }
  const segs: { kids: PmNode[]; start: number; end: number }[] = []
  let run: PmNode[] = []
  let runStart = 0
  let changedRun = false
  const flush = (end: number) => {
    if (run.length) segs.push({ kids: run, start: runStart, end })
    run = []
  }
  let off = 0
  for (const child of kids) {
    const ins = child.marks.some((m) => m.type.name === 'ins')
    const del = child.marks.some((m) => m.type.name === 'del')
    const changed = ins !== del
    if (run.length && changed !== changedRun) {
      flush(off)
      runStart = off
    }
    if (!run.length) runStart = off
    changedRun = changed
    run.push(child)
    off += child.nodeSize
  }
  flush(off)
  return segs
}

function buildModel(editor: Editor): CollateModel {
  const { doc } = editor.state
  const serializer = DOMSerializer.fromSchema(editor.schema)
  const render = (node: PmNode, first: boolean, last: boolean): string => {
    const holder = document.createElement('div')
    holder.appendChild(serializer.serializeFragment(Fragment.from(node)))
    const root = holder.firstElementChild
    if (root) tuneFlow(root, first, last)
    return holder.innerHTML
  }
  const rows: CollateRow[] = []
  doc.forEach((node, pos) => {
    const paraIns = node.attrs?.paraMarkIns != null
    const paraDel = node.attrs?.paraMarkDel != null
    if (paraIns || paraDel) {
      const whole = render(node.copy(node.content), true, true)
      rows.push({
        pos,
        end: pos + node.nodeSize,
        left: paraIns ? '' : whole,
        right: paraDel ? '' : whole,
        chip: paraIns ? 'paraIns' : 'paraDel',
      })
      return
    }
    if (!node.isTextblock) {
      const whole = render(node.copy(node.content), true, true)
      rows.push({ pos, end: pos + node.nodeSize, left: whole, right: whole })
      return
    }
    const segs = pairedSegments(node)
    if (!segs.length) {
      rows.push({ pos, end: pos + node.nodeSize, left: '', right: '' })
      return
    }
    segs.forEach((seg, i) => {
      const first = i === 0
      const last = i === segs.length - 1
      const left = seg.kids.filter((k) => onSide(k, 'left'))
      const right = seg.kids.filter((k) => onSide(k, 'right'))
      rows.push({
        pos: pos + 1 + seg.start,
        end: pos + 1 + seg.end,
        left: left.length ? render(node.copy(Fragment.from(left)), first, last) : '',
        right: right.length ? render(node.copy(Fragment.from(right)), first, last) : '',
      })
    })
  })
  const entries = buildReviewEntries(doc, collectRevisions(doc)).filter(
    (e) => !e.rev.story && !(e.pair && e.pair.story),
  )
  const entryRow = entries.map((e) => {
    const at = Math.max(0, Math.min(e.rev.from, doc.content.size - 1))
    const i = rows.findIndex((r) => at >= r.pos && at < r.end)
    return i < 0 ? 0 : i
  })
  return { rows, entries, entryRow }
}

export function CollateView({
  editor,
  zoomClass,
  zoomStyle,
  onClose,
}: {
  editor: Editor
  zoomClass: string
  zoomStyle: CSSProperties
  onClose: () => void
}) {
  const { t } = useI18n()
  const [model, setModel] = useState<CollateModel>(() => buildModel(editor))
  const [current, setCurrent] = useState(0)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const sync = () => setModel(buildModel(editor))
    sync()
    let timer = 0
    const onUpdate = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(sync, 300)
    }
    editor.on('update', onUpdate)
    return () => {
      window.clearTimeout(timer)
      editor.off('update', onUpdate)
    }
  }, [editor])

  // an accepted/rejected change shrinks the list: keep the cursor inside it
  useEffect(() => {
    setCurrent((c) => Math.min(c, Math.max(0, model.entries.length - 1)))
  }, [model])

  const currentRow = model.entries.length > 0 ? (model.entryRow[current] ?? -1) : -1
  useEffect(() => {
    if (currentRow >= 0) rowRefs.current[currentRow]?.scrollIntoView({ block: 'nearest' })
  }, [currentRow, model])

  const act = (mode: 'accept' | 'reject') => {
    const e = model.entries[current]
    if (!e) return
    applyRevisions(editor, e.pair ? [e.rev, e.pair] : [e.rev], mode)
  }

  const n = model.entries.length
  const empty = n === 0
  return (
    <div className="collate-pane">
      <div className="collate-pane-bar">
        <span>{t('appCollateTitle')}</span>
        <span className="collate-pane-tools">
          <button
            className="collate-btn"
            data-testid="collate-prev"
            disabled={empty || current <= 0}
            onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          >
            {t('appCollatePrev')}
          </button>
          <span className="collate-pane-count">{empty ? '0/0' : `${current + 1}/${n}`}</span>
          <button
            className="collate-btn"
            data-testid="collate-next"
            disabled={empty || current >= n - 1}
            onClick={() => setCurrent((c) => Math.min(n - 1, c + 1))}
          >
            {t('appCollateNext')}
          </button>
          <button
            className="collate-btn"
            data-testid="collate-accept"
            disabled={empty}
            onClick={() => act('accept')}
          >
            {t('appRevAccept')}
          </button>
          <button
            className="collate-btn"
            data-testid="collate-reject"
            disabled={empty}
            onClick={() => act('reject')}
          >
            {t('appRevReject')}
          </button>
        </span>
        <button className="split-pane-close" aria-label={t('appClose')} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="collate-pane-scroll">
        {empty ? (
          <div className="collate-empty">{t('appReviewPaneEmpty')}</div>
        ) : (
          <>
            <div className={`collate-zoom ${zoomClass}`} style={zoomStyle}>
              <div className="collate-head-row">
                <div className="collate-head">{t('appCollateOriginal')}</div>
                <div className="collate-head">{t('appCollateRevised')}</div>
              </div>
              {model.rows.map((row, i) => (
                <div
                  key={i}
                  data-testid={`collate-row-${i}`}
                  ref={(el) => {
                    rowRefs.current[i] = el
                  }}
                  className={`collate-row${currentRow === i ? ' current' : ''}`}
                >
                  <div className="collate-cell">
                    {row.chip === 'paraIns' ? (
                      <span className="collate-chip">{t('appCollateParaIns')}</span>
                    ) : (
                      <div
                        className="doc-page ProseMirror collate-doc"
                        dangerouslySetInnerHTML={{ __html: row.left }}
                      />
                    )}
                  </div>
                  <div className="collate-cell">
                    {row.chip === 'paraDel' ? (
                      <span className="collate-chip">{t('appCollateParaDel')}</span>
                    ) : (
                      <div
                        className="doc-page ProseMirror collate-doc"
                        dangerouslySetInnerHTML={{ __html: row.right }}
                      />
                    )}
                  </div>
                </div>
              ))}
              <div className="collate-note">{t('appCollateNote')}</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
