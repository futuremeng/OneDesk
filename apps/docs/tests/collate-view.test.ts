// 对校 side-by-side collate view: the redline doc renders as two facing paper
// sheets — each holding its own side of every change, shown only as a
// highlight (no underline, no strikethrough, so the sheets cannot be mistaken
// for the document's own revision display), with a change bar in the right
// sheet's margin on every row that holds a change.
// Replacements (inline and whole paragraph) pair into one row, and the live
// doc's marks only serve as the fallback source when the tab kept no
// previous-version snapshot.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { CollateView } from '../src/renderer/components/CollateView'

// React's act() needs the test environment flag; jsdom lacks scrollIntoView
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const DATE = '2026-01-01T00:00:00Z'
const record = JSON.stringify({ author: 'Me', date: DATE })
const noop = () => {}

function para(children: unknown[], attrs: Record<string, unknown> = {}) {
  return { type: 'docParagraph', attrs, content: children }
}
const text = (t: string, mark?: 'ins' | 'del') => ({
  type: 'text',
  text: t,
  ...(mark ? { marks: [{ type: mark, attrs: { author: 'Me', date: DATE } }] } : {}),
})

function fixtureDoc() {
  return {
    type: 'doc',
    content: [
      para([text('untouched text')]),
      para([text('old phrase', 'del'), text('new phrase', 'ins')]),
      para([text('a brand new paragraph')], { paraMarkIns: record, paraMarkDel: null }),
      para([text('kept both sides')]),
    ],
  }
}

