/**
 * AI proofread pass helpers (Review ▸ AI 审校 / F7, flow P01-P05).
 *
 * The run streams one textblock at a time to the configured model service and
 * lands every suggestion as a tracked revision: the edit is applied with
 * track mode on and `TRACK_AUTHOR` set to PROOFREAD_AUTHOR, so it round-trips
 * through w:ins/w:del like any other tracked change. Nothing here talks to the
 * chat path; no OneDesk sign-in is ever required (flow X01).
 */
import type { Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Mapping } from '@tiptap/pm/transform'
import { streamText, type AgentTransport } from '@onedesk/agent-core'
import type { AiSettings, ProofreadDetectResult } from '../../shared/ipc'
import { AI_PROVIDERS } from '../../shared/ipc'
import { TRACK_AUTHOR } from './revisions'

/** the revision author for suggestions that land in the document (flow P03) */
export const PROOFREAD_AUTHOR = 'AI'

/** one-time acknowledgement that a whole-document pass reads the full text (flow P01) */
export const AI_PROOFREAD_ACK_KEY = 'docs-ai-proofread-ack'

/** idle → running → review (all suggestions landed); stopped = interrupted (X02) */
export type ProofreadPhase = 'idle' | 'running' | 'stopped' | 'review' | 'unavailable'

/** what the AI panel shows for the pass; toast carries the already-translated line */
export interface ProofreadUiState {
  phase: ProofreadPhase
  done: number
  total: number
  toast: string | null
}

export interface ProofreadParagraph {
  from: number
  to: number
}

/**
 * Every non-empty textblock in document order — the paragraphs the pass walks.
 * Body and table cells only: header/footer and text-box sub-editors are
 * separate ProseMirror states and keep their own AI flows.
 */
export function collectProofreadParagraphs(
  doc: Node,
  range?: ProofreadParagraph | null,
): ProofreadParagraph[] {
  const out: ProofreadParagraph[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const from = pos + 1
    const to = pos + node.nodeSize - 1
    const f = range ? Math.max(from, range.from) : from
    const t = range ? Math.min(to, range.to) : to
    if (t > f && doc.textBetween(f, t).trim() !== '') out.push({ from: f, to: t })
    return false
  })
  return out
}

/** one character-level replacement; positions are relative to the paragraph text */
export interface ProofreadEdit {
  start: number
  end: number
  text: string
  /** the detect service's raw error this edit came from (LLM path: absent) */
  error?: unknown
}

/** one landed detect revision remembered for the accept/reject feedback loop:
 *  the raw error travels back to {baseUrl}/gec/feedback verbatim when the user
 *  accepts or rejects the revision, so positions only disambiguate matches and
 *  drift after later edits is tolerated (matching is by text first) */
export interface ProofreadFeedbackEdit {
  /** the detect response's raw error object, for the feedback request body */
  error: unknown
  /** error.original / error.correction when they are strings ('' otherwise) */
  original: string
  correction: string
  /** the service lang code this paragraph was detected with */
  lang: string
  /** the full paragraph text at detect time (feedback src_text) */
  paraText: string
  /** document positions right after the transaction that landed this edit */
  from: number
  to: number
  /** set once a feedback request went out for this error (bulk scope dedup) */
  reported: boolean
}

