import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@onedesk/i18n'
import App from './App'
import { LocaleProvider } from './i18n/locale'
import type { UiTheme } from '../shared/ipc'
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
import './styles.css'
import { applyAiPanelPrefs, installScreenTips } from '@onedesk/ui'

installScreenTips()

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

void (async () => {
  const [lang, theme] = await Promise.all([
    window.pdfApi.getLanguage().catch(() => 'zh' as const),
    window.pdfApi.getTheme().catch(() => 'system' as const),
  ])
  document.documentElement.lang = htmlLang(lang as Lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  window.pdfApi.onThemeChanged(applyTheme)
  await window.pdfApi
    ?.getAiPanelPrefs?.()
    .then(applyAiPanelPrefs)
    .catch(() => {})
  window.pdfApi?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  )
})()
