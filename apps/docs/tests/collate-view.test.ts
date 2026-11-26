// 对校 side-by-side collate view: the redline doc renders original-left /
// revised-right, replacements pair into one navigable entry, and per-change
// Accept acts on the live doc so both columns rebuild from the same state.
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
const settle = () => new Promise((resolve) => setTimeout(resolve, 450))

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

  function mount(content: unknown) {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: content as never,
    })
    editors.push(editor)
    const host = document.createElement('div')
    const root = createRoot(host)
    roots.push(root)
    act(() => {
      root.render(
        createElement(CollateView, { editor, zoomClass: '', zoomStyle: {}, onClose: noop }),
      )
    })
    return { editor, host }
  }

  afterEach(() => {
    while (roots.length) act(() => roots.pop()!.unmount())
    while (editors.length) editors.pop()!.destroy()
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

    // the inserted paragraph: chip on the left, content on the right
    expect(cells(2)[0].querySelector('.collate-chip')).not.toBeNull()
    expect(cells(2)[0].textContent).not.toContain('a brand new paragraph')
    expect(cells(2)[1].textContent).toContain('a brand new paragraph')
  })

  it('pairs the replacement into one entry and counts the inserted paragraph mark', () => {
    const { host } = mount(fixtureDoc())
    const count = host.querySelector('.collate-pane-count')!.textContent
    expect(count).toBe('1/2')
    expect(host.querySelector('[data-testid="collate-prev"]')!.hasAttribute('disabled')).toBe(true)
    expect(host.querySelector('[data-testid="collate-next"]')!.hasAttribute('disabled')).toBe(false)
  })

  it('accepting the replacement rebuilds both columns to the revised text', async () => {
    const { host, editor } = mount(fixtureDoc())
    // cursor starts on entry 0: the del+ins replacement in the second row
    const accept = host.querySelector('[data-testid="collate-accept"]') as HTMLButtonElement
    act(() => {
      accept.click()
    })
    // 300 ms debounced rebuild, like the split pane
    await act(async () => {
      await settle()
    })
    const rows = host.querySelectorAll('.collate-row')
    const cells = (i: number) => rows[i].querySelectorAll('.collate-cell')
    expect(cells(1)[0].textContent).toContain('new phrase')
    expect(cells(1)[0].textContent).not.toContain('old phrase')
    expect(cells(1)[1].textContent).toContain('new phrase')
    // the del mark is gone from the live doc: only the paragraph-mark revision remains
    expect(host.querySelector('.collate-pane-count')!.textContent).toBe('1/1')
    expect(editor.state.doc.toJSON().content[1].content.map((c: { text?: string }) => c.text)).toEqual(
      ['new phrase'],
    )
  })

  it('a doc without revisions shows the empty state, not the grid rows of marks', () => {
    const { host } = mount({ type: 'doc', content: [para([text('plain')])] })
    expect(host.querySelector('.collate-empty')).not.toBeNull()
    expect(host.querySelector('[data-testid="collate-accept"]')!.hasAttribute('disabled')).toBe(true)
  })
})
