import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@onedesk/i18n'
import App from './App'
import { PresentView } from './PresentView'
import { LocaleProvider } from './i18n/locale'
import type { UiTheme } from '../shared/ipc'
import { applyAiPanelPrefs, installScreenTips } from '@onedesk/ui'
import '@onedesk/ui/tokens.css'
import '@onedesk/ui/screentip.css'
import '@onedesk/ui/ai-model-picker.css'
import '@onedesk/ui/ai-queue-strip.css'
import '@onedesk/ui/ai-usage.css'
import '@onedesk/ui/ai-skills.css'
import '@onedesk/ui/dropdown.css'
import '@onedesk/ui/find-panel.css'
import '@onedesk/ui/color-picker.css'
import '@onedesk/ui/ribbon-collapse.css'
import '@onedesk/ui/ai-panel-prefs.css'
import '@onedesk/ui/ai-scope-quote.css'
import '@onedesk/ui/image-dialogs.css'
import './styles.css'

installScreenTips()

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

void (async () => {
  const [lang, theme] = await Promise.all([
    window.htmlApi.getLanguage().catch(() => 'zh' as const),
    window.htmlApi.getTheme().catch(() => 'system' as const),
  ])
  document.documentElement.lang = htmlLang(lang as Lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  window.htmlApi.onThemeChanged(applyTheme)
  await window.htmlApi
    ?.getAiPanelPrefs?.()
    .then(applyAiPanelPrefs)
    .catch(() => {})
  window.htmlApi?.onAiPanelPrefsChanged?.(applyAiPanelPrefs)
  // a present tab/window (opened by Present → New tab) renders only its owner's preview
  const params = new URLSearchParams(location.search)
  const present = params.has('present')
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      {present ? <PresentView title={params.get('title') ?? ''} /> : <App />}
    </LocaleProvider>,
  )
})()
