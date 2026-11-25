import { app } from 'electron'

/**
 * Dev-runtime identity guard.
 *
 * tools/fix-electron-dev-name.mjs renames the dev Electron executable (and its
 * bundle identity) so the Dock shows "OneDesk" instead of "Electron". On
 * Electron 43 the renamed binary makes app.isPackaged report TRUE even though
 * the app still boots through the default-app loader (process.defaultApp is
 * set, argv[1] is the app path). That silently flips every !app.isPackaged dev
 * branch to its packaged counterpart: module preload paths point at
 * process.resourcesPath, userData/single-instance isolation is skipped (dev
 * then shares the production OneDesk profile), the auto-updater probes a
 * non-existent app-update.yml, native sidecars resolve under Resources -
 * in practice the docs renderer loads with no preload bridge and shows a
 * blank page in dev.
 *
 * process.defaultApp is set by Electron for any default-app launch regardless
 * of the executable name, and is never set for a packaged bundle, so
 * "defaultApp && isPackaged" unambiguously identifies the flipped case.
 * Main-process entries import this module before anything else so every later
 * app.isPackaged read across the shell and app mains sees the truth.
 */
type DefaultAppProcess = NodeJS.Process & { defaultApp?: boolean }

try {
  if ((process as DefaultAppProcess).defaultApp === true && app.isPackaged) {
    Object.defineProperty(app, 'isPackaged', {
      configurable: true,
      enumerable: true,
      get: () => false,
    })
    console.log('[dev-identity] dev binary was renamed: forcing app.isPackaged=false')
  }
} catch {
  // Electron made the property non-redefinable; dev branches would need the
  // env-marker fallback instead. Not fatal at boot - keep the app running.
  console.warn('[dev-identity] could not correct app.isPackaged; dev mode may misdetect')
}
