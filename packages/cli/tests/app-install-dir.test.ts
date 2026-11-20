import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appBinaryForResources } from '../src/resources'

describe('appBinaryForResources', () => {
  it('finds the app in a custom Windows install directory', () => {
    expect(appBinaryForResources(join('D:\\Apps\\OneDesk', 'resources'), 'win32')).toBe(
      join('D:\\Apps\\OneDesk', 'OneDesk.exe'),
    )
  })

  it('resolves the same binary for the default Windows install directory', () => {
    const localAppData = 'C:\\Users\\test\\AppData\\Local'
    const resources = join(localAppData, 'Programs', 'OneDesk', 'resources')
    expect(appBinaryForResources(resources, 'win32')).toBe(
      join(localAppData, 'Programs', 'OneDesk', 'OneDesk.exe'),
    )
  })

  it('finds the app in a custom macOS bundle location', () => {
    expect(
      appBinaryForResources(join('/Volumes/Work/OneDesk.app/Contents/Resources'), 'darwin'),
    ).toBe(join('/Volumes/Work/OneDesk.app/Contents/MacOS/OneDesk'))
  })

  it('finds the app in a custom Linux prefix', () => {
    expect(appBinaryForResources(join('/opt/onedesk-custom/resources'), 'linux')).toBe(
      join('/opt/onedesk-custom/onedesk'),
    )
  })
})
