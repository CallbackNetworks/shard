import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import useFocusTrap from '../../hooks/useFocusTrap'

/**
 * Shared form-modal shell: backdrop + panel + header + form stack + footer.
 *
 * Wraps the global kt-modal-* classes and applies the focus trap (Tab wrap +
 * Escape-to-close) automatically, so page-level form modals only provide their
 * fields. Footer defaults to Cancel + a primary submit button; pass `footer`
 * for fully custom actions or `footer={null}` to omit it.
 */
export default function FormModal({
  title,
  ariaLabel,
  onClose,
  onSubmit,
  submitLabel,
  submitDisabled = false,
  footer,
  width,
  children,
}) {
  const { t } = useTranslation()
  const trapRef = useFocusTrap(onClose)

  return (
    <div role="dialog" aria-modal="true" aria-label={ariaLabel || title} className="kt-modal-backdrop">
      <div ref={trapRef} className="kt-modal" style={width ? { width, maxWidth: '95vw' } : undefined}>
        <div className="kt-modal-header">
          <span className="kt-modal-title">{title}</span>
          <button onClick={onClose} className="kt-icon-btn" aria-label={t('close', { defaultValue: 'Close' })}>
            <X size={16} />
          </button>
        </div>

        <div className="kt-form-stack">{children}</div>

        {footer !== undefined ? footer : (
          <div className="kt-toolbar" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
            <button onClick={onClose} className="kt-btn">{t('cancel')}</button>
            <button onClick={onSubmit} className="kt-btn kt-btn-primary" disabled={submitDisabled}>
              {submitLabel || t('save')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
