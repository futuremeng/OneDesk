import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'

import { editorExtensions } from '../src/renderer/editor/extensions'
import {
  landProofreadSuggestion,
  PROOFREAD_AUTHOR,
  type ProofreadSuggestion,
} from '../src/renderer/editor/proofread'
import {
  applyRevisions,
  collectRevisions,
  type TrackChangesStorage,
} from '../src/renderer/editor/revisions'

interface JsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}
const text = (t: string, marks?: JsonNode['marks']): JsonNode => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
})
const para = (...content: JsonNode[]): JsonNode => ({
  type: 'docParagraph',
  attrs: { docxIndex: null },
  content,
})

function trackingEditor(content: JsonNode[], enabled = true): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content },
  })
  const storage = editor.storage.trackChanges as TrackChangesStorage
  storage.enabled = enabled
  storage.author = 'Tester'
  return editor
}

function suggestion(
  paraText: string,
  start: number,
  end: number,
  correction: string,
): ProofreadSuggestion {
  return {
    id: 'x1',
    paraFrom: 1,
    paraTo: 1 + paraText.length + 1,
    start,
    end,
    original: paraText.slice(start, end),
    correction,
    paraText,
    feedback: {
      error: {},
      original: paraText.slice(start, end),
      correction,
      lang: 'zh',
      paraText,
      from: 0,
      to: 0,
      reported: false,
    },
  } as unknown as ProofreadSuggestion
}

/** the row 拒绝 the App would run on a landed row: collect the AI-authored
 * revisions overlapping the recorded span and reject them right-to-left */
function flipBack(editor: Editor, span: { from: number; to: number }): number {
  const live = collectRevisions(editor.state.doc)
    .filter((r) => r.author === PROOFREAD_AUTHOR && r.from < span.to && r.to > span.from)
    .sort((a, b) => b.from - a.from || b.to - a.to)
  applyRevisions(editor, live, 'reject')
  return live.length
}

function aiRevisions(editor: Editor) {
  return collectRevisions(editor.state.doc).filter((r) => r.author === PROOFREAD_AUTHOR)
}

