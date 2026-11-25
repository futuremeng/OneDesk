import { useMemo } from 'react'
import { diffText } from './text-diff'

/**
 * The suggestion's old/new line pair aligned by character: both rows render
 * the same segment stream, so every matching character (and the ellipsis
 * cut-off point) lines up vertically. Only the runs that actually differ are
 * decorated - deletions keep a strikethrough on the old row, insertions an
 * underline on the new row; the counterpart run in the other row stays as an
 * invisible placeholder purely to hold its width.
 */
export function ProofreadDiffRows({ oldText, newText }: { oldText: string; newText: string }) {
  const segs = useMemo(() => diffText(oldText, newText), [oldText, newText])
  const row = (side: 'del' | 'ins') =>
    segs.map((g, i) => {
      if (g.type === 'same') return <span key={i}>{g.text}</span>
      if (g.type === side)
        return (
          <span key={i} className={side === 'del' ? 'diff-del' : 'diff-ins'}>
            {g.text}
          </span>
        )
      return (
        <span key={i} className="diff-ghost" aria-hidden>
          {g.text}
        </span>
      )
    })
  return (
    <>
      <div className="ai-revision-row-text">{row('del')}</div>
      <div className="ai-revision-row-text">{row('ins')}</div>
    </>
  )
}
