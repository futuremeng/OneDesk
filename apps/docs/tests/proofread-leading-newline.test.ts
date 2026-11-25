/**
 * The LLM proofread pass treats the raw reply as the corrected sentence, so a
 * leading artifact lands in the document verbatim. The gateway-backed chain
 * prefixes every content with the `\n\n` its reasoning split leaked (measured
 * 2026-11-25: 'Reply with exactly: up' → content '\n\nup'); minimalEdits then
 * emits a phantom newline insertion at the paragraph start, which shows in the
 * reviewing list as a blank row next to the 修改 pair. extractText must eat
 * leading newlines — a paragraph's text never starts with one — while keeping
 * the fence tolerance and untouched replies intact.
 */
import { describe, expect, it } from 'vitest'

import { extractText } from '../src/renderer/editor/proofread'

describe('extractText', () => {
  it('strips the newline prefix the chain injects before the corrected text', () => {
    expect(extractText('\n\n由于公司的业务模式发生改变。').text).toBe('由于公司的业务模式发生改变。')
    expect(extractText('\r\n\r\nup').text).toBe('up')
  })

  it('still tolerates a code fence after the stripped newlines', () => {
    expect(extractText('\n\n```\nsentence\n``` ').text).toBe('sentence')
    expect(extractText('```\nsentence\n```').text).toBe('sentence')
  })

  it('keeps a bare reply byte-identical', () => {
    expect(extractText('由于公司的业务模式发生改变。').text).toBe('由于公司的业务模式发生改变。')
  })
})
