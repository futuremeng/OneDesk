/**
 * Word's Review → Show Markup filters and Reviewing Pane model, layered over
 * collectRevisions without touching the recorder: which revisions the current
 * view shows, per-author ink assignment, and the pane's entry list.
 */
import type { Node as PmNode } from '@tiptap/pm/model'
import type { RevisionRange } from './revisions'

export const REVISION_INK_COUNT = 8

/** Accept / Reject menu targets (Word's dropdown): one change, every change, the filtered view, one author, the selection */
export type RevisionScope = 'next' | 'all' | 'shown' | 'selection' | { author: string }

export type RevisionGroup = 'insDel' | 'format'

export interface RevisionFilter {
  insDel: boolean
  format: boolean
  /** authors unticked under Specific People */
  hiddenAuthors: string[]
}

export const DEFAULT_REVISION_FILTER: RevisionFilter = {
  insDel: true,
  format: true,
  hiddenAuthors: [],
}

const FORMAT_KINDS = new Set<RevisionRange['kind']>([
  'rPrChange',
  'pPrChange',
  'paraMarkRPrChange',
  'tblPrChange',
  'tblGridChange',
  'trPrChange',
  'tblPrExChange',
  'tcPrChange',
  'cellMerge',
  'numberingChange',
  'sectPrChange',
])

export function revisionGroup(kind: RevisionRange['kind']): RevisionGroup {
  return FORMAT_KINDS.has(kind) ? 'format' : 'insDel'
}

export function revisionShown(
  filter: RevisionFilter,
  rev: Pick<RevisionRange, 'kind' | 'author'>,
): boolean {
  if (filter.hiddenAuthors.includes(rev.author)) return false
  return revisionGroup(rev.kind) === 'format' ? filter.format : filter.insDel
}

export function filterRevisions<T extends Pick<RevisionRange, 'kind' | 'author'>>(
  ranges: T[],
  filter: RevisionFilter,
): T[] {
  return ranges.filter((r) => revisionShown(filter, r))
}

/** revisions touching a (non-empty) selection; a caret inside a range counts */
export function revisionsInSelection<T extends Pick<RevisionRange, 'from' | 'to'>>(
  ranges: T[],
  from: number,
  to: number,
): T[] {
  return ranges.filter((r) =>
    from === to ? from >= r.from && from <= r.to : r.from < to && r.to > from,
  )
}

/** authors in order of first appearance; ink index = position mod REVISION_INK_COUNT */
export function revisionAuthors(ranges: Array<Pick<RevisionRange, 'author'>>): string[] {
  const out: string[] = []
  for (const r of ranges) if (!out.includes(r.author)) out.push(r.author)
  return out
}

export function authorInkIndex(authors: string[], author: string): number {
  const i = authors.indexOf(author)
  return i < 0 ? 0 : i % REVISION_INK_COUNT
}

const cssString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * Stylesheet mapping each author's marks to their ink and hiding unticked
 * authors as if accepted. Author index 0 keeps the default ink, so a
 * single-author document renders exactly as before. Moves keep Word's move
 * color whoever made them.
 */
export function revisionAuthorCss(
  authors: string[],
  hiddenAuthors: string[],
  movesByAuthor: { from: boolean; to: boolean } = { from: false, to: false },
): string {
  const rules: string[] = []
  const insSel = movesByAuthor.to ? '' : ':not(.doc-move-to)'
  const delSel = movesByAuthor.from ? '' : ':not(.doc-move-from)'
  authors.forEach((author, i) => {
    const idx = i % REVISION_INK_COUNT
    if (idx === 0) return
    const a = cssString(author)
    rules.push(
      `.doc-ins[data-ins-author=${a}]${insSel},.doc-del[data-del-author=${a}]${delSel},.has-rpr-change[data-rpr-author=${a}]{--docs-paper-rev-ink:var(--docs-paper-rev-ink-${idx})}`,
    )
  })
  for (const author of hiddenAuthors) {
    const a = cssString(author)
    rules.push(
      `.doc-ins[data-ins-author=${a}]{color:inherit;text-decoration:none;font-weight:inherit;font-style:inherit}`,
      `.doc-del[data-del-author=${a}]{display:none}`,
      `.doc-del-marker[data-del-author=${a}]{display:none}`,
      `.has-rpr-change[data-rpr-author=${a}]{color:inherit;text-decoration:none;font-weight:inherit;font-style:inherit}`,
      `.has-move-from[data-rev-author=${a}]{display:none}`,
      `.has-move-to[data-rev-author=${a}]{background:none}`,
      `.has-ppr-change[data-ppr-change-author=${a}]{border-left:none;padding-left:0}`,
      `.has-ppr-change[data-ppr-change-author=${a}]::after{content:none}`,
    )
  }
  return rules.join('\n')
}