/** CJK chars stand alone; Latin/digit runs, whitespace and punctuation stay in one token */
function tokenize(s: string): { t: string; s: number; e: number }[] {
  const out: { t: string; s: number; e: number }[] = []
  const re = /[\u2E80-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]|[A-Za-z0-9]+(?:['’\-_.][A-Za-z0-9]+)*|\s+|[^\sA-Za-z0-9\u2E80-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) out.push({ t: m[0], s: m.index, e: m.index + m[0].length })
  return out
}

/** above this many tokens in either middle, one replace of the whole middle */
const LCS_TOKEN_CAP = 1200

/**
 * The character edits that turn `a` into exactly `b`: trim the common prefix
 * and suffix, then token-LCS the middles so equal islands stay untouched.
 * Applying the edits right-to-left reproduces `b` verbatim.
 */
export function minimalEdits(a: string, b: string): ProofreadEdit[] {
  if (a === b) return []
  // a trailing newline the model adds is not an edit
  if (a.replace(/\s+$/, '') === b.replace(/\s+$/, '')) return []
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let sa = a.length
  let sb = b.length
  while (sa > p && sb > p && a[sa - 1] === b[sb - 1]) {
    sa--
    sb--
  }
  const at = tokenize(a.slice(p, sa))
  const bt = tokenize(b.slice(p, sb))
  const n = at.length
  const m = bt.length
  if (n === 0 || m === 0 || n > LCS_TOKEN_CAP || m > LCS_TOKEN_CAP)
    return [{ start: p, end: sa, text: b.slice(p, sb) }]
  const w = m + 1
  const dp = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] =
        at[i].t === bt[j].t
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
  const matches: [number, number][] = []
  {
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (at[i].t === bt[j].t) {
        matches.push([i, j])
        i++
        j++
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++
      else j++
    }
  }
  const edits: ProofreadEdit[] = []
  let ai = p
  let bi = p
  for (const [ta, tb] of matches) {
    const aStart = p + at[ta].s
    const bStart = p + bt[tb].s
    if (aStart > ai) edits.push({ start: ai, end: aStart, text: b.slice(bi, bStart) })
    ai = p + at[ta].e
    bi = p + bt[tb].e
  }
  if (sa > ai) edits.push({ start: ai, end: sa, text: b.slice(bi, sb) })
  return edits
}

/**
 * Whether a model service can answer without a sign-in (flow X01). Mirrors the
 * activeProvider() fallback: a custom or OpenAI-style provider is usable with
 * its own endpoint or key, and the OneDesk cloud only counts when logged in —
 * when it is not, the pass shows the settings row instead of running.
 */
export function proofreadConfigured(settings: AiSettings, loggedIn: boolean): boolean {
  // an explicitly configured proofread service always answers (flow X01)
  if (settings.proofread?.baseUrl?.trim()) return true
  const meta = AI_PROVIDERS.find((p) => p.id === settings.provider) ?? AI_PROVIDERS[0]
  if (meta.id === 'onedesk') return loggedIn
  const config = settings.providers?.[meta.id]
  if (!config) return false
  if (meta.needsBaseUrl) return Boolean(config.baseUrl?.trim())
  return Boolean(config.apiKey?.trim() && config.model.trim())
}

export interface ProofreadPassResult {
  /** stopped when the signal aborted before the last paragraph */
  status: 'done' | 'stopped'
  /** the paragraph to resume from (flow X02) */
  next: number
  /** paragraphs where at least one revision landed */
  applied: number
  /** model calls that returned nothing */
  errors: number
  /** carry into a resumed pass so stored paragraph positions stay valid */
  mapping: Mapping
  /** detect path only: the landed revisions remembered for accept/reject feedback */
  feedback?: ProofreadFeedbackEdit[]
}

export interface ProofreadPassOptions {
  editor: Editor
  paragraphs: ProofreadParagraph[]
  startIndex: number
  /** positions from an earlier pass, so a resume maps through its edits too */
  baseMapping?: Mapping
  transport: AgentTransport
  system: string
  signal: AbortSignal
  /** the paragraph counter, called after every paragraph settles */
  onProgress(done: number, total: number): void
}

/**
 * The reply is the corrected text; a code fence around it is tolerated.
 *
 * Leading blank lines are stripped because the inference chain's reasoning
 * split leaks its `\n\n` separator into the head of every reply (measured
 * 2026-11-25 on the gateway-backed model: `Reply with exactly: up` answers
 * with `'\n\nup'`). A paragraph's text never starts with a newline, so a
 * leading newline is never the correction — landing one would add a phantom
 * insertion at the paragraph start and a blank row to the folded 修改 list.
 */
export const extractText = (raw: string): { text: string } => ({
  text: raw.replace(/^(?:\r?\n)+/, '').replace(/^```[a-zA-Z]*\r?\n?/, '').replace(/\r?\n?```\s*$/, ''),
})

/**
 * Walks the paragraphs in order, asks the model for each one and lands every
 * suggestion as one tracked transaction authored by PROOFREAD_AUTHOR. Editing
 * later paragraphs shifts stored positions, so each paragraph's pair is mapped
 * through everything dispatched before it. An abort keeps every revision that
 * already landed (flow X02); a model that answers nothing is skipped.
 */
export async function runProofreadPass(
  opts: ProofreadPassOptions,
): Promise<ProofreadPassResult> {
  const { editor, paragraphs, signal } = opts
  const mapping = new Mapping()
  if (opts.baseMapping) mapping.appendMapping(opts.baseMapping)
  let next = opts.startIndex
  let applied = 0
  let errors = 0
  for (let i = opts.startIndex; i < paragraphs.length; i++) {
    if (signal.aborted) break
    next = i
    const para = paragraphs[i]
    const from = mapping.map(para.from)
    const to = mapping.map(para.to)
    const text = editor.state.doc.textBetween(from, to, '\u2029')
    if (text.trim() === '') {
      next = i + 1
      opts.onProgress(next, paragraphs.length)
      continue
    }
    const outcome = await streamText({
      transport: opts.transport,
      system: opts.system,
      user: text,
      signal,
      maxChars: Math.min(16000, Math.max(400, text.length * 2 + 80)),
      extract: extractText,
    })
    if (signal.aborted) break
    // a partial reply still carries what arrived; only an empty answer is a miss
    if (outcome.status === 'empty') {
      errors++
    } else {
      const edits = minimalEdits(text, outcome.text)
      if (edits.length > 0) {
        const tr = editor.state.tr
        // right-to-left so earlier offsets stay valid for every step in this tr
        for (let k = edits.length - 1; k >= 0; k--) {
          const e = edits[k]
          if (e.end > e.start) tr.delete(from + e.start, from + e.end)
          if (e.text) tr.insertText(e.text, from + e.start)
        }
        tr.setMeta(TRACK_AUTHOR, PROOFREAD_AUTHOR)
        editor.view.dispatch(tr)
        mapping.appendMapping(tr.mapping)
        applied++
      }
    }
    next = i + 1
    opts.onProgress(next, paragraphs.length)
  }
  return { status: signal.aborted ? 'stopped' : 'done', next, applied, errors, mapping }
}

/** rough service language for one paragraph: kana reads Japanese, Han reads
 *  Chinese, a Latin letter reads English; anything else goes Chinese */
export function proofreadLangHint(text: string): 'zh' | 'en' | 'ja' {
  if (/[\u3040-\u30FF]/.test(text)) return 'ja'
  if (/[\u2E80-\u9FFF]/.test(text)) return 'zh'
  if (/[A-Za-z]/.test(text)) return 'en'
  return 'zh'
}

/**
 * The service reports error spans as BYTE offsets into the submitted text
 * (UTF-8); JS strings and ProseMirror index UTF-16 units. Walk the text
 * codepoint by codepoint, counting encoded bytes, until both offsets land;
 * a span past the end clamps to the text end.
 */
function byteSpanToUtf16(text: string, start: number, end: number): [number, number] | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return null
  let byte = 0
  let s = -1
  let e = -1
  for (let i = 0; i < text.length; ) {
    if (byte >= start && s < 0) s = i
    if (byte >= end) {
      e = i
      break
    }
    const cp = text.codePointAt(i) ?? 0
    i += cp > 0xffff ? 2 : 1
    byte += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4
  }
  return [s < 0 ? text.length : s, e < 0 ? text.length : e]
}

