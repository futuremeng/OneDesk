/**
 * Character-level diff used by the proofread suggestion list: the old and new
 * lines share one segment stream, so matching runs line up vertically while
 * only the differing runs carry the strike / underline decoration and color.
 */
export interface DiffSegment {
  type: 'same' | 'del' | 'ins'
  text: string
}

// LCS over this many code points each is still a sub-16-bit dp table and a
// few ms; longer middles fall back to one del + one ins run.
const LCS_LIMIT = 512

export function diffText(oldText: string, newText: string): DiffSegment[] {
  if (oldText === newText) return oldText ? [{ type: 'same', text: oldText }] : []
  const oldChars = Array.from(oldText)
  const newChars = Array.from(newText)
  let prefix = 0
  while (prefix < oldChars.length && prefix < newChars.length && oldChars[prefix] === newChars[prefix]) prefix++
  let suffix = 0
  while (
    suffix < oldChars.length - prefix &&
    suffix < newChars.length - prefix &&
    oldChars[oldChars.length - 1 - suffix] === newChars[newChars.length - 1 - suffix]
  )
    suffix++

  const midOld = oldChars.slice(prefix, oldChars.length - suffix)
  const midNew = newChars.slice(prefix, newChars.length - suffix)
  const segs: DiffSegment[] = []
  if (prefix > 0) segs.push({ type: 'same', text: oldChars.slice(0, prefix).join('') })
  for (const seg of diffMiddle(midOld, midNew)) pushRun(segs, seg.type, seg.text)
  if (suffix > 0) segs.push({ type: 'same', text: oldChars.slice(oldChars.length - suffix).join('') })
  return segs
}

function diffMiddle(oldChars: string[], newChars: string[]): DiffSegment[] {
  if (oldChars.length === 0) return newChars.length ? [{ type: 'ins', text: newChars.join('') }] : []
  if (newChars.length === 0) return [{ type: 'del', text: oldChars.join('') }]
  if (oldChars.length > LCS_LIMIT || newChars.length > LCS_LIMIT)
    return [
      { type: 'del', text: oldChars.join('') },
      { type: 'ins', text: newChars.join('') },
    ]

  const n = oldChars.length
  const m = newChars.length
  // lcs[i][j] = common subsequence length of old[i:] / new[j:]; values <= 512
  // fit in 16 bits.
  const lcs = new Uint16Array((n + 1) * (m + 1))
  const at = (i: number, j: number) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[at(i, j)] =
        oldChars[i] === newChars[j]
          ? lcs[at(i + 1, j + 1)] + 1
          : Math.max(lcs[at(i + 1, j)], lcs[at(i, j + 1)])
    }
  }
  const segs: DiffSegment[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldChars[i] === newChars[j]) {
      pushRun(segs, 'same', oldChars[i])
      i++
      j++
    } else if (lcs[at(i + 1, j)] >= lcs[at(i, j + 1)]) {
      pushRun(segs, 'del', oldChars[i])
      i++
    } else {
      pushRun(segs, 'ins', newChars[j])
      j++
    }
  }
  while (i < n) pushRun(segs, 'del', oldChars[i++])
  while (j < m) pushRun(segs, 'ins', newChars[j++])
  return segs
}

function pushRun(segs: DiffSegment[], type: DiffSegment['type'], text: string): void {
  if (!text) return
  const last = segs[segs.length - 1]
  if (last && last.type === type) last.text += text
  else segs.push({ type, text })
}
