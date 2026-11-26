import { describe, expect, it } from 'vitest'
import { splitTabTitle } from '../src/renderer/src/TabBar'

describe('splitTabTitle', () => {
  it('keeps short titles whole so the tab shows them normally', () => {
    expect(splitTabTitle('Notes.docx')).toEqual({ head: 'Notes.docx', tail: '' })
    expect(splitTabTitle('Untitled Document')).toEqual({ head: 'Untitled Document', tail: '' })
  })

  it('gives the last characters to the tail of a long latin name', () => {
    const title = 'Quarterly-Business-Review-2027-Final-Report.docx'
    const { head, tail } = splitTabTitle(title)
    expect(tail).toBe('ort.docx')
    expect(head + tail).toBe(title)
    expect(tail).toBe(title.slice(-8))
  })

  it('keeps the version suffix in the tail of a long cjk name', () => {
    const title = '面向未来城市基础设施的智慧能源管理系统设计方案终版v3.docx'
    const { head, tail } = splitTabTitle(title)
    expect(head + tail).toBe(title)
    expect(tail).toContain('v3.docx')
  })

  it('splits at the character boundary, never mid surrogate pair', () => {
    const title = `${'项目'.repeat(20)}📄v2.docx`
    const { head, tail } = splitTabTitle(title)
    expect(head + tail).toBe(title)
    expect(tail).toBe('📄v2.docx')
    // neither side may contain a lone surrogate
    for (const part of [head, tail]) {
      for (let i = 0; i < part.length; i++) {
        const code = part.charCodeAt(i)
        const lone =
          code >= 0xd800 &&
          code <= 0xdbff &&
          !(i + 1 < part.length && part.charCodeAt(i + 1) >= 0xdc00 && part.charCodeAt(i + 1) <= 0xdfff)
        expect(lone).toBe(false)
      }
    }
  })

  it('never splits titles at or below the minimum length', () => {
    const boundary = 'a'.repeat(24)
    expect(splitTabTitle(boundary).tail).toBe('')
    const over = 'a'.repeat(25)
    const split = splitTabTitle(over)
    expect(split.tail).toHaveLength(8)
    expect(split.head).toHaveLength(17)
  })
})
