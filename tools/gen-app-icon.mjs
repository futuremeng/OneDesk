/**
 * Generates the app-program icons that electron-builder bakes into installers
 * (apps/shell/electron-builder.cjs): build/icon.png (Linux / generic),
 * build/icon-mac.png (macOS grid reference), build/icon.icns (macOS app icon)
 * and build/icon.ico (Windows NSIS).
 *
 * Source of truth is design/logo/appicon-master.svg — the brand icon master
 * (white mark knockout on the brand squircle). Rasterize with the system
 * Chrome via Playwright (transparent background), then pack with `iconutil`
 * (icns, macOS host only) and a hand-rolled PNG-entry ICO container, the same
 * pipeline as tools/gen-file-association-icons.mjs.
 *
 * Regenerate after changing the master:
 *   node tools/gen-app-icon.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const masterPath = join(root, 'design/logo/appicon-master.svg')
const outDir = join(root, 'apps/shell/build')

// macOS icons carry the standard app-icon grid margin (824/1024 content) so
// they sit at the same optical size as neighboring icons in the Dock/Finder;
// Windows icons are full-bleed. Same treatment as the file-association icons.
const MAC_CONTENT_RATIO = 824 / 1024
const MAC_CANVAS_SIZES = [16, 32, 64, 128, 256, 512, 1024]
const ICONSET_ENTRIES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]
const WIN_SIZES = [16, 24, 32, 48, 64, 128, 256, 1024]

/** ICO container with PNG-compressed entries (supported since Vista). */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length
  entries.forEach(({ size, png }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o) // 0 means 256
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2) // palette
    dir.writeUInt8(0, o + 3) // reserved
    dir.writeUInt16LE(1, o + 4) // planes
    dir.writeUInt16LE(32, o + 6) // bpp
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

// Fresh page per frame: reusing one page's viewport between renders leaves
// Chrome compositing stale rasters at some sizes (see the note in
// gen-file-association-icons.mjs).
async function renderPng(browser, svgDataUrl, canvasSize, contentSize) {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: canvasSize, height: canvasSize },
  })
  await page.setContent(
    `<body style="margin:0"><div style="width:${canvasSize}px;height:${canvasSize}px;display:flex;align-items:center;justify-content:center">` +
      `<img src="${svgDataUrl}" style="width:${contentSize}px;height:${contentSize}px"></div></body>`,
  )
  try {
    return await page.screenshot({ omitBackground: true })
  } finally {
    await page.close()
  }
}

const svg = readFileSync(masterPath)
const dataUrl = `data:image/svg+xml;base64,${svg.toString('base64')}`

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const tmp = mkdtempSync(join(tmpdir(), 'onedesk-app-icon-'))

try {
  const fullPngs = new Map()
  for (const size of [...new Set([...WIN_SIZES, 1024])]) {
    fullPngs.set(size, await renderPng(browser, dataUrl, size, size))
  }
  writeFileSync(join(outDir, 'icon.png'), fullPngs.get(1024))
  writeFileSync(
    join(outDir, 'icon.ico'),
    buildIco(WIN_SIZES.map((size) => ({ size, png: fullPngs.get(size) }))),
  )

  if (process.platform === 'darwin') {
    const macPngs = new Map()
    for (const size of MAC_CANVAS_SIZES) {
      macPngs.set(
        size,
        await renderPng(browser, dataUrl, size, Math.round(size * MAC_CONTENT_RATIO)),
      )
    }
    writeFileSync(join(outDir, 'icon-mac.png'), macPngs.get(1024))
    const iconset = join(tmp, 'icon.iconset')
    mkdirSync(iconset, { recursive: true })
    for (const [name, size] of ICONSET_ENTRIES) {
      writeFileSync(join(iconset, name), macPngs.get(size))
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(outDir, 'icon.icns')])
  } else {
    writeFileSync(join(outDir, 'icon-mac.png'), fullPngs.get(1024))
    console.warn('icon.icns skipped: iconutil is macOS-only')
  }
} finally {
  await browser.close()
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`wrote ${join(outDir, 'icon.png')}, icon-mac.png, icon.ico${process.platform === 'darwin' ? ', icon.icns' : ''}`)