describe('landProofreadSuggestion spans the landed revisions in the final doc', () => {
  it('pure insertion at paragraph end: span covers the ins revision, reject restores the text', () => {
    const p = '需要进一步处理。'
    const editor = trackingEditor([para(text(p))])
    const span = landProofreadSuggestion(editor, suggestion(p, 7, 7, '为'))
    expect(span).not.toBeNull()
    // the redline region in the final doc (the recorder runs after the tr)
    expect(editor.state.doc.textBetween(span!.from, span!.to, '↵')).toBe('为')
    const landedText = editor.state.doc.textBetween(span!.from, span!.to, '\u2029')
    expect(flipBack(editor, span!)).toBe(1)
    expect(editor.state.doc.textBetween(span!.from, span!.to, '\u2029')).not.toBe(landedText)
    expect(editor.state.doc.textContent).toBe(p)
    expect(aiRevisions(editor)).toHaveLength(0)
  })

  it('pure insertion mid-paragraph', () => {
    const p = 'ABCD。'
    const editor = trackingEditor([para(text(p))])
    const span = landProofreadSuggestion(editor, suggestion(p, 2, 2, 'X'))
    expect(editor.state.doc.textBetween(span!.from, span!.to, '↵')).toBe('X')
    expect(flipBack(editor, span!)).toBe(1)
    expect(editor.state.doc.textContent).toBe(p)
  })

  it('replacement island: both the del and the ins half land in the span', () => {
    const p = '要充分的重视。'
    const editor = trackingEditor([para(text(p))])
    const span = landProofreadSuggestion(editor, suggestion(p, 2, 3, '地'))
    // the redline holds BOTH the struck 分 and the inserted 地
    expect(editor.state.doc.textBetween(span!.from, span!.to, '↵')).toBe('分地')
    const landedText = editor.state.doc.textBetween(span!.from, span!.to, '\u2029')
    expect(flipBack(editor, span!)).toBe(2)
    // the App 拒绝→stale guard reads the same comparison
    expect(editor.state.doc.textBetween(span!.from, span!.to, '\u2029')).not.toBe(landedText)
    expect(editor.state.doc.textContent).toBe(p)
    expect(aiRevisions(editor)).toHaveLength(0)
  })

  it('pure deletion island: the struck text still sits in the span', () => {
    const p = '非常棒的东西。'
    const editor = trackingEditor([para(text(p))])
    const span = landProofreadSuggestion(editor, suggestion(p, 3, 5, ''))
    expect(editor.state.doc.textBetween(span!.from, span!.to, '↵')).toBe('的东')
    expect(flipBack(editor, span!)).toBe(1)
    expect(editor.state.doc.textContent).toBe(p)
  })

  it('two islands in one landing: the span unions both redline regions', () => {
    const p = 'AAA的BBB地CCC。'
    const editor = trackingEditor([para(text(p))])
    const span = landProofreadSuggestion(editor, suggestion(p, 3, 7, '地BBB的'))
    const live = collectRevisions(editor.state.doc).filter(
      (r) => r.author === PROOFREAD_AUTHOR && r.from < span!.to && r.to > span!.from,
    )
    expect(live.length).toBeGreaterThan(1)
    expect(flipBack(editor, span!)).toBe(live.length)
    expect(editor.state.doc.textContent).toBe(p)
    expect(aiRevisions(editor)).toHaveLength(0)
  })

  it('reject then re-accept round-trips', () => {
    const p = '要充分的重视。'
    const editor = trackingEditor([para(text(p))])
    const s = suggestion(p, 2, 3, '地')
    const span = landProofreadSuggestion(editor, s)
    expect(flipBack(editor, span!)).toBe(2)
    expect(editor.state.doc.textContent).toBe(p)
    const span2 = landProofreadSuggestion(editor, s)
    expect(editor.state.doc.textBetween(span2!.from, span2!.to, '↵')).toBe('分地')
    expect(flipBack(editor, span2!)).toBe(2)
    expect(editor.state.doc.textContent).toBe(p)
  })

  it('revisions accepted in 修订 end the row button: the stale guard sees it by text', () => {
    const p = '要充分的重视。'
    const editor = trackingEditor([para(text(p))])
    const span = landProofreadSuggestion(editor, suggestion(p, 2, 3, '地'))
    const landedText = editor.state.doc.textBetween(span!.from, span!.to, '\u2029')
    applyRevisions(editor, aiRevisions(editor), 'accept')
    // the App flip compares this and reports aiProofreadStale
    expect(editor.state.doc.textBetween(span!.from, span!.to, '\u2029')).not.toBe(landedText)
    expect(editor.state.doc.textContent).toBe('要充地的重视。')
  })

  it('a second landing in the same paragraph covers only its own revisions', () => {
    const p = '要充分的重视。需要进一步处理。'
    const editor = trackingEditor([para(text(p))])
    const spanA = landProofreadSuggestion(editor, suggestion(p, 14, 14, '为'))
    const aCount = aiRevisions(editor).length
    const spanB = landProofreadSuggestion(editor, suggestion(p, 2, 3, '地'))
    // B's span must not reach A's later redline
    expect(spanB!.from).toBeLessThan(spanB!.to)
    expect(spanB!.to).toBeLessThanOrEqual(spanA!.from)
    const liveB = aiRevisions(editor).filter((r) => r.from < spanB!.to && r.to > spanB!.from)
    expect(flipBack(editor, spanB!)).toBe(liveB.length)
    // A's insertion is untouched and still pending
    expect(aiRevisions(editor)).toHaveLength(aCount)
    expect(editor.state.doc.textContent).toBe('要充分的重视。需要进一步处理为。')
    expect(flipBack(editor, spanA!)).toBe(aCount)
    expect(editor.state.doc.textContent).toBe(p)
  })

  it('two identical suggestions land distinct spans', () => {
    const p = 'ABAB。'
    const editor = trackingEditor([para(text(p))])
    // second 先 lands; first (leftmost) then must span only its own region
    landProofreadSuggestion(editor, suggestion(p, 3, 4, 'X'))
    const span = landProofreadSuggestion(editor, suggestion(p, 1, 2, 'X'))
    const live = aiRevisions(editor).filter((r) => r.from < span!.to && r.to > span!.from)
    expect(flipBack(editor, span!)).toBe(live.length)
    // first undone; the second row's redline (struck B + its X) stays pending
    expect(editor.state.doc.textContent).toBe('ABABX。')
    expect(aiRevisions(editor)).toHaveLength(2)
  })

  it('tracking off: the suggestion lands as plain text with a usable span', () => {
    const p = '要充分的重视。'
    const editor = trackingEditor([para(text(p))], false)
    const span = landProofreadSuggestion(editor, suggestion(p, 2, 3, '地'))
    expect(editor.state.doc.textContent).toBe('要充地的重视。')
    expect(editor.state.doc.textBetween(span!.from, span!.to, '↵')).toBe('地')
    expect(aiRevisions(editor)).toHaveLength(0)
  })
})
