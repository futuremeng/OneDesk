import { useEffect, useRef, useState } from 'react'
import appIcon from './assets/app-icon.png'
import { useI18n } from './locale'
import './onboarding.css'

interface OnboardingProps {
  /** persists completion */
  onDone: () => Promise<boolean>
}

export function Onboarding({ onDone }: OnboardingProps) {
  const { t } = useI18n()
  const [submitting, setSubmitting] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const finish = () => {
    if (submitting) return
    setSubmitting(true)
    void onDone()
      .catch(() => false)
      .finally(() => setSubmitting(false))
  }

  // move focus into the dialog on mount so keyboard users start inside it
  // (the container, not a button, so no focus ring shows on open)
  useEffect(() => {
    cardRef.current?.focus()
  }, [])

  // keyboard handling: Escape skips, Enter / ArrowRight start, and Tab is
  // trapped inside the dialog (aria-modal). Enter is ignored when a button is
  // focused so the native click doesn't double-fire.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        finish()
        return
      }
      if (event.key === 'Tab') {
        const card = cardRef.current
        if (!card) return
        const focusables = Array.from(card.querySelectorAll<HTMLElement>('button'))
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        // the card itself holds focus on open; from there, Tab in either
        // direction must land on a dialog control, never behind the modal
        const onButton = active instanceof HTMLElement && focusables.includes(active)
        if (!onButton) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        } else if (event.shiftKey && active === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
        return
      }
      const buttonFocused =
        event.target instanceof HTMLElement && event.target.closest('button') !== null
      if ((event.key === 'Enter' && !buttonFocused) || event.key === 'ArrowRight') finish()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="onb-overlay" role="dialog" aria-modal="true" aria-label={t('onbTitle1')}>
      <div className="onb-card" ref={cardRef} tabIndex={-1}>
        <div className="onb-stage">
          <div className="onb-slide active">
            <img className="onb-art onb-art-logo" src={appIcon} alt="" />
            <h2 className="onb-title">{t('onbTitle1')}</h2>
            <p className="onb-subtitle">{t('onbSubtitle1')}</p>
            <p className="onb-body">{t('onbBody1')}</p>
          </div>
        </div>

        <div className="onb-footer">
          <div className="onb-nav">
            <button className="onb-next" disabled={submitting} onClick={finish}>
              {t('onbStart')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
