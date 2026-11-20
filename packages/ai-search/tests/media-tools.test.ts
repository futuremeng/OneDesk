import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/onedesk', () => ({
  onedeskGenerateImage: vi.fn(),
  onedeskAnalyzeMedia: vi.fn(),
  hasOneDeskAuth: vi.fn(() => true),
}))

import { generateImageTool, analyzeMediaTool, ONEDESK_RMBG_MODEL } from '../src/media-tools'
import { onedeskGenerateImage, onedeskAnalyzeMedia } from '../src/onedesk'

const onedeskGen = vi.mocked(onedeskGenerateImage)
const onedeskAnalyze = vi.mocked(onedeskAnalyzeMedia)
// nonexistent settings file → defaults: no BYOK media provider, cloud tools on → OneDesk route
const SETTINGS = '/nonexistent/ai-settings.json'

beforeEach(() => {
  onedeskGen.mockReset()
  onedeskAnalyze.mockReset()
})

describe('generateImageTool transparentBackground (OneDesk route)', () => {
  it('chains a fal-bria-rmbg pass over the generated image and returns the stripped URL', async () => {
    onedeskGen
      .mockResolvedValueOnce({ url: 'https://cdn/x/opaque.png', taskId: '1' })
      .mockResolvedValueOnce({ url: 'https://cdn/x/cutout.png', taskId: '2' })
    const r = await generateImageTool(SETTINGS, {
      prompt: 'red podcast icon',
      transparentBackground: true,
    })
    expect(r).toEqual({ url: 'https://cdn/x/cutout.png' })
    expect(onedeskGen).toHaveBeenCalledTimes(2)
    expect(onedeskGen.mock.calls[1]![0]).toMatchObject({
      model: ONEDESK_RMBG_MODEL,
      referenceImageUrls: ['https://cdn/x/opaque.png'],
    })
  })

  it('without the flag generation stays a single pass', async () => {
    onedeskGen.mockResolvedValueOnce({ url: 'https://cdn/x/opaque.png', taskId: '1' })
    const r = await generateImageTool(SETTINGS, { prompt: 'red podcast icon' })
    expect(r).toEqual({ url: 'https://cdn/x/opaque.png' })
    expect(onedeskGen).toHaveBeenCalledTimes(1)
  })

  it('does not chain when the caller already runs the background-removal model', async () => {
    onedeskGen.mockResolvedValueOnce({ url: 'https://cdn/x/cutout.png', taskId: '1' })
    const r = await generateImageTool(SETTINGS, {
      prompt: 'remove background',
      model: ONEDESK_RMBG_MODEL,
      referenceImageUrls: ['https://cdn/x/src.png'],
      transparentBackground: true,
    })
    expect(r).toEqual({ url: 'https://cdn/x/cutout.png' })
    expect(onedeskGen).toHaveBeenCalledTimes(1)
  })

  it('falls back to the opaque image when the strip pass fails', async () => {
    onedeskGen
      .mockResolvedValueOnce({ url: 'https://cdn/x/opaque.png', taskId: '1' })
      .mockRejectedValueOnce(new Error('rmbg down'))
    const r = await generateImageTool(SETTINGS, {
      prompt: 'red podcast icon',
      transparentBackground: true,
    })
    expect(r).toEqual({ url: 'https://cdn/x/opaque.png' })
  })

  it('a generation failure still surfaces as an error (no half-run chain)', async () => {
    onedeskGen.mockRejectedValueOnce(new Error('quota exceeded'))
    const r = await generateImageTool(SETTINGS, {
      prompt: 'red podcast icon',
      transparentBackground: true,
    })
    expect(r).toEqual({ error: 'quota exceeded' })
    expect(onedeskGen).toHaveBeenCalledTimes(1)
  })
})

describe('generateImageTool reference budget (OneDesk route)', () => {
  it('rejects too many reference images with the BYOK wording, before calling the CLI', async () => {
    onedeskGen.mockResolvedValue({ url: 'https://cdn/x/out.png', taskId: '1' })
    const referenceImageUrls = Array.from({ length: 13 }, (_, i) => `https://cdn/x/${i}.png`)
    const r = await generateImageTool(SETTINGS, { prompt: 'red podcast icon', referenceImageUrls })
    expect(r).toEqual({
      error: 'Too many media items in one request (13, limit 12); analyze them in smaller batches',
    })
    expect(onedeskGen).not.toHaveBeenCalled()
  })

  it('still passes a reference count within the budget to the CLI', async () => {
    onedeskGen.mockResolvedValueOnce({ url: 'https://cdn/x/out.png', taskId: '1' })
    const referenceImageUrls = Array.from({ length: 12 }, (_, i) => `https://cdn/x/${i}.png`)
    const r = await generateImageTool(SETTINGS, { prompt: 'red podcast icon', referenceImageUrls })
    expect(r).toEqual({ url: 'https://cdn/x/out.png' })
    expect(onedeskGen).toHaveBeenCalledTimes(1)
  })
})

describe('analyzeMediaTool media budget (OneDesk route)', () => {
  it('rejects too many media URLs with the BYOK wording, before calling the CLI', async () => {
    onedeskAnalyze.mockResolvedValueOnce('done')
    const mediaUrls = Array.from({ length: 13 }, (_, i) => `https://cdn/x/${i}.png`)
    const r = await analyzeMediaTool(SETTINGS, { mediaUrls, requirements: 'describe these' })
    expect(r).toEqual({
      error: 'Too many media items in one request (13, limit 12); analyze them in smaller batches',
    })
    expect(onedeskAnalyze).not.toHaveBeenCalled()
  })
})
