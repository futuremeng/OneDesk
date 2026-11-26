import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@onedesk/i18n'
import { App } from './App'
import { installKeyLayer } from './key-layer'
import { setAuthorName } from './author-name'
import { LocaleProvider, setModuleLang } from './i18n/locale'
import type { DocTheme, UiTheme } from '../shared/ipc'
import '@onedesk/ui/tokens.css'
import '@onedesk/ui/screentip.css'
import '@onedesk/ui/ai-model-picker.css'
import '@onedesk/ui/ai-queue-strip.css'
import '@onedesk/ui/ai-usage.css'
import '@onedesk/ui/ai-skills.css'
import '@onedesk/ui/color-picker.css'
import '@onedesk/ui/dropdown.css'
import '@onedesk/ui/ribbon-collapse.css'
import '@onedesk/ui/markdown.css'
import '@onedesk/ui/ai-panel-prefs.css'
import '@onedesk/ui/ai-scope-quote.css'
import '@onedesk/ui/image-viewer.css'
import './styles.css'
import './fonts/fonts.css'
import { applyAiPanelPrefs, installScreenTips } from '@onedesk/ui'
import { connectAppWideMeasurementUnit } from './units'
import { setAltChunkHtmlConverter } from '@onedesk/docx-engine'

installScreenTips()
installKeyLayer()
if (window.desktop?.convertAltChunkHtml) {
  setAltChunkHtmlConverter((html) => window.desktop.convertAltChunkHtml(html))
}

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

function applyDocumentTheme(theme: DocTheme): void {
  // data-doc-theme drives the canvas/paper (onedesk#1811); absent means 'follow' the UI theme
  if (theme === 'follow') document.documentElement.removeAttribute('data-doc-theme')
  else document.documentElement.setAttribute('data-doc-theme', theme)
}

async function bootstrap(): Promise<void> {
  let lang: Lang = 'zh'
  let theme: UiTheme = 'system'
  let docTheme: DocTheme = 'follow'
  try {
    // per-promise catch: standalone runs have no app:get-theme handler, and
    // that rejection must not drop a resolved language
    ;[lang, theme, docTheme] = await Promise.all([
      window.desktop.getLanguage().catch(() => 'zh' as const),
      window.desktop.getTheme().catch(() => 'system' as const),
      window.desktop.getDocumentTheme?.().catch(() => 'follow' as const),
    ])
  } catch {
    /* dev renderer without the preload bridge */
  }
  setModuleLang(lang)
  document.documentElement.lang = htmlLang(lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  applyDocumentTheme(docTheme ?? 'follow')
  window.desktop?.onThemeChanged(applyTheme)
  window.desktop?.onDocumentThemeChanged?.(applyDocumentTheme)
  // the app-wide unit (Settings ▸ General); before it answers, the locale default
  const desktop = window.desktop
  if (
    desktop?.getMeasurementUnit &&
    desktop.setMeasurementUnit &&
    desktop.onMeasurementUnitChanged
  ) {
    connectAppWideMeasurementUnit({
      get: () => desktop.getMeasurementUnit!(),
      set: (unit) => desktop.setMeasurementUnit!(unit),
      onChanged: (handler) => desktop.onMeasurementUnitChanged!(handler),
    })
  }
  await window.desktop
    ?.getAiPanelPrefs?.()
    .then(applyAiPanelPrefs)
    .catch(() => {})
  window.desktop?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  await window.desktop
    ?.getAuthorName?.()
    .then(setAuthorName)
    .catch(() => {})
  window.desktop?.onAuthorNameChanged?.(setAuthorName)
  const root = createRoot(document.getElementById('root')!)
  flushSync(() =>
    root.render(
      <LocaleProvider initial={lang}>
        <App />
      </LocaleProvider>,
    ),
  )
}

void bootstrap()