export interface ReviewEntry {
  rev: RevisionRange
  /**
   * When set, this row's change and `pair` are the two halves of one
   * replacement: a tracked delete next to a tracked insert by the same
   * reviewer in the same pass. One row, one Accept/Reject for both.
   */
  pair?: RevisionRange
  /** the 修改 row's two contrasting lines: text removed and text that replaces it */
  pairFrom?: string
  pairTo?: string
  index: number
  /** first characters of the changed text; empty for row/cell/paragraph-only changes */
  excerpt: string
  inkIndex: number
}

export const EXCERPT_CHARS = 60

export function revisionExcerpt(
  doc: PmNode,
  rev: Pick<RevisionRange, 'from' | 'to'>,
  onlyMark?: 'ins' | 'del',
): string {
  const from = Math.max(0, Math.min(rev.from, doc.content.size))
  const to = Math.max(from, Math.min(rev.to, doc.content.size))
  // 只留自己那一半：修改行的删除行不能把落在同一区段里的插入文本也念出来
  const leafText = onlyMark
    ? (node: PmNode) => (node.marks.some((m) => m.type.name === onlyMark) ? node.text || '' : '')
    : ' '
  const text = doc.textBetween(from, to, ' ', leafText).replace(/\s+/g, ' ').trim()
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1)}…` : text
}

export function buildReviewEntries(
  doc: PmNode,
  ranges: RevisionRange[],
  authors = revisionAuthors(ranges),
): ReviewEntry[] {
  const out: ReviewEntry[] = []
  for (let i = 0; i < ranges.length; i++) {
    const rev = ranges[i]
    const next = ranges[i + 1]
    // 改写在修订流里表现为一条 ins 挨着（或交叠在）一条 del。同一作者、
    // 两段范围相接或重叠即视为一次替换，列成一行；两半的时间戳可以不同：
    // 分别落事务或被下一轮审校再编辑时不会相等。
    const replaces =
      !!next &&
      !rev.story &&
      !next.story &&
      rev.author === next.author &&
      // 同一段文字同时挂着两个 mark（先插入后被删除）时两半是同一串文本，
      // 折成对照行只会两行一模一样，不如保持各自一行
      !rev.overlapped &&
      !next.overlapped &&
      ((rev.kind === 'ins' && next.kind === 'del') ||
        (rev.kind === 'del' && next.kind === 'ins')) &&
      rev.from <= next.to &&
      next.from <= rev.to
    if (replaces) {
      const del = rev.kind === 'del' ? rev : next
      const ins = rev.kind === 'del' ? next : rev
      const delText = revisionExcerpt(doc, del, 'del')
      const insText = revisionExcerpt(doc, ins, 'ins')
      out.push({
        rev,
        pair: next,
        pairFrom: delText,
        pairTo: insText,
        index: out.length,
        excerpt: capExcerpt(`${delText} → ${insText}`),
        inkIndex: authorInkIndex(authors, rev.author),
      })
      i++
    } else {
      out.push({
        rev,
        index: out.length,
        excerpt: rev.story ? rev.story.text.slice(0, EXCERPT_CHARS) : revisionExcerpt(doc, rev),
        inkIndex: authorInkIndex(authors, rev.author),
      })
    }
  }
  return out
}

function capExcerpt(text: string): string {
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1)}…` : text
}

/** per-kind tally; a move whose source is listed counts once, under moveFrom */
export function countByKind(
  ranges: Array<Pick<RevisionRange, 'kind' | 'moveId'>>,
): Map<RevisionRange['kind'], number> {
  const out = new Map<RevisionRange['kind'], number>()
  const sources = new Set(
    ranges.filter((r) => r.kind === 'moveFrom' && r.moveId).map((r) => r.moveId),
  )
  for (const r of ranges) {
    if (r.kind === 'moveTo' && r.moveId && sources.has(r.moveId)) continue
    out.set(r.kind, (out.get(r.kind) ?? 0) + 1)
  }
  return out
}

export interface RevisionSummary {
  insertions: number
  deletions: number
  moves: number
  formatting: number
}

const INSERT_KINDS = new Set<RevisionRange['kind']>([
  'ins',
  'paraMarkIns',
  'rowIns',
  'cellIns',
  'blockIns',
])

/** Word's Reviewing Pane summary lines; a move's two halves count once */
export function summarizeRevisions(
  ranges: Array<Pick<RevisionRange, 'kind' | 'moveId'>>,
): RevisionSummary {
  const out: RevisionSummary = { insertions: 0, deletions: 0, moves: 0, formatting: 0 }
  const moveIds = new Set<string>()
  for (const r of ranges) {
    if (r.kind === 'moveFrom' || r.kind === 'moveTo') {
      if (r.moveId) moveIds.add(r.moveId)
      else out.moves++
    } else if (INSERT_KINDS.has(r.kind)) out.insertions++
    else if (FORMAT_KINDS.has(r.kind)) out.formatting++
    else out.deletions++
  }
  out.moves += moveIds.size
  return out
}
