/**
 * The detect path's pure helpers: the service reports spans as BYTE offsets
 * into the submitted text, so the byte→UTF-16 walk and the error filtering
 * are where a CJK-span bug would land.
 */
import { describe, expect, it } from 'vitest'

import { detectEdits, errorTypeLabelKey, matchFeedbackEdit, proofreadLangHint } from '../src/renderer/editor/proofread'

describe('detectEdits', () => {
  it('maps byte spans to UTF-16 offsets and keeps the correction', () => {
    const text = '他去了买书的地方的。' // 10 chars x 3 bytes
    const edits = detectEdits(text, [{ span: [0, 15], original: '他去了买书', correction: '他去买书' }])
    expect(edits).toMatchObject([{ start: 0, end: 5, text: '他去买书' }])
  })

  it('carries the service\'s raw error object so it can travel back verbatim', () => {
    const raw = {
      lang: 'zh',
      error_type: 'grammar',
      span: [0, 15],
      original: '要充分的重视',
      correction: '要充分地重视',
      source: 'llm',
    }
    const edits = detectEdits('各部门要充分的重视这项工作。', [raw])
    expect(edits).toHaveLength(1)
    expect(edits[0].error).toBe(raw)
  })

  it('skips null and no-op corrections, and lets the first of overlapping spans win', () => {
    const text = 'abcdefghij'
    const errors = [
      { span: [0, 3], correction: null }, // sentence-level verdict without a fix: skipped
      { span: [0, 3], correction: 'abc' }, // already correct: skipped
      { span: [0, 6], correction: 'XYZ' }, // first overlap wins
      { span: [3, 6], correction: 'QQQ' }, // overlaps it: dropped
      { span: [7, 10], correction: '!' }, // later, disjoint: kept
    ]
    expect(detectEdits(text, errors)).toMatchObject([
      { start: 0, end: 6, text: 'XYZ' },
      { start: 7, end: 10, text: '!' },
    ])
  })

  it('sorts out-of-order spans by document position', () => {
    const edits = detectEdits('abcdefghij', [
      { span: [7, 10], correction: '!' },
      { span: [1, 2], correction: 'X' },
    ])
    expect(edits).toMatchObject([
      { start: 1, end: 2, text: 'X' },
      { start: 7, end: 10, text: '!' },
    ])
  })

  it('counts an emoji as 4 UTF-8 bytes but 2 UTF-16 units', () => {
    const edits = detectEdits('\u{1F600}ok', [{ span: [4, 6], correction: 'X' }])
    expect(edits).toMatchObject([{ start: 2, end: 4, text: 'X' }])
  })

  it('clamps a span that runs past the end of the paragraph', () => {
    const edits = detectEdits('中', [{ span: [0, 999], correction: '文' }])
    expect(edits).toMatchObject([{ start: 0, end: 1, text: '文' }])
  })
})

describe('proofreadLangHint', () => {
  it('routes by script: kana wins, then Han, then Latin, else zh', () => {
    expect(proofreadLangHint('こんにちは')).toBe('ja')
    expect(proofreadLangHint('漢字にmixed')).toBe('ja')
    expect(proofreadLangHint('去图书馆借书')).toBe('zh')
    expect(proofreadLangHint('The cat run fast')).toBe('en')
    expect(proofreadLangHint('123 !!!')).toBe('zh')
  })
})

describe('errorTypeLabelKey', () => {
  it('folds the service taxonomy to the labeled buckets', () => {
    expect(errorTypeLabelKey({ error_type: 'grammar' })).toBe('aiRevTypeGrammar')
    expect(errorTypeLabelKey({ error_type: 'pos_error' })).toBe('aiRevTypeGrammar')
    expect(errorTypeLabelKey({ error_type: 'semantic_dup' })).toBe('aiRevTypeGrammar')
    expect(errorTypeLabelKey({ error_type: 'extra_char' })).toBe('aiRevTypeSpelling')
    expect(errorTypeLabelKey({ error_type: 'missing_char' })).toBe('aiRevTypeSpelling')
    expect(errorTypeLabelKey({ error_type: 'tense' })).toBe('aiRevTypeGrammar')
    expect(errorTypeLabelKey({ error_type: 'particle' })).toBe('aiRevTypeGrammar')
    expect(errorTypeLabelKey({ error_type: 'punctuation' })).toBe('aiRevTypePunctuation')
    expect(errorTypeLabelKey({ error_type: 'collocation' })).toBe('aiRevTypeCollocation')
    expect(errorTypeLabelKey({ error_type: 'anomaly' })).toBe('aiRevTypeAnomaly')
    expect(errorTypeLabelKey({ error_type: 'numeral' })).toBe('aiRevTypeNumeral')
    expect(errorTypeLabelKey({ error_type: 'quantity_unit' })).toBe('aiRevTypeQuantityUnit')
    expect(errorTypeLabelKey({ error_type: 'serial_no' })).toBe('aiRevTypeSerialNo')
    expect(errorTypeLabelKey({ error_type: 'mystery' })).toBe('aiRevTypeOther')
    expect(errorTypeLabelKey(null)).toBe('aiRevTypeOther')
    expect(errorTypeLabelKey('nope')).toBe('aiRevTypeOther')
  })
})

describe('matchFeedbackEdit', () => {
  const edit = (over: object) => ({
    error: { error_type: 'grammar' },
    original: '要充分的重视',
    correction: '要充分地重视',
    lang: 'zh',
    paraText: '各部门要充分的重视这项工作。',
    from: 100,
    to: 105,
    reported: false,
    ...over,
  })

  it('matches a drifted row by its text, ignoring positions', () => {
    const edits = [edit({})]
    expect(matchFeedbackEdit(edits, '要充分地重视', 940, 946)).toBe(edits[0])
    expect(matchFeedbackEdit(edits, '要充分的重视', 5, 10)).toBe(edits[0])
  })

  it('breaks text ties by proximity and skips reported edits unless told otherwise', () => {
    const near = edit({ from: 200, to: 205 })
    const far = edit({ from: 900, to: 905 })
    const edits = [far, near]
    expect(matchFeedbackEdit(edits, '要充分地重视', 210, 216)).toBe(near)
    near.reported = true
    expect(matchFeedbackEdit(edits, '要充分地重视', 210, 216)).toBe(far)
    expect(matchFeedbackEdit(edits, '要充分地重视', 210, 216, true)).toBe(near)
  })

  it('falls back to span overlap with no text hit, and misses unrelated rows', () => {
    const edits = [edit({})]
    expect(matchFeedbackEdit(edits, '完全不同的文本', 102, 130)).toBe(edits[0])
    expect(matchFeedbackEdit(edits, '完全不同的文本', 400, 430)).toBe(null)
  })
})