/**
 * The detect service's raw `errors` array as character edits on `text`, in
 * document order. Entries without a correction, or whose correction already
 * equals the slice, are dropped; overlapping spans keep the earlier one (two
 * detectors can report the same spot). Positions are UTF-16 by the time they
 * leave here, so callers slice and delete directly.
 */
export function detectEdits(text: string, errors: unknown[]): ProofreadEdit[] {
  const found: ProofreadEdit[] = []
  for (const raw of errors) {
    if (typeof raw !== 'object' || raw === null) continue
    const e = raw as { span?: unknown; correction?: unknown }
    if (typeof e.correction !== 'string') continue
    const span = e.span
    if (!Array.isArray(span) || typeof span[0] !== 'number' || typeof span[1] !== 'number') continue
    const pair = byteSpanToUtf16(text, span[0], span[1])
    if (!pair) continue
    const [start, end] = pair
    if (end > start ? text.slice(start, end) === e.correction : e.correction === '') continue
    found.push({ start, end, text: e.correction, error: raw })
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end)
  const out: ProofreadEdit[] = []
  let lastEnd = -1
  for (const e of found) {
    if (e.start < lastEnd) continue
    out.push(e)
    lastEnd = e.end
  }
  return out
}

export interface ProofreadDetectPassOptions {
  editor: Editor
  paragraphs: ProofreadParagraph[]
  startIndex: number
  /** positions from an earlier pass, so a resume maps through its edits too */
  baseMapping?: Mapping
  signal: AbortSignal
  /** one service call per paragraph; runs in the main process (CORS/CSP) */
  detect: (lang: string, text: string, signal: AbortSignal) => Promise<ProofreadDetectResult>
  /** first service failure (401/429/network) ends the pass; App shows the line */
  onFatal?: (error: string, status: number) => void
  /** the paragraph counter, called after every paragraph settles */
  onProgress(done: number, total: number): void
}

