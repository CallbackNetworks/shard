import { createPortal } from 'react-dom'
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
 *
 * Portalled to the body, for the same reason `OverflowMenu` is (ADR-0122, ADR-0129):
 * the backdrop is `position: fixed; inset: 0`, and any transformed ancestor becomes
 * the containing block for that — `.kt-route-shell` keeps an identity transform after
 * its entrance animation, so the backdrop sized itself to the *scroll content* and
 * centred the panel in the middle of the whole page instead of the viewport, inside a
 * stacking context the rail and the tickers then drew over. A dialog must not depend
 * on which subtree opened it.
 */
export default function FormModal({
  title,
  ariaLabel,
  onClose,
  onSubmit,
  submitLabel,
  submitDisabled = false,
  footer,
  wide = false,
  width,
  children,
}) {
  const { t } = useTranslation()
  const trapRef = useFocusTrap(onClose)

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={ariaLabel || title} className="kt-modal-backdrop">
      <div
        ref={trapRef}
        className={wide ? 'kt-modal kt-modal-wide' : 'kt-modal'}
        style={width ? { width, maxWidth: '95vw' } : undefined}
      >
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
    </div>,
    document.body,
  )
}
