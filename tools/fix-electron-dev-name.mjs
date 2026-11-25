// In dev the app IS node_modules/electron/dist/Electron.app, so macOS shows
// every debug run as "Electron" in the Dock and app menu. Empirically the
// name the OS shows follows the executable name / bundle identity, so patch
// all of it in place: CFBundleName/CFBundleDisplayName -> OneDesk, a unique
// CFBundleIdentifier (the stock com.github.Electron collides with unrelated
// apps and makes the Dock resolve a stale tile), the MacOS binary renamed to
// OneDesk (+ node_modules/electron/path.txt so the CLI still finds it), then
// ad-hoc re-sign so it launches on Apple Silicon. Packaged builds already
// carry the productName, and the idempotency check below makes later dev
// starts no-ops.
// CAVEAT: with the binary renamed, Electron 43 reports app.isPackaged=true for
// these default-app dev runs. packages/electron-utils/src/dev-identity.ts
// corrects that at the top of every main entry; without it dev silently takes
// the packaged code paths (wrong preload/userData/updater paths, blank docs
// renderer). Keep that guard imported first if this patching ever moves.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

if (process.platform !== 'darwin') process.exit(0)

const DESIRED = 'OneDesk'
// distinct from the packaged appId so the Dock never merges the two tiles
const DESIRED_ID = 'ltd.jiulu.onedesk.app.dev'
const STOCK_EXE = 'Electron'
const require = createRequire(import.meta.url)
let electronDir
try {
  electronDir = dirname(require.resolve('electron'))
} catch {
  process.exit(0)
}
const appBundle = join(electronDir, 'dist', 'Electron.app')
if (!existsSync(appBundle)) process.exit(0)

const plist = join(appBundle, 'Contents', 'Info.plist')
const macDir = join(appBundle, 'Contents', 'MacOS')
const renamedBin = join(macDir, DESIRED)
const stockBin = join(macDir, STOCK_EXE)
const pathTxt = join(electronDir, 'path.txt')
const desiredPathTxt = join('Electron.app', 'Contents', 'MacOS', DESIRED)
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
// the Dock reads the LaunchServices display name, which goes stale against the
// edited bundle; re-register so it picks the new name up at next launch
const reregister = () => {
  try {
    execFileSync(lsregister, ['-f', appBundle], { stdio: 'pipe' })
  } catch {
    // best-effort: the plist/codesign fix still lands at the next LS sweep
  }
}
const read = (key) => {
  try {
    return execFileSync('plutil', ['-extract', key, 'raw', plist], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}
const readPathTxt = () => {
  try {
    return readFileSync(pathTxt, 'utf8').trim()
  } catch {
    return null
  }
}
const exePatched = existsSync(renamedBin) && readPathTxt() === desiredPathTxt
if (
  read('CFBundleName') === DESIRED &&
  (read('CFBundleDisplayName') ?? DESIRED) === DESIRED &&
  read('CFBundleIdentifier') === DESIRED_ID &&
  read('CFBundleExecutable') === DESIRED &&
  exePatched
) {
  reregister()
  process.exit(0)
}

// the backup must live outside the bundle: codesign treats stray files under
// Contents as unsigned subcomponents and refuses to seal the app
const backup = join(tmpdir(), 'onedesk-electron-dev-info.plist.bak')
copyFileSync(plist, backup)
const oldPathTxt = readPathTxt()
try {
  execFileSync('plutil', ['-replace', 'CFBundleName', '-string', DESIRED, plist])
  if (read('CFBundleDisplayName') !== null) {
    execFileSync('plutil', ['-replace', 'CFBundleDisplayName', '-string', DESIRED, plist])
  }
  execFileSync('plutil', ['-replace', 'CFBundleIdentifier', '-string', DESIRED_ID, plist])
  execFileSync('plutil', ['-replace', 'CFBundleExecutable', '-string', DESIRED, plist])
  if (!existsSync(renamedBin)) {
    renameSync(stockBin, renamedBin)
  }
  // a stale MacOS/Electron entry (real binary or leftover symlink) would make
  // path.txt point at the wrong image name again
  if (existsSync(stockBin) && lstatSync(stockBin).isSymbolicLink()) rmSync(stockBin)
  writeFileSync(pathTxt, desiredPathTxt)
  execFileSync('codesign', ['--force', '--sign', '-', appBundle], { stdio: 'pipe' })
  rmSync(backup)
  reregister()
  console.log(`[dev-name] dev Electron bundle renamed to ${DESIRED}`)
} catch (err) {
  // an edited plist breaks the bundle's seal and an arm64 exec would die;
  // restore so the debug run at least launches, still badged "Electron"
  copyFileSync(backup, plist)
  rmSync(backup)
  if (!existsSync(stockBin) && existsSync(renamedBin)) renameSync(renamedBin, stockBin)
  if (oldPathTxt !== null) writeFileSync(pathTxt, oldPathTxt)
  console.warn(`[dev-name] could not rename the dev Electron bundle: ${err?.message ?? err}`)
}
