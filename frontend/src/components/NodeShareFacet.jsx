import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Share2, RefreshCw, Copy, Check, Rss, Lock, Clock } from 'lucide-react'
import {
  rotateNodeShareToken, setNodeSharePin, clearNodeSharePin, setNodeShareExpiry,
} from '../api/client'
import { DARK } from '../constants/theme'

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time; derive it from the
// stored ISO expiry so the input pre-fills with the current value.
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Compact share facade for any is_shareable node (ADR-0039). Mirrors the
// identity/project share controls but driven by the generic /nodes/{id}/share
// endpoints, so a user-defined shareable type gets the same public page + iCal,
// PIN protection, and expiry.
export default function NodeShareFacet({ node, subscribable }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [copied, setCopied] = useState(null)
  const [pinInput, setPinInput] = useState('')
  const [expiryInput, setExpiryInput] = useState(toLocalInput(node?.data?.share_expires_at))

  const token = node?.data?.share_token || null
  const pinSet = !!node?.data?.share_pin_hash
  const expiresAt = node?.data?.share_expires_at || null
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const shareUrl = token ? `${origin}/share/n/${token}` : ''
  const icalUrl = token ? `${origin}/ical/node/${token}.ics` : ''

  const invalidate = () => qc.invalidateQueries({ queryKey: ['node', node.id] })
  const rotate = useMutation({ mutationFn: () => rotateNodeShareToken(node.id), onSuccess: invalidate })
  const setPin = useMutation({
    mutationFn: () => setNodeSharePin(node.id, pinInput),
    onSuccess: () => { setPinInput(''); invalidate() },
  })
  const clearPin = useMutation({ mutationFn: () => clearNodeSharePin(node.id), onSuccess: invalidate })
  const setExpiry = useMutation({
    mutationFn: () => setNodeShareExpiry(node.id, expiryInput ? new Date(expiryInput).toISOString() : null),
    onSuccess: invalidate,
  })

  const copy = (value, key) => {
    navigator.clipboard?.writeText(value)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  const rowStyle = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }
  const linkStyle = {
    flex: '1 1 220px', fontSize: 12, color: DARK.textMid, fontFamily: 'monospace',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    padding: '5px 8px', background: DARK.surface, border: `1px solid ${DARK.border}`,
  }
  const subLabel = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: DARK.textMid }

  return (
    <div className="kt-card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Share2 size={15} color="#818cf8" />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: DARK.text }}>{t('nodeShare.title')}</h3>
        {token && (
          <button
            className="kt-btn" style={{ marginLeft: 'auto' }}
            disabled={rotate.isPending}
            onClick={() => rotate.mutate()}
          >
            <RefreshCw size={12} /> {t('nodeShare.rotate')}
          </button>
        )}
      </div>

      {!token ? (
        <button
          className="kt-btn kt-btn-primary" style={{ marginTop: 10 }}
          disabled={rotate.isPending}
          onClick={() => rotate.mutate()}
        >
          <Share2 size={12} /> {t('nodeShare.create')}
        </button>
      ) : (
        <>
          <div style={rowStyle}>
            <span style={linkStyle} title={shareUrl}>{shareUrl}</span>
            <button className="kt-btn" aria-label={t('nodeShare.copyLink')} onClick={() => copy(shareUrl, 'link')}>
              {copied === 'link' ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
          {subscribable && (
            <div style={rowStyle}>
              <span style={{ ...linkStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }} title={icalUrl}>
                <Rss size={11} color={DARK.textDim} /> {icalUrl}
              </span>
              <button className="kt-btn" aria-label={t('nodeShare.copyIcal')} onClick={() => copy(icalUrl, 'ical')}>
                {copied === 'ical' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          )}

          {/* PIN protection */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${DARK.border}` }}>
            <span style={subLabel}>
              <Lock size={12} color={DARK.textDim} /> {t('nodeShare.pinTitle')}
              {pinSet && <span style={{ color: DARK.success, fontWeight: 700, fontSize: 11 }}>{t('nodeShare.pinActive')}</span>}
            </span>
            <div style={rowStyle}>
              <input
                className="kt-input" style={{ width: 120 }}
                inputMode="numeric" maxLength={6}
                value={pinInput}
                onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
                placeholder={t('nodeShare.pinPlaceholder')}
                aria-label={t('nodeShare.pinTitle')}
              />
              <button
                className="kt-btn kt-btn-primary"
                disabled={pinInput.length < 4 || setPin.isPending}
                onClick={() => setPin.mutate()}
              >
                {t('nodeShare.pinSet')}
              </button>
              {pinSet && (
                <button className="kt-btn" disabled={clearPin.isPending} onClick={() => clearPin.mutate()}>
                  {t('nodeShare.pinRemove')}
                </button>
              )}
            </div>
          </div>

          {/* Expiry */}
          <div style={{ marginTop: 12 }}>
            <span style={subLabel}>
              <Clock size={12} color={DARK.textDim} /> {t('nodeShare.expiryTitle')}
            </span>
            <div style={rowStyle}>
              <input
                type="datetime-local"
                className="kt-input" style={{ width: 220 }}
                value={expiryInput}
                onChange={e => setExpiryInput(e.target.value)}
                aria-label={t('nodeShare.expiryTitle')}
              />
              <button className="kt-btn kt-btn-primary" disabled={setExpiry.isPending} onClick={() => setExpiry.mutate()}>
                {expiryInput ? t('nodeShare.expirySet') : t('nodeShare.expiryClear')}
              </button>
            </div>
            {expiresAt && (
              <span style={{ fontSize: 11, color: DARK.textDim, marginTop: 4, display: 'inline-block' }}>
                {t('nodeShare.expiresAt', { when: new Date(expiresAt).toLocaleString() })}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
