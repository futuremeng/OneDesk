/**
 * 对校 side-by-side collate view: the second rendering of a redline document,
 * shown in place over the document area as two facing paper sheets on the
 * canvas — the previous version on the left rendered as clean original text
 * (no revision marks at all), the current version on the right with the
 * regular revision display (insertions underlined, deletions not shown, a
 * change bar in the right sheet's left margin wherever something changed).
 * The redline is an in-memory diff of the tab's kept previous-version snapshot
 * against the live document (compareDocuments in the renderer — no result tab,
 * no Compare channel); with no snapshot the sheets fall back to the live doc's
 * own ins/del marks. Instead of one band per block, every textblock is
 * segmented at its change points: unchanged runs form identical paired rows,
 * and each deleted/inserted run falls into its own row (or one shared row for
 * a replacement; a whole-paragraph replacement pairs its deleted and inserted
 * blocks into one row), so the two sheets stay character-aligned: text
 * following a change sits at the same height on both sides, with filler space
 * in the column the change skips. Change navigation lives in a small floating
 * capsule at the bottom, not a header bar: the sheets alone carry the view.
 * The redline lives outside the live doc, so this view only reads and
 * navigates changes; Accept/Reject stay in the document itself.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Editor } from '@tiptap/core'
import { DOMSerializer, Fragment, type Node as PmNode } from '@tiptap/pm/model'
import { useI18n } from '../i18n/locale'
import { collectRevisions } from '../editor/revisions'
import { buildReviewEntries, type ReviewEntry } from '../editor/revision-filters'

interface CollateRow {
  /** doc-position range this row covers, for entry navigation */
  pos: number
  end: number
  left: string
  right: string
  /** the row holds a change: the right sheet shows a change bar in its margin */
  changed: boolean
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

/** does this run differ between the versions (exactly one of ins/del on it)? */
function isChangedRun(child: PmNode): boolean {
  const ins = child.marks.some((m) => m.type.name === 'ins')
  const del = child.marks.some((m) => m.type.name === 'del')
  return ins !== del
}

/** the left sheet's original rendering: the redline's ins/del marks come off
 *  the runs and the paragraph-level revision marks are nulled, leaving every
 *  other (character) mark exactly as authored — plain text, no revision ink */
