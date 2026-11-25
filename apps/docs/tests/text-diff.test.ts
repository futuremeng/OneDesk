import { describe, expect, it } from 'vitest'
import { diffText, type DiffSegment } from '../src/renderer/ai/text-diff'

const render = (segs: DiffSegment[], side: 'old' | 'new'): string =>
  segs
    .filter((g) => g.type === 'same' || (side === 'old' ? g.type === 'del' : g.type === 'ins'))
    .map((g) => g.text)
    .join('')

describe('diffText', () => {
  it('returns one same run for identical text', () => {
    expect(diffText('同一段', '同一段')).toEqual([{ type: 'same', text: '同一段' }])
  })

  it('marks pure insertions and pure deletions', () => {
    expect(diffText('', '新增')).toEqual([{ type: 'ins', text: '新增' }])
    expect(diffText('删掉', '')).toEqual([{ type: 'del', text: '删掉' }])
  })

  it('keeps common prefix and suffix as same runs around the change', () => {
    // 止 is the common char; alignment may put it before or after depending on
    // LCS tie-break, so assert the reconstructed strings instead.
    const segs = diffText('禁止', '防止')
    expect(render(segs, 'old')).toBe('禁止')
    expect(render(segs, 'new')).toBe('防止')
  })

  it('separates the insertion in the section-7 style example', () => {
    const oldT = '能够防止提前打听任务、私自翻看他人经办的检查任务等问题。'
    const newT = '这种分级管理机制能够防止提前打听任务、私自翻看他人经办的检查任务等问题。'
    const segs = diffText(oldT, newT)
    expect(segs).toEqual([
      { type: 'ins', text: '这种分级管理机制' },
      { type: 'same', text: oldT },
    ])
  })

  it('handles replacement in the middle with same runs on both sides', () => {
    const segs = diffText('围绕权限管控和留痕功能', '围绕权限管控与留痕功能')
    expect(render(segs, 'old')).toBe('围绕权限管控和留痕功能')
    expect(render(segs, 'new')).toBe('围绕权限管控与留痕功能')
    expect(segs.some((g) => g.type === 'del' && g.text === '和')).toBe(true)
    expect(segs.some((g) => g.type === 'ins' && g.text === '与')).toBe(true)
  })

  it('both segment rows cover both strings in order', () => {
    const oldT = '涉及企业和个人的手机号、身份证号统一加密。'
    const newT = '对涉及企业和个人的手机号、身份证号等进行统一加密。'
    const segs = diffText(oldT, newT)
    expect(render(segs, 'old')).toBe(oldT)
    expect(render(segs, 'new')).toBe(newT)
  })

  it('merges adjacent runs and falls back for very long middles', () => {
    const a = `x${'中'.repeat(600)}y`
    const b = `x${'文'.repeat(600)}y`
    const segs = diffText(a, b)
    expect(render(segs, 'old')).toBe(a)
    expect(render(segs, 'new')).toBe(b)
    expect(segs.filter((g) => g.type === 'del')).toHaveLength(1)
    expect(segs.filter((g) => g.type === 'ins')).toHaveLength(1)
  })
})
