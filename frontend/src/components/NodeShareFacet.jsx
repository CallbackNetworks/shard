import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Share2, RefreshCw, Copy, Check, Rss } from 'lucide-react'
import { rotateNodeShareToken } from '../api/client'
import { DARK } from '../constants/theme'

// Compact share facade for any is_shareable node (ADR-0039). Mirrors the
// identity/project share controls but driven by the generic /nodes/{id}/share
// endpoints, so a user-defined shareable type gets the same public page + iCal.
export default function NodeShareFacet({ node, subscribable }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [copied, setCopied] = useState(null)

  const token = node?.data?.share_token || null
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const shareUrl = token ? `${origin}/share/n/${token}` : ''
  const icalUrl = token ? `${origin}/ical/node/${token}.ics` : ''

  const rotate = useMutation({
    mutationFn: () => rotateNodeShareToken(node.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['node', node.id] }),
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
        </>
      )}
    </div>
  )
}