/**
 * The same walk as runProofreadPass, paragraph by paragraph, but each
 * paragraph goes to the configured proofread service instead of the chat
 * model: `detect` resolves with the service's raw error list, which
 * detectEdits turns into one tracked transaction authored PROOFREAD_AUTHOR.
 * A failed call reports once through onFatal and ends the pass so a resume
 * can pick up after the settings are fixed; an abort keeps every revision
 * that already landed, exactly like the LLM path (flow X02).
 */
export async function runProofreadDetectPass(
  opts: ProofreadDetectPassOptions,
): Promise<ProofreadPassResult> {
  const { editor, paragraphs, signal } = opts
  const mapping = new Mapping()
  if (opts.baseMapping) mapping.appendMapping(opts.baseMapping)
  let next = opts.startIndex
  let applied = 0
  let errors = 0
  let fatal = false
  const feedback: ProofreadFeedbackEdit[] = []
  for (let i = opts.startIndex; i < paragraphs.length; i++) {
    if (signal.aborted) break
    next = i
    const para = paragraphs[i]
    const from = mapping.map(para.from)
    const to = mapping.map(para.to)
    const text = editor.state.doc.textBetween(from, to, '\u2029')
    if (text.trim() === '') {
      next = i + 1
      opts.onProgress(next, paragraphs.length)
      continue
    }
    const lang = proofreadLangHint(text)
    const result = await opts.detect(lang, text, signal)
    if (signal.aborted) break
    if (!result.ok) {
      errors++
      if (!fatal) {
        fatal = true
        opts.onFatal?.(result.error ?? `HTTP ${result.status}`, result.status)
      }
      break
    }
    const edits = detectEdits(text, result.errors ?? [])
    if (edits.length > 0) {
      const tr = editor.state.tr
      // right-to-left so earlier offsets stay valid for every step in this tr
      for (let k = edits.length - 1; k >= 0; k--) {
        const e = edits[k]
        if (e.end > e.start) tr.delete(from + e.start, from + e.end)
        if (e.text) tr.insertText(e.text, from + e.start)
      }
      tr.setMeta(TRACK_AUTHOR, PROOFREAD_AUTHOR)
      editor.view.dispatch(tr)
      mapping.appendMapping(tr.mapping)
      applied++
      // remember every landed error for the feedback loop; the right-to-left
      // order inside this tr leaves each recorded span valid in its result,
      // and later paragraphs sit after this one, so no recorded span shifts
      for (const e of edits) {
        const raw = (typeof e.error === 'object' && e.error !== null ? e.error : {}) as {
          original?: unknown
          correction?: unknown
        }
        feedback.push({
          error: e.error,
          original: typeof raw.original === 'string' ? raw.original : '',
          correction: typeof raw.correction === 'string' ? raw.correction : e.text,
          lang,
          paraText: text,
          from: from + e.start,
          to: from + e.end,
          reported: false,
        })
      }
    }
    next = i + 1
    opts.onProgress(next, paragraphs.length)
  }
  return {
    status: signal.aborted || fatal ? 'stopped' : 'done',
    next,
    applied,
    errors,
    mapping,
    feedback,
  }
}

