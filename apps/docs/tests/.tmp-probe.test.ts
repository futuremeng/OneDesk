import { it } from 'vitest'
it('probe env', () => {
  console.log('localStorage:', typeof localStorage, 'window.localStorage:', typeof (globalThis as any).window?.localStorage)
  console.log('jsdom keys sample:', Object.getOwnPropertyNames(globalThis.window).filter(k => /storage/i.test(k)))
})
