import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Keep credential tests isolated from the developer's real home directory.
const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>()
  return { ...os, homedir: () => home.dir || os.homedir() }
})

import {
  FRESH_AUTH_REQUIRED,
  onedeskLogout,
  resetOneDeskAuthCache,
  setOneDeskLoginOpener,
} from '../src/onedesk-auth'
import {
  OneDeskAuthError,
  onedeskCliApiKey,
  onedeskWebSearch,
  hasOneDeskAuth,
  isOneDeskUnauthorizedText,
  noteOneDeskCallFailure,
  noteOneDeskKeyRejected,
  resetOneDeskRejectedKeys,
} from '../src/onedesk'

const AUTH_URL = `https://onedesk.jiulu.ltd/api/office_addin_auth/verify?code=${'a'.repeat(64)}`

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'onedesk-reauth-'))
  home.dir = dir
  process.env.ONEDESK_AUTH_DIR = dir
  process.env.ONEDESK_CLI_PATH = '/fake/onedesk.js'
  delete process.env.GSK_API_KEY
  delete process.env.AI_SEARCH_DISABLE_ONEDESK
  resetOneDeskAuthCache()
  resetOneDeskRejectedKeys()
  writeFileSync(
    join(dir, 'auth.json'),
    JSON.stringify({ api_key: 'onedesk-expired', key_id: 'kid-1', access_token: 'bearer-old' }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  setOneDeskLoginOpener(null)
  resetOneDeskAuthCache()
  resetOneDeskRejectedKeys()
  rmSync(dir, { recursive: true, force: true })
  home.dir = ''
  delete process.env.ONEDESK_AUTH_DIR
  delete process.env.ONEDESK_CLI_PATH
})

function response(body: unknown, status = 200, setCookie?: string): Response {
  const headers = new Headers()
  if (setCookie) headers.append('set-cookie', setCookie)
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(text, { status, headers })
}

const ndjsonOk = (data: unknown) => response(`${JSON.stringify({ status: 'ok', data })}\n`)

/**
 * tool_cli answers 401 for the expired key and succeeds for any other; the
 * auth endpoints answer `create` for the silent re-mint.
 */
function stubServer(create: () => Response) {
  const toolKeys: string[] = []
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/tool_cli/')) {
      const key = (init?.headers as Record<string, string>)['X-Api-Key']!
      toolKeys.push(key)
      if (key === 'onedesk-expired') return response('{"detail":"invalid api key"}', 401)
      return ndjsonOk({ download_url: 'https://93.184.216.34/deck.pptx' })
    }
    if (url.includes('/office_addin_auth/session')) {
      return response({ status: 'ok' }, 200, 'session_id=sess; Path=/')
    }
    if (url.includes('/api_tokens/create')) return create()
    if (url.includes('/office_addin_auth/device_code')) {
      return response({ device_code: 'a'.repeat(64), auth_url: AUTH_URL, expires_in: 600 })
    }
    if (url.includes('/office_addin_auth/token')) return response({ status: 'pending' })
    if (url.includes('/api_tokens/revoke')) return response({ status: 0 })
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, toolKeys }
}

describe('isOneDeskUnauthorizedText', () => {
  it('matches the 401 shapes of onedesk CLI, tool_cli and the LLM proxy', () => {
    expect(isOneDeskUnauthorizedText('HTTP 401: Unauthorized')).toBe(true)
    expect(isOneDeskUnauthorizedText('tool_cli /x HTTP 401: {}')).toBe(true)
    expect(isOneDeskUnauthorizedText('Claude HTTP 401: {"error":"invalid key"}')).toBe(true)
    expect(isOneDeskUnauthorizedText('HTTP 4011')).toBe(false)
    expect(isOneDeskUnauthorizedText('HTTP 403: forbidden')).toBe(false)
  })
})