/** i18n keys for the coarse error-type badges on review rows */
export type ProofreadErrorTypeKey =
  | 'aiRevTypeSpelling'
  | 'aiRevTypeGrammar'
  | 'aiRevTypePunctuation'
  | 'aiRevTypeCollocation'
  | 'aiRevTypeAnomaly'
  | 'aiRevTypeNumeral'
  | 'aiRevTypeQuantityUnit'
  | 'aiRevTypeSerialNo'
  | 'aiRevTypeOther'

/**
 * The service's fine-grained error_type folded to the coarse buckets OneDesk
 * labels, mirroring the server's own coarse_error_type for zh (extra_char /
 * missing_char → spelling, the CEC syntax family → grammar); en / ja types all
 * land in grammar or the zh-direct buckets. Anything unknown → other.
 */
export function errorTypeLabelKey(error: unknown): ProofreadErrorTypeKey {
  const t =
    typeof error === 'object' && error !== null
      ? (error as { error_type?: unknown }).error_type
      : undefined
  if (typeof t !== 'string' || !t) return 'aiRevTypeOther'
  switch (t) {
    case 'spelling':
    case 'extra_char':
    case 'missing_char':
      return 'aiRevTypeSpelling'
    case 'punctuation':
      return 'aiRevTypePunctuation'
    case 'collocation':
      return 'aiRevTypeCollocation'
    case 'anomaly':
      return 'aiRevTypeAnomaly'
    case 'numeral':
      return 'aiRevTypeNumeral'
    case 'quantity_unit':
      return 'aiRevTypeQuantityUnit'
    case 'serial_no':
      return 'aiRevTypeSerialNo'
    case 'grammar':
    case 'word_order':
    case 'pos_error':
    case 'missing_component':
    case 'redundant_component':
    case 'blend':
    case 'conjunction':
    case 'reference':
    case 'logic':
    case 'semantic_dup':
    case 'article':
    case 'agreement':
    case 'tense':
    case 'preposition':
    case 'morphology':
    case 'adjective':
    case 'adverb':
    case 'noun':
    case 'pronoun':
    case 'verb':
    case 'infinitive':
    case 'gerund':
    case 'subjunctive':
    case 'negation':
    case 'particle':
    case 'conjugation':
    case 'honorific':
      return 'aiRevTypeGrammar'
    default:
      return 'aiRevTypeOther'
  }
}

/**
 * The one feedback edit a revision row refers to: the row's text equals the
 * error's original (w:del row) or correction (w:ins row) whatever the position
 * drift, so text comes first and the recorded span only breaks ties / covers
 * truncated or reformatted text. With no candidate at all the caller skips —
 * a wrong attribution costs more than a missing one.
 */
export function matchFeedbackEdit(
  edits: ProofreadFeedbackEdit[],
  text: string,
  from: number,
  to: number,
  ignoreReported = false,
): ProofreadFeedbackEdit | null {
  let best: ProofreadFeedbackEdit | null = null
  let bestScore = -Infinity
  for (const e of edits) {
    if (e.reported && !ignoreReported) continue
    const textHit = text !== '' && (text === e.original || text === e.correction)
    const overlap = from < e.to && to > e.from
    if (!textHit && !overlap) continue
    const score = (textHit ? 1_000_000 : 0) + (overlap ? 1_000 : 0) - Math.abs(from - e.from)
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  return best
}
