/**
 * 对校 side-by-side collate view: the second rendering of a redline document.
 * Instead of a second editor instance, the current PM doc is transformed into
 * a left/right pair per top-level block — deleted text falls to the left
 * (original) column, inserted text to the right (revised) column, untouched
 * text to both — and each half is serialized with the schema's own DOMSerializer.
 * Navigation and per-change Accept/Reject run on the live doc through
 * collectRevisions / buildReviewEntries / applyRevisions, so the inline view
 * and this view stay one and the same document.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Editor } from '@tiptap/core'
import { DOMSerializer, Fragment, type Node as PmNode } from '@tiptap/pm/model'
import { useI18n } from '../i18n/locale'
import { applyRevisions, collectRevisions } from '../editor/revisions'
import { buildReviewEntries, type ReviewEntry } from '../editor/revision-filters'

interface CollateRow {
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

/** one side of a textblock: left drops inserted runs, right drops deleted runs */
function keepSide(node: PmNode, side: 'left' | 'right'): PmNode {
  if (!node.isTextblock) return node
  const keep: PmNode[] = []
  node.forEach((child) => {
    const ins = child.marks.some((m) => m.type.name === 'ins')
    const del = child.marks.some((m) => m.type.name === 'del')
    if (side === 'left' ? ins && !del : del && !ins) return
    keep.push(child)
  })
  return node.copy(Fragment.from(keep))
}

function buildModel(editor: Editor): CollateModel {
  const { doc } = editor.state
  const serializer = DOMSerializer.fromSchema(editor.schema)
  const render = (node: PmNode): string => {
    const holder = document.createElement('div')
    holder.appendChild(serializer.serializeFragment(Fragment.from(node)))
    return holder.innerHTML
  }
  const rows: CollateRow[] = []
  doc.forEach((node, pos) => {
    const paraIns = node.attrs?.paraMarkIns != null
    const paraDel = node.attrs?.paraMarkDel != null
    rows.push({
      pos,
      end: pos + node.nodeSize,
      left: paraIns ? '' : render(keepSide(node, 'left')),
      right: paraDel ? '' : render(keepSide(node, 'right')),
      chip: paraIns ? 'paraIns' : paraDel ? 'paraDel' : undefined,
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
        <div className={zoomClass} style={zoomStyle}>
          <div className="collate-grid">
            <div className="collate-head-row">
              <div className="collate-head">{t('appCollateOriginal')}</div>
              <div className="collate-head">{t('appCollateRevised')}</div>
            </div>
            {model.rows.map((row, i) => (
              <div
                key={i}
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
          </div>
          {empty && <div className="collate-empty">{t('appReviewPaneEmpty')}</div>}
          <div className="collate-note">{t('appCollateNote')}</div>
        </div>
      </div>
    </div>
  )
}
