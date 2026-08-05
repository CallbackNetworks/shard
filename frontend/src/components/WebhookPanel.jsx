import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Check, Eye, EyeOff, RefreshCw, Link2, KeyRound } from 'lucide-react'
import { getWebhookConfig, rotateWebhookSecret } from '../api/client'
import s from './WebhookPanel.module.css'

/**
 * Everything a CI provider needs to call back into one task.
 *
 * The callback endpoint is unauthenticated by design — a build runner cannot carry the
 * owner's session — so the signature is the only thing separating a leaked URL from a
 * write, and unsigned callbacks are rejected (ADR-0060). That makes the secret part of
 * the configuration rather than an optional extra, which is why URL and key are shown
 * together here: whoever copies one needs the other in the same breath.
 *
 * The secret is fetched only when this panel is open and dropped as soon as it closes
 * (`gcTime: 0`), so it is not sitting in the query cache of every screen that ever
 * showed a task list.
 */
export default function WebhookPanel({ taskId }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(null)

  const { data, isLoading } = useQuery({
    queryKey: ['webhook-config', taskId],
    queryFn: () => getWebhookConfig(taskId),
    // Never stale while the panel is open, dropped the moment it closes. The realtime
    // sync invalidates every query on any graph change (ADR-0059), and reading this one
    // writes an activity row — without staleTime the feed would fill with reveals the
    // user never asked for. Rotating invalidates it explicitly, which is the only way
    // the value can actually change.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })

  const rotate = useMutation({
    mutationFn: () => rotateWebhookSecret(taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-config', taskId] }),
  })

  const copy = (what, text) => {
    navigator.clipboard.writeText(text)
    setCopied(what)
    setTimeout(() => setCopied(null), 2000)
  }

  if (isLoading || !data) {
    return <div className={s.loading}>{t('webhookPanel.loading', { defaultValue: 'Loading…' })}</div>
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const url = `${origin}${data.path}`

  const CopyBtn = ({ what, text }) => (
    <button className={s.iconBtn} onClick={() => copy(what, text)} title={t('copy')}>
      {copied === what ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )

  return (
    <div className={s.panel}>
      <div className={s.row}>
        <span className={s.label}><Link2 size={11} /> {t('webhookPanel.url', { defaultValue: 'Callback URL' })}</span>
        <div className={s.value}>
          <span className={s.code}>{url}</span>
          <CopyBtn what="url" text={url} />
        </div>
      </div>

      <div className={s.row}>
        <span className={s.label}>
          <KeyRound size={11} /> {t('webhookPanel.secret', { defaultValue: 'Signing secret' })}
        </span>
        <div className={s.value}>
          <span className={s.code}>{revealed ? data.secret : '•'.repeat(32)}</span>
          <button
            className={s.iconBtn}
            onClick={() => setRevealed(v => !v)}
            title={revealed ? t('webhookPanel.hide', { defaultValue: 'Hide' }) : t('webhookPanel.reveal', { defaultValue: 'Reveal' })}
          >
            {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <CopyBtn what="secret" text={data.secret} />
          <button
            className={s.iconBtn}
            onClick={() => rotate.mutate()}
            disabled={rotate.isPending}
            title={t('webhookPanel.rotate', { defaultValue: 'Issue a new secret (old one stops working)' })}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <p className={s.hint}>
        {t('webhookPanel.hint', {
          defaultValue: 'Sign the request body with this key. GitHub sends X-Hub-Signature-256, GitLab sends X-Gitlab-Token, anything else can use X-Signature. Unsigned callbacks are rejected.',
        })}
      </p>
    </div>
  )
}
