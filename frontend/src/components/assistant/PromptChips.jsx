import { useTranslation } from 'react-i18next'
import { PROMPT_TEMPLATES } from './prompts'

/**
 * The starter prompts. `onPick` receives the resolved prompt *text*, so the
 * caller decides what to do with it — the page sends it, the panel drops it in
 * the input first. Which prompt each chip carries is not a per-surface choice.
 */
export default function PromptChips({ onPick, size = 'md' }) {
  const { t } = useTranslation()
  const compact = size === 'sm'
  return (
    <div style={{ display: 'flex', gap: compact ? 4 : 8, flexWrap: 'wrap', justifyContent: compact ? 'flex-start' : 'center' }}>
      {PROMPT_TEMPLATES.map(tmpl => (
        <button
          key={tmpl.labelKey}
          onClick={() => onPick(t(tmpl.textKey))}
          title={t(tmpl.textKey)}
          className="kt-chip"
          style={{ padding: compact ? '4px 10px' : '8px 14px', fontSize: compact ? 10 : 12, cursor: 'pointer' }}
        >
          {t(tmpl.labelKey)}
        </button>
      ))}
    </div>
  )
}