describe('onedesk CLI 401 recovery', () => {
  /** fake CLI: a 401 for the expired key (printed on stdout like the real CLI), results otherwise */
  function fakeCli(): string {
    const log = join(dir, 'cli-keys.log')
    const script = join(dir, 'fake-onedesk.mjs')
    writeFileSync(
      script,
      [
        "import { appendFileSync } from 'node:fs'",
        `appendFileSync(${JSON.stringify(log)}, process.env.GSK_API_KEY + '\\n')`,
        "if (process.env.GSK_API_KEY === 'onedesk-expired') {",
        "  console.log(JSON.stringify({ status: 'error', message: 'HTTP 401: Unauthorized', data: null }))",
        '  process.exit(1)',
        '}',
        "console.log(JSON.stringify({ status: 'ok', data: { organic_results: [{ title: 't', link: 'https://e.x', snippet: 's' }] } }))",
      ].join('\n'),
    )
    process.env.ONEDESK_CLI_PATH = script
    return log
  }

  function sharedLogin(): string {
    const config = join(dir, '.onedesk-tool-cli', 'config.json')
    mkdirSync(join(dir, '.onedesk-tool-cli'), { recursive: true })
    writeFileSync(config, JSON.stringify({ api_key: 'onedesk-other-app', key_name: 'other app' }))
    return config
  }

  it('stays signed out with only a shared CLI login and never spawns the CLI', async () => {
    const config = sharedLogin()
    const before = readFileSync(config, 'utf-8')
    const log = fakeCli()
    rmSync(join(dir, 'auth.json'))
    resetOneDeskAuthCache()

    expect(onedeskCliApiKey()).toBe('')
    expect(hasOneDeskAuth()).toBe(false)
    await expect(onedeskWebSearch('q')).rejects.toBeInstanceOf(OneDeskAuthError)
    expect(existsSync(log)).toBe(false)
    expect(readFileSync(config, 'utf-8')).toBe(before)
  })

  it('does not resume billing through the shared login after OneDesk sign-out', async () => {
    const config = sharedLogin()
    const before = readFileSync(config, 'utf-8')
    const log = fakeCli()
    stubServer(() => response({ status: 0 }))

    await onedeskLogout()

    expect(onedeskCliApiKey()).toBe('')
    expect(hasOneDeskAuth()).toBe(false)
    await expect(onedeskWebSearch('q')).rejects.toBeInstanceOf(OneDeskAuthError)
    expect(existsSync(log)).toBe(false)
    expect(readFileSync(config, 'utf-8')).toBe(before)
  })

  it('never spawns an unauthenticated CLI even without a shared config file', async () => {
    const log = fakeCli()
    rmSync(join(dir, 'auth.json'))
    resetOneDeskAuthCache()

    await expect(onedeskWebSearch('q')).rejects.toBeInstanceOf(OneDeskAuthError)

    expect(existsSync(log)).toBe(false)
  })

  it('does not switch to another app key when reauthentication fails', async () => {
    sharedLogin()
    const log = fakeCli()
    stubServer(() => response({ detail: FRESH_AUTH_REQUIRED }, 403))

    await expect(onedeskWebSearch('q')).rejects.toBeInstanceOf(OneDeskAuthError)

    expect(onedeskCliApiKey()).toBe('')
    expect(hasOneDeskAuth()).toBe(false)
    expect(readFileSync(log, 'utf-8').trim().split('\n')).toEqual(['onedesk-expired'])
  })

  it('re-mints after a CLI 401 and reruns the command with the new key', async () => {
    const log = fakeCli()
    stubServer(() => response({ status: 0, data: { key_id: 'kid-2', token: 'onedesk-new' } }))
    const out = await onedeskWebSearch('q')
    expect(out.results).toHaveLength(1)
    expect(readFileSync(log, 'utf-8').trim().split('\n')).toEqual([
      'onedesk-expired',
      'onedesk-new',
    ])
  })

  it('reports the auth failure and signs out when a fresh login is required', async () => {
    fakeCli()
    stubServer(() => response({ detail: FRESH_AUTH_REQUIRED }, 403))
    await expect(onedeskWebSearch('q')).rejects.toBeInstanceOf(OneDeskAuthError)
    expect(hasOneDeskAuth()).toBe(false)
  })
})

describe('noteOneDeskCallFailure (LLM proxy chat/stream)', () => {
  it('marks the injected key invalid on a 401 so the sign-in button appears', () => {
    stubServer(() => response({ detail: FRESH_AUTH_REQUIRED }, 403))
    expect(noteOneDeskCallFailure('onedesk-expired', new Error('Claude HTTP 401: invalid'))).toBe(
      true,
    )
    expect(hasOneDeskAuth()).toBe(false)
  })

  it('ignores non-auth failures and calls made without the onedesk key', () => {
    expect(noteOneDeskCallFailure('onedesk-expired', new Error('HTTP 500: busy'))).toBe(false)
    expect(noteOneDeskCallFailure('', new Error('HTTP 401: bad byok key'))).toBe(false)
    expect(hasOneDeskAuth()).toBe(true)
  })

  it('stops offering a rejected env key without touching anyone else’s file', () => {
    process.env.GSK_API_KEY = 'onedesk-env'
    try {
      stubServer(() => response({ detail: FRESH_AUTH_REQUIRED }, 403))
      expect(onedeskCliApiKey()).toBe('onedesk-env')
      noteOneDeskCallFailure('onedesk-env', 'HTTP 401: Unauthorized')
      // falls through to OneDesk's own (still valid) key
      expect(onedeskCliApiKey()).toBe('onedesk-expired')
    } finally {
      delete process.env.GSK_API_KEY
    }
  })
})

describe('passive calls', () => {
  it('a 401 from a background call drops the key without opening the browser', async () => {
    stubServer(() => response({ detail: FRESH_AUTH_REQUIRED }, 403))
    const opener = vi.fn()
    setOneDeskLoginOpener(opener)
    await expect(noteOneDeskKeyRejected('onedesk-expired', { allowLogin: false })).resolves.toBe(
      'login_required',
    )
    expect(hasOneDeskAuth()).toBe(false)
    expect(opener).not.toHaveBeenCalled()
  })
})