function asOriginal(node: PmNode): PmNode {
  const marks = node.marks.filter((m) => m.type.name !== 'ins' && m.type.name !== 'del')
  if (node.isText) return node.mark(marks)
  const attrs: Record<string, unknown> = { ...node.attrs }
  if ('paraMarkIns' in attrs || 'paraMarkDel' in attrs) {
    attrs.paraMarkIns = null
    attrs.paraMarkDel = null
  }
  const kids: PmNode[] = []
  node.forEach((child) => kids.push(asOriginal(child)))
  return node.type.create(attrs, Fragment.from(kids), marks)
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

/** the block carries this paragraph-mark revision and not its opposite */
function paraMarkOf(node: PmNode, kind: 'paraMarkIns' | 'paraMarkDel'): boolean {
  const other = kind === 'paraMarkIns' ? 'paraMarkDel' : 'paraMarkIns'
  return node.attrs?.[kind] != null && node.attrs?.[other] == null
}

function buildModel(root: PmNode): CollateModel {
  const serializer = DOMSerializer.fromSchema(root.type.schema)
  const render = (node: PmNode, first: boolean, last: boolean): string => {
    const holder = document.createElement('div')
    holder.appendChild(serializer.serializeFragment(Fragment.from(node)))
    const elm = holder.firstElementChild
    if (elm) tuneFlow(elm, first, last)
    return holder.innerHTML
  }
  const rows: CollateRow[] = []
  const kids: { node: PmNode; pos: number }[] = []
  root.forEach((node, pos) => kids.push({ node, pos }))
  for (let i = 0; i < kids.length; i++) {
    const { node, pos } = kids[i]
    const end = pos + node.nodeSize
    const paraIns = paraMarkOf(node, 'paraMarkIns')
    const paraDel = paraMarkOf(node, 'paraMarkDel')
    if (paraIns || paraDel) {
      const next = kids[i + 1]
      // a whole-paragraph replacement lands as two adjacent paragraph-mark
      // blocks: they pair into one row (deleted paragraph left, inserted
      // right), otherwise the two sheets would sit a row apart
      const merge =
        next != null &&
        ((paraDel && paraMarkOf(next.node, 'paraMarkIns')) ||
          (paraIns && paraMarkOf(next.node, 'paraMarkDel')))
      if (merge && next) {
        const delNode = paraDel ? node : next.node
        const insNode = paraIns ? node : next.node
        rows.push({
          pos: Math.min(pos, next.pos),
          end: Math.max(end, next.pos + next.node.nodeSize),
          left: render(asOriginal(delNode), true, true),
          right: render(insNode.copy(insNode.content), true, true),
          changed: true,
        })
        i++
        continue
      }
      const whole = render(node.copy(node.content), true, true)
      rows.push({
        pos,
        end,
        left: paraIns ? '' : render(asOriginal(node), true, true),
        right: paraDel ? '' : whole,
        changed: true,
      })
      continue
    }
    if (!node.isTextblock) {
      // tables and blocks with atomics inside: shown as-is on both sheets
      const whole = render(node.copy(node.content), true, true)
      rows.push({ pos, end, left: whole, right: whole, changed: false })
      continue
    }
    const segs = pairedSegments(node)
    if (!segs.length) {
      rows.push({ pos, end, left: '', right: '', changed: false })
      continue
    }
    segs.forEach((seg, j) => {
      const first = j === 0
      const last = j === segs.length - 1
      const left = seg.kids.filter((k) => onSide(k, 'left'))
      const right = seg.kids.filter((k) => onSide(k, 'right'))
      rows.push({
        pos: pos + 1 + seg.start,
        end: pos + 1 + seg.end,
        left: left.length ? render(asOriginal(node.copy(Fragment.from(left))), first, last) : '',
        right: right.length ? render(node.copy(Fragment.from(right)), first, last) : '',
        changed: seg.kids.some(isChangedRun),
      })
    })
  }
  const entries = buildReviewEntries(root, collectRevisions(root)).filter(
    (e) => !e.rev.story && !(e.pair && e.pair.story),
  )
  const entryRow = entries.map((e) => {
    const at = Math.max(0, Math.min(e.rev.from, root.content.size - 1))
    const i = rows.findIndex((r) => at >= r.pos && at < r.end)
    return i < 0 ? 0 : i
  })
  return { rows, entries, entryRow }
}

export function CollateView({
  editor,
  redline,
  zoomClass,
  zoomStyle,
  onClose,
}: {
  editor: Editor
  /** the in-memory redline diff to render; null falls back to the live doc's marks */
  redline: PmNode | null
  zoomClass: string
  zoomStyle: CSSProperties
  onClose: () => void
}) {
  const { t } = useI18n()
  const [model, setModel] = useState<CollateModel>(() => buildModel(redline ?? editor.state.doc))
  const [current, setCurrent] = useState(0)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    // the redline was computed when 对校 was clicked: a static pair of sheets
    if (redline) {
      setModel(buildModel(redline))
      return
    }
    const sync = () => setModel(buildModel(editor.state.doc))
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
  }, [editor, redline])

  // edits elsewhere can shrink the revision list: keep the cursor inside it
  useEffect(() => {
    setCurrent((c) => Math.min(c, Math.max(0, model.entries.length - 1)))
  }, [model])

  const currentRow = model.entries.length > 0 ? (model.entryRow[current] ?? -1) : -1
  useEffect(() => {
    if (currentRow >= 0) rowRefs.current[currentRow]?.scrollIntoView({ block: 'nearest' })
  }, [currentRow, model])

  const n = model.entries.length
  const empty = n === 0
  return (
    <div className="collate-pane">
      <div className="collate-pane-scroll">
        {empty ? (
          <div className="collate-empty">{t('appReviewPaneEmpty')}</div>
        ) : (
          <div className={`collate-zoom ${zoomClass}`} style={zoomStyle}>
            <div className="collate-spread">
              <div className="collate-paper collate-paper-left" aria-hidden="true" />
              <div className="collate-paper collate-paper-right" aria-hidden="true" />
              <div className="collate-rows">
                {model.rows.map((row, i) => (
                  <div
                    key={i}
                    data-testid={`collate-row-${i}`}
                    ref={(el) => {
                      rowRefs.current[i] = el
                    }}
                    className={`collate-row${currentRow === i ? ' current' : ''}`}
                  >
                    <div className="collate-cell collate-cell-orig">
                      <div
                        className="doc-page ProseMirror collate-frag"
                        dangerouslySetInnerHTML={{ __html: row.left }}
                      />
                    </div>
                    <div className="collate-cell collate-cell-rev">
                      {row.changed ? <span className="collate-chg-bar" aria-hidden="true" /> : null}
                      <div
                        className="doc-page ProseMirror collate-frag"
                        dangerouslySetInnerHTML={{ __html: row.right }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="collate-jump" role="toolbar" aria-label={t('appCollateTitle')}>
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
          className="collate-btn collate-close"
          data-testid="collate-close"
          aria-label={t('appClose')}
          onClick={onClose}
        >
          ×
        </button>
      </div>
    </div>
  )
}