describe('CollateView', () => {
  const roots: Root[] = []
  const editors: Editor[] = []

  function mount(content: unknown, redlineJson?: unknown, onClose = noop) {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: content as never,
    })
    editors.push(editor)
    const redline = redlineJson ? editor.schema.nodeFromJSON(redlineJson) : null
    const host = document.createElement('div')
    const root = createRoot(host)
    roots.push(root)
    act(() => {
      root.render(
        createElement(CollateView, {
          editor,
          redline,
          zoomClass: '',
          zoomStyle: {},
          onClose,
        }),
      )
    })
    return { editor, host }
  }

  afterEach(() => {
    while (roots.length) act(() => roots.pop()!.unmount())
    while (editors.length) editors.pop()!.destroy()
  })

  it('renders two facing sheets with no header bar: navigation rides in the bottom capsule', () => {
    const { host } = mount(fixtureDoc())
    expect(host.querySelectorAll('.collate-paper')).toHaveLength(2)
    expect(host.querySelector('.collate-pane-bar')).toBeNull()
    expect(host.querySelector('.collate-head-row')).toBeNull()
    const jump = host.querySelector('.collate-jump')
    expect(jump).not.toBeNull()
    expect(jump!.querySelector('[data-testid="collate-prev"]')).not.toBeNull()
    expect(jump!.querySelector('[data-testid="collate-next"]')).not.toBeNull()
    expect(jump!.querySelector('[data-testid="collate-close"]')).not.toBeNull()
  })

  it('renders original left and revised right: deletions only left, insertions only right', () => {
    const { host } = mount(fixtureDoc())
    const rows = host.querySelectorAll('.collate-row')
    expect(rows).toHaveLength(4)
    const cells = (i: number) => rows[i].querySelectorAll('.collate-cell')

    // untouched: both columns
    expect(cells(0)[0].textContent).toContain('untouched text')
    expect(cells(0)[1].textContent).toContain('untouched text')

    // the replacement: the old run only on the left, the new one only on the right
    expect(cells(1)[0].textContent).toContain('old phrase')
    expect(cells(1)[0].textContent).not.toContain('new phrase')
    expect(cells(1)[1].textContent).toContain('new phrase')
    expect(cells(1)[1].textContent).not.toContain('old phrase')

    // the inserted paragraph: nothing but space on the left, content on the right
    expect(cells(2)[0].querySelector('.collate-frag')!.textContent).toBe('')
    expect(cells(2)[0].textContent).toBe('')
    expect(cells(2)[1].textContent).toContain('a brand new paragraph')
  })

  it('marks the change on each side only as a highlight: deletions left, insertions right', () => {
    const { host } = mount(fixtureDoc())
    const rows = host.querySelectorAll('.collate-row')
    const orig = rows[1].querySelector('.collate-cell-orig')!
    expect(orig.textContent).toContain('old phrase')
    // the deleted run stays a del run on the left sheet (highlighted by CSS,
    // never underlined or struck through)
    expect(orig.querySelector('.doc-del')?.textContent).toContain('old phrase')
    expect(orig.querySelector('.doc-ins')).toBeNull()
    // the right sheet shows the insertion, and shows no deleted runs
    const rev = rows[1].querySelector('.collate-cell-rev')!
    expect(rev.querySelector('.doc-ins')?.textContent).toContain('new phrase')
    expect(rev.querySelector('.doc-del')).toBeNull()
  })

  it('marks changed rows with a change bar in the right sheet margin only', () => {
    const { host } = mount(fixtureDoc())
    const rows = host.querySelectorAll('.collate-row')
    // untouched row: no bar on either sheet
    expect(rows[0].querySelector('.collate-chg-bar')).toBeNull()
    // the inline replacement and the inserted paragraph: one bar, on the right
    for (const i of [1, 2]) {
      expect(rows[i].querySelector('.collate-cell-orig .collate-chg-bar')).toBeNull()
      expect(rows[i].querySelector('.collate-cell-rev .collate-chg-bar')).not.toBeNull()
    }
    // the paragraph after the changes: back to no bar
    expect(rows[3].querySelector('.collate-chg-bar')).toBeNull()
  })

  it('pairs the replacement into one entry and counts the inserted paragraph mark', () => {
    const { host } = mount(fixtureDoc())
    const count = host.querySelector('.collate-pane-count')!.textContent
    expect(count).toBe('1/2')
    expect(host.querySelector('[data-testid="collate-prev"]')!.hasAttribute('disabled')).toBe(true)
    expect(host.querySelector('[data-testid="collate-next"]')!.hasAttribute('disabled')).toBe(false)
  })

  it('the close button in the capsule closes the view', () => {
    let closed = false
    const { host } = mount(fixtureDoc(), undefined, () => {
      closed = true
    })
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-testid="collate-close"]')!.click()
    })
    expect(closed).toBe(true)
  })

  it('renders the in-memory redline doc instead of the live editor doc', () => {
    // the 对校 sheets come from the diff kept in memory; the editor underneath
    // may show anything (here: the current version without any marks)
    const { host } = mount(
      { type: 'doc', content: [para([text('current version, no marks')])] },
      fixtureDoc(),
    )
    const rows = host.querySelectorAll('.collate-row')
    expect(rows).toHaveLength(4)
    const cells = rows[1].querySelectorAll('.collate-cell')
    expect(cells[0].textContent).toContain('old phrase')
    expect(cells[1].textContent).toContain('new phrase')
    expect(host.querySelector('.collate-pane-count')!.textContent).toBe('1/2')
  })

  it('pairs a whole-paragraph replacement into one row: deleted left, inserted right', () => {
    const { host } = mount({
      type: 'doc',
      content: [
        para([text('before the swap')]),
        para([text('the old paragraph', 'del')], { paraMarkDel: record, paraMarkIns: null }),
        para([text('the new paragraph', 'ins')], { paraMarkIns: record, paraMarkDel: null }),
        para([text('after the swap')]),
      ],
    })
    // before | the replacement as ONE row | after: the sheets never sit apart
    const rows = host.querySelectorAll('.collate-row')
    expect(rows).toHaveLength(3)
    const mid = rows[1].querySelectorAll('.collate-cell')
    expect(mid[0].textContent).toContain('the old paragraph')
    expect(mid[0].textContent).not.toContain('the new paragraph')
    // the left shows the deleted paragraph as a highlighted del run
    expect(mid[0].querySelector('.doc-del')?.textContent).toContain('the old paragraph')
    expect(mid[1].textContent).toContain('the new paragraph')
    expect(mid[1].textContent).not.toContain('the old paragraph')
    // one change bar for the whole swap, on the right sheet
    expect(rows[1].querySelectorAll('.collate-chg-bar')).toHaveLength(1)
    // the text after the swap aligns on both sheets at the same row
    const after = rows[2].querySelectorAll('.collate-cell')
    expect(after[0].textContent).toContain('after the swap')
    expect(after[1].textContent).toContain('after the swap')
  })

  it('segments a mid-paragraph change so the text after it aligns on both sheets', () => {
    const { host } = mount({
      type: 'doc',
      content: [
        para([text('before '), text('old word', 'del'), text('new word', 'ins'), text(' after')]),
        para([text('next paragraph')]),
      ],
    })
    // plain run | replacement | plain run | next paragraph
    const rows = host.querySelectorAll('.collate-row')
    expect(rows).toHaveLength(4)
    // the unchanged runs pair with themselves: identical on both columns
    for (const i of [0, 2]) {
      const cells = rows[i].querySelectorAll('.collate-cell')
      expect(cells[0].textContent).toBe(cells[1].textContent)
      expect(cells[0].textContent!.trim().length).toBeGreaterThan(0)
    }
    // the replacement shares one row: the old run left, the new run right
    const mid = rows[1].querySelectorAll('.collate-cell')
    expect(mid[0].textContent).toContain('old word')
    expect(mid[0].textContent).not.toContain('new word')
    expect(mid[1].textContent).toContain('new word')
    expect(mid[1].textContent).not.toContain('old word')
    // the row after the change keeps both columns side by side: character-aligned
    expect(rows[2].querySelector('.collate-cell')!.textContent).toContain('after')
  })

  it('a doc without revisions shows the empty state, not the grid rows of marks', () => {
    const { host } = mount({ type: 'doc', content: [para([text('plain')])] })
    expect(host.querySelector('.collate-empty')).not.toBeNull()
    expect(host.querySelector('[data-testid="collate-prev"]')!.hasAttribute('disabled')).toBe(true)
  })
})
