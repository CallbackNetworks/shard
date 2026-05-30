import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, RefreshCw, X, Zap, Plus, Trash2, BookOpen, Activity, RotateCcw } from 'lucide-react'
import {
  getIntegrations, createIntegration, updateIntegration, deleteIntegration,
  testIntegration, getDeliveries, retryDelivery, getIntegrationTemplates,
  getIntegrationTemplate, getIntegrationHealth, bulkRetryDeliveries,
} from '../api/client'
import { globalAddToast } from '../context/ToastContext'
import { BRAND, BTN_PRIMARY, BTN_GHOST, BTN_SM } from '../constants/theme'

const TYPE_ICONS = {
  jenkins: '⚙️', drone: '🚁', generic: '🔗', email: '📧', webhook: '🪝',
  github: '', gitlab: '🦊', bitbucket: '🪣', circleci: '⭕',
}
const ALL_EVENTS = ['task.done', 'task.failed', 'task.in_progress', 'task.created', 'project.complete', 'task.due_soon', 'task.overdue']

const STATUS_COLORS = {
  success: { bg: 'rgba(52,211,153,0.1)',  color: '#1ed760', dot: '#22c55e' },
  failed:  { bg: 'rgba(248,113,113,0.1)', color: '#f87171', dot: '#ef4444' },
  dead:    { bg: 'rgba(248,113,113,0.1)', color: '#fca5a5', dot: '#b91c1c' },
  pending: { bg: 'rgba(251,191,36,0.1)',  color: '#fbbf24', dot: '#f59e0b' },
}

const INPUT_STYLE = {
  display: 'block', width: '100%', marginTop: 4,
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
  padding: '8px 12px', fontSize: 14,
  background: 'rgba(255,255,255,0.05)', color: '#ffffff',
}
const SELECT_STYLE = { ...INPUT_STYLE, background: '#181818' }
const LABEL_STYLE = { fontSize: 13, fontWeight: 600, color: '#ffffff' }

/* ── Delivery Detail Modal ── */
function DeliveryDetailModal({ delivery, onClose, onRetry }) {
  const { t } = useTranslation()
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: '#181818', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 24, width: '90vw', maxWidth: 560, maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontWeight: 700, color: '#ffffff', margin: 0 }}>Delivery Detail</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)' }}><X size={16} /></button>
        </div>
        <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Row label="Event" value={delivery.event} />
          <Row label="Status" value={delivery.status} color={STATUS_COLORS[delivery.status]?.color} />
          <Row label="Status Code" value={delivery.status_code ?? '—'} />
          <Row label="Attempt" value={delivery.attempt} />
          <Row label="URL" value={delivery.request_url} mono />
          <Row label="Created" value={new Date(delivery.created_at).toLocaleString()} />
          {delivery.delivered_at && <Row label="Delivered" value={new Date(delivery.delivered_at).toLocaleString()} />}
          {delivery.next_retry_at && <Row label="Next Retry" value={new Date(delivery.next_retry_at).toLocaleString()} />}
          {delivery.error && (
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Error</div>
              <pre style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '8px 10px', color: '#fca5a5', fontSize: 11, whiteSpace: 'pre-wrap', margin: 0 }}>{delivery.error}</pre>
            </div>
          )}
          {delivery.response_body && (
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Response Body</div>
              <pre style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '8px 10px', color: '#b3b3b3', fontSize: 11, whiteSpace: 'pre-wrap', margin: 0, maxHeight: 120, overflow: 'auto' }}>{delivery.response_body}</pre>
            </div>
          )}
          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Payload</div>
            <pre style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '8px 10px', color: '#b3b3b3', fontSize: 11, whiteSpace: 'pre-wrap', margin: 0, maxHeight: 180, overflow: 'auto' }}>{JSON.stringify(delivery.payload, null, 2)}</pre>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {['failed', 'dead'].includes(delivery.status) && (
            <button onClick={() => onRetry(delivery.id)} style={BTN_PRIMARY}>{t('retry')}</button>
          )}
          <button onClick={onClose} style={BTN_GHOST}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, mono, color }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', minWidth: 80, paddingTop: 1 }}>{label}</span>
      <span style={{ color: color || '#b3b3b3', fontFamily: mono ? 'monospace' : 'inherit', fontSize: 12, wordBreak: 'break-all' }}>{String(value)}</span>
    </div>
  )
}

/* ── Health Stats Badge ── */
function HealthStats({ integrationId }) {
  const { t } = useTranslation()
  const { data: health } = useQuery({
    queryKey: ['integration-health', integrationId],
    queryFn: () => getIntegrationHealth(integrationId),
    staleTime: 60000,
  })
  if (!health || health.total_deliveries === 0) return null

  const rateColor = health.success_rate >= 90 ? '#22c55e' : health.success_rate >= 50 ? '#f59e0b' : '#ef4444'

  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11 }}>
      <span style={{ color: rateColor }}>
        <Activity size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
        {health.success_rate}% {t('integrations.successRate').toLowerCase()}
      </span>
      {health.avg_latency_ms != null && (
        <span style={{ color: 'rgba(255,255,255,0.35)' }}>
          {health.avg_latency_ms}ms {t('integrations.avgLatency').toLowerCase()}
        </span>
      )}
      {health.last_success_at && (
        <span style={{ color: 'rgba(255,255,255,0.25)' }}>
          {t('integrations.lastSuccess')}: {new Date(health.last_success_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
        </span>
      )}
      {health.dead > 0 && (
        <span style={{ color: '#ef4444' }}>{health.dead} dead</span>
      )}
    </div>
  )
}

/* ── Delivery Log with Filters ── */
function DeliveryLog({ integrationId }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState(null)
  const [filterEvent, setFilterEvent] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const { data: deliveries = [], refetch } = useQuery({
    queryKey: ['deliveries', integrationId, filterEvent, filterStatus],
    queryFn: () => getDeliveries(integrationId, {
      ...(filterEvent ? { event: filterEvent } : {}),
      ...(filterStatus ? { status: filterStatus } : {}),
    }),
    enabled: expanded,
    staleTime: 10000,
  })

  const retryMut = useMutation({
    mutationFn: retryDelivery,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deliveries', integrationId] }); setSelected(null) },
  })

  const bulkRetryMut = useMutation({
    mutationFn: () => bulkRetryDeliveries(integrationId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['deliveries', integrationId] })
      qc.invalidateQueries({ queryKey: ['integration-health', integrationId] })
      globalAddToast(t('integrations.bulkRetryResult', data), 'info')
    },
  })

  const hasFailures = deliveries.some(d => ['failed', 'dead'].includes(d.status))

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', fontSize: 12, padding: 0 }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t('integrations.recentDeliveries')}
        <button
          onClick={(e) => { e.stopPropagation(); refetch() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)', padding: '0 2px', display: 'flex' }}
          title="Refresh"
        >
          <RefreshCw size={10} />
        </button>
      </button>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {/* Filters Row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <select value={filterEvent} onChange={e => setFilterEvent(e.target.value)}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: '#181818', color: '#b3b3b3' }}>
              <option value="">{t('integrations.allEvents')}</option>
              {ALL_EVENTS.map(ev => <option key={ev} value={ev}>{ev}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: '#181818', color: '#b3b3b3' }}>
              <option value="">{t('integrations.allStatuses')}</option>
              {['success', 'failed', 'dead', 'pending'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {hasFailures && (
              <button onClick={() => bulkRetryMut.mutate()} disabled={bulkRetryMut.isPending}
                style={{ fontSize: 10, padding: '3px 8px', border: '1px solid rgba(79,70,229,0.4)', borderRadius: 6, background: 'rgba(79,70,229,0.1)', color: BRAND, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <RotateCcw size={10} /> {t('integrations.bulkRetry')}
              </button>
            )}
          </div>

          {deliveries.length === 0 ? (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', padding: '4px 0' }}>{t('integrations.noDeliveries')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {deliveries.slice(0, 20).map(d => {
                const sc = STATUS_COLORS[d.status] || STATUS_COLORS.pending
                return (
                  <div key={d.id} onClick={() => setSelected(d)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: sc.dot, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', flex: 1 }}>{d.event}</span>
                    <span style={{ fontSize: 10, color: sc.color, fontWeight: 600 }}>{d.status_code ?? d.status}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
                      {new Date(d.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {['failed', 'dead'].includes(d.status) && (
                      <button onClick={(e) => { e.stopPropagation(); retryMut.mutate(d.id) }}
                        style={{ fontSize: 10, padding: '1px 6px', border: '1px solid rgba(79,70,229,0.4)', borderRadius: 4, background: 'rgba(79,70,229,0.1)', color: '#1ed760', cursor: 'pointer' }}>
                        {t('retry')}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {selected && (
        <DeliveryDetailModal delivery={selected} onClose={() => setSelected(null)} onRetry={(id) => retryMut.mutate(id)} />
      )}
    </div>
  )
}

/* ── Template Selector ── */
function TemplatePicker({ onSelect, onClose }) {
  const { t } = useTranslation()
  const { data: templates = [] } = useQuery({
    queryKey: ['integration-templates'],
    queryFn: getIntegrationTemplates,
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: '#181818', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 28, width: '90vw', maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontWeight: 700, color: '#ffffff', margin: 0 }}>{t('integrations.fromTemplate')}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)' }}><X size={16} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {templates.map(tmpl => (
            <button key={tmpl.id} onClick={() => onSelect(tmpl)}
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '14px 12px', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ fontSize: 20, marginBottom: 6 }}>{TYPE_ICONS[tmpl.type] || '🔗'}</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#fff' }}>{tmpl.name}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{tmpl.description}</div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button onClick={onClose} style={{ ...BTN_GHOST, fontSize: 13 }}>{t('integrations.orManual')}</button>
        </div>
      </div>
    </div>
  )
}

/* ── Setup Instructions Modal ── */
function SetupModal({ templateId, onClose }) {
  const { t } = useTranslation()
  const { data: template } = useQuery({
    queryKey: ['integration-template', templateId],
    queryFn: () => getIntegrationTemplate(templateId),
    enabled: !!templateId,
  })
  if (!template) return null

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: '#181818', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 24, width: '90vw', maxWidth: 640, maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontWeight: 700, color: '#ffffff', margin: 0 }}>{template.name} - {t('integrations.templateSetup')}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)' }}><X size={16} /></button>
        </div>
        <div style={{ fontSize: 13, color: '#b3b3b3', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
          {template.setup_instructions?.split('```').map((block, i) =>
            i % 2 === 0
              ? <span key={i}>{block}</span>
              : <pre key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#e0e0e0', overflow: 'auto', margin: '8px 0' }}>{block.replace(/^(yaml|groovy|json)\n/, '')}</pre>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={onClose} style={BTN_GHOST}>{t('close')}</button>
        </div>
      </div>
    </div>
  )
}

/* ── Custom Headers Editor ── */
function CustomHeadersEditor({ headers, onChange }) {
  const { t } = useTranslation()
  const entries = Object.entries(headers || {})

  const addHeader = () => onChange({ ...headers, '': '' })
  const removeHeader = (key) => {
    const next = { ...headers }
    delete next[key]
    onChange(next)
  }
  const updateKey = (oldKey, newKey) => {
    const next = {}
    for (const [k, v] of Object.entries(headers || {})) {
      next[k === oldKey ? newKey : k] = v
    }
    onChange(next)
  }
  const updateValue = (key, val) => onChange({ ...headers, [key]: val })

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', marginBottom: 6 }}>{t('integrations.customHeaders')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map(([k, v], i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={k} onChange={e => updateKey(k, e.target.value)} placeholder={t('integrations.headerKey')}
              style={{ ...INPUT_STYLE, width: '40%', marginTop: 0 }} />
            <input value={v} onChange={e => updateValue(k, e.target.value)} placeholder={t('integrations.headerValue')}
              style={{ ...INPUT_STYLE, flex: 1, marginTop: 0 }} />
            <button onClick={() => removeHeader(k)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: 4 }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={addHeader}
        style={{ ...BTN_GHOST, fontSize: 12, marginTop: 6, padding: '4px 10px' }}>
        <Plus size={12} style={{ marginRight: 4 }} /> {t('integrations.addHeader')}
      </button>
    </div>
  )
}

/* ── Integration Form Modal ── */
function IntegrationModal({ initial, onSave, onClose }) {
  const { t } = useTranslation()
  const [form, setForm] = useState(initial || {
    name: '', type: 'generic', url: '', secret: '', project_id: '',
    events: ['task.done', 'task.failed', 'project.complete'], active: true,
    email_to: '', email_subject_prefix: '[TODO Platform]',
    auth_type: 'bearer', auth_config: {}, custom_headers: {}, template_id: null,
  })
  const [showSetup, setShowSetup] = useState(null)

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const toggleEvent = (ev) => set('events', form.events.includes(ev) ? form.events.filter(e => e !== ev) : [...form.events, ev])

  const typeLabels = {
    jenkins: t('integrations.typeJenkins'), drone: t('integrations.typeDrone'),
    generic: t('integrations.typeWebhook'), webhook: t('integrations.typeWebhookHmac'),
    email: t('integrations.typeEmail'), github: t('integrations.typeGithub'),
    gitlab: t('integrations.typeGitlab'), bitbucket: t('integrations.typeBitbucket'),
    circleci: t('integrations.typeCircleci'),
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: '#181818', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 28, width: '90vw', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontWeight: 700, color: '#ffffff', margin: 0 }}>{initial ? t('integrations.editDialog') : t('integrations.newDialog')}</h2>
          {form.template_id && (
            <button onClick={() => setShowSetup(form.template_id)}
              style={{ ...BTN_GHOST, fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <BookOpen size={12} /> {t('integrations.viewSetup')}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Name */}
          <label style={LABEL_STYLE}>{t('name')}
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder={t('integrations.namePlaceholder')} style={INPUT_STYLE} />
          </label>

          {/* Type */}
          <label style={LABEL_STYLE}>{t('type')}
            <select value={form.type} onChange={e => set('type', e.target.value)} style={SELECT_STYLE}>
              {Object.entries(typeLabels).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </label>

          {form.type === 'email' ? (
            <>
              <label style={LABEL_STYLE}>{t('integrations.recipients')}
                <input value={form.email_to} onChange={e => set('email_to', e.target.value)} placeholder={t('integrations.recipientsPlaceholder')} style={INPUT_STYLE} />
              </label>
              <label style={LABEL_STYLE}>{t('integrations.subjectPrefix')}
                <input value={form.email_subject_prefix} onChange={e => set('email_subject_prefix', e.target.value)} placeholder="[TODO Platform]" style={INPUT_STYLE} />
              </label>
            </>
          ) : (
            <>
              {/* URL */}
              <label style={LABEL_STYLE}>{t('integrations.webhookUrl')}
                <input value={form.url} onChange={e => set('url', e.target.value)} placeholder={t('integrations.webhookUrlPlaceholder')} style={INPUT_STYLE} />
              </label>

              {/* Auth Type */}
              <label style={LABEL_STYLE}>{t('integrations.authType')}
                <select value={form.auth_type || 'bearer'} onChange={e => set('auth_type', e.target.value)} style={SELECT_STYLE}>
                  <option value="bearer">{t('integrations.authBearer')}</option>
                  <option value="basic">{t('integrations.authBasic')}</option>
                  <option value="api_key">{t('integrations.authApiKey')}</option>
                  <option value="none">{t('integrations.authNone')}</option>
                </select>
              </label>

              {/* Auth config based on type */}
              {form.auth_type === 'bearer' && (
                <label style={LABEL_STYLE}>
                  {form.type === 'webhook' ? t('integrations.signingSecret') : t('integrations.bearerToken')}
                  <input value={form.secret} onChange={e => set('secret', e.target.value)}
                    placeholder={form.type === 'webhook' ? t('integrations.signingSecretPlaceholder') : 'token...'} style={INPUT_STYLE} />
                </label>
              )}
              {form.auth_type === 'basic' && (
                <>
                  <label style={LABEL_STYLE}>{t('integrations.basicUsername')}
                    <input value={form.auth_config?.username || ''} onChange={e => set('auth_config', { ...form.auth_config, username: e.target.value })} style={INPUT_STYLE} />
                  </label>
                  <label style={LABEL_STYLE}>{t('integrations.basicPassword')}
                    <input type="password" value={form.auth_config?.password || ''} onChange={e => set('auth_config', { ...form.auth_config, password: e.target.value })} style={INPUT_STYLE} />
                  </label>
                </>
              )}
              {form.auth_type === 'api_key' && (
                <>
                  <label style={LABEL_STYLE}>{t('integrations.apiKeyHeader')}
                    <input value={form.auth_config?.header_name || 'X-API-Key'} onChange={e => set('auth_config', { ...form.auth_config, header_name: e.target.value })} style={INPUT_STYLE} />
                  </label>
                  <label style={LABEL_STYLE}>{t('integrations.apiKeyValue')}
                    <input value={form.auth_config?.header_value || ''} onChange={e => set('auth_config', { ...form.auth_config, header_value: e.target.value })} style={INPUT_STYLE} />
                  </label>
                </>
              )}

              {form.type === 'webhook' && (
                <div style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#60a5fa' }}>
                  {t('integrations.hmacInfo')}
                </div>
              )}

              {/* Custom Headers */}
              <CustomHeadersEditor headers={form.custom_headers || {}} onChange={h => set('custom_headers', h)} />
            </>
          )}

          {/* Project ID */}
          <label style={LABEL_STYLE}>{t('integrations.projectIdLabel')}
            <input value={form.project_id} onChange={e => set('project_id', e.target.value)} placeholder={t('integrations.projectIdPlaceholder')} style={INPUT_STYLE} />
          </label>

          {/* Events */}
          <div style={LABEL_STYLE}>{t('integrations.events')}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {ALL_EVENTS.map(ev => (
                <label key={ev} style={{
                  display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                  background: form.events.includes(ev) ? 'rgba(30,215,96,0.12)' : 'rgba(255,255,255,0.05)',
                  color: form.events.includes(ev) ? '#1ed760' : 'rgba(255,255,255,0.4)',
                  borderRadius: 999, padding: '4px 12px', fontSize: 13,
                  border: form.events.includes(ev) ? '1px solid rgba(30,215,96,0.3)' : '1px solid rgba(255,255,255,0.08)',
                }}>
                  <input type="checkbox" checked={form.events.includes(ev)} onChange={() => toggleEvent(ev)} style={{ cursor: 'pointer' }} />
                  {ev}
                </label>
              ))}
            </div>
          </div>

          {/* Active */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#ffffff' }}>
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
            Active
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={() => onSave(form)} disabled={!form.name || (form.type !== 'email' && !form.url) || (form.type === 'email' && !form.email_to)}
            style={BTN_PRIMARY}>{t('save')}</button>
          <button onClick={onClose} style={BTN_GHOST}>{t('cancel')}</button>
        </div>
      </div>
      {showSetup && <SetupModal templateId={showSetup} onClose={() => setShowSetup(null)} />}
    </div>
  )
}

/* ── Main Page ── */
export default function Integrations() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: integrations = [], isLoading } = useQuery({ queryKey: ['integrations'], queryFn: getIntegrations })
  const [modal, setModal] = useState(null)
  const [templatePicker, setTemplatePicker] = useState(false)
  const [testResults, setTestResults] = useState({})
  const [setupModal, setSetupModal] = useState(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['integrations'] })

  const _checkSmtpWarning = (data) => {
    if (data?.smtp_warning) globalAddToast(data.smtp_warning, 'warning')
  }

  const createMut = useMutation({ mutationFn: createIntegration, onSuccess: (data) => { invalidate(); setModal(null); _checkSmtpWarning(data) } })
  const updateMut = useMutation({ mutationFn: ({ id, data }) => updateIntegration(id, data), onSuccess: (data) => { invalidate(); setModal(null); _checkSmtpWarning(data) } })
  const deleteMut = useMutation({ mutationFn: deleteIntegration, onSuccess: invalidate })
  const testMut = useMutation({ mutationFn: testIntegration, onSuccess: (data, id) => setTestResults(r => ({ ...r, [id]: data })) })

  const handleSave = (form) => {
    const data = {
      ...form,
      project_id: form.project_id || null,
      secret: form.secret || null,
      email_to: form.email_to || null,
      email_subject_prefix: form.email_subject_prefix || '[TODO Platform]',
      custom_headers: form.custom_headers && Object.keys(form.custom_headers).length > 0 ? form.custom_headers : null,
      auth_config: form.auth_config && Object.keys(form.auth_config).length > 0 ? form.auth_config : null,
    }
    if (form.type === 'email' && !data.url) data.url = ''
    if (modal.mode === 'edit') updateMut.mutate({ id: modal.data.id, data })
    else createMut.mutate(data)
  }

  const handleTemplateSelect = (tmpl) => {
    setTemplatePicker(false)
    setModal({
      mode: 'create',
      data: {
        name: tmpl.name, type: tmpl.type, url: '', secret: '',
        project_id: '', events: tmpl.default_events, active: true,
        email_to: '', email_subject_prefix: '[TODO Platform]',
        auth_type: tmpl.auth_type || 'bearer', auth_config: {}, custom_headers: {},
        template_id: tmpl.id,
      },
    })
  }

  if (isLoading) return <p style={{ color: 'rgba(255,255,255,0.35)' }}>{t('loading')}</p>

  return (
    <div className="page-content" style={{ padding: '32px 40px' }}>
      {modal && <IntegrationModal initial={modal.data} onSave={handleSave} onClose={() => setModal(null)} />}
      {templatePicker && <TemplatePicker onSelect={handleTemplateSelect} onClose={() => setTemplatePicker(false)} />}
      {setupModal && <SetupModal templateId={setupModal} onClose={() => setSetupModal(null)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#ffffff' }}>{t('integrations.title')}</h1>
          <p style={{ color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{t('integrations.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTemplatePicker(true)}
            style={{ ...BTN_GHOST, display: 'flex', alignItems: 'center', gap: 6 }}>
            <BookOpen size={14} /> {t('integrations.fromTemplate')}
          </button>
          <button onClick={() => setModal({ mode: 'create' })} style={BTN_PRIMARY}>
            {t('integrations.new')}
          </button>
        </div>
      </div>

      {integrations.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.2)', animation: 'fadeIn 0.4s ease' }}>
          <Zap size={36} style={{ margin: '0 auto 14px', opacity: 0.3, display: 'block', color: BRAND }} />
          <p style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>{t('integrations.empty')}</p>
          <p style={{ marginTop: 6, fontSize: 13 }}>{t('integrations.emptyHint')}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
            <button onClick={() => setTemplatePicker(true)}
              style={{ ...BTN_GHOST, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <BookOpen size={14} /> {t('integrations.fromTemplate')}
            </button>
            <button onClick={() => setModal({ mode: 'create' })}
              style={{ ...BTN_PRIMARY, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {t('integrations.new')}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {integrations.map((intg, intgIdx) => (
            <div key={intg.id} style={{
              background: '#181818', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12, padding: '16px 20px',
              animation: 'fadeUpIn 0.35s ease forwards',
              animationDelay: `${intgIdx * 0.06}s`,
              opacity: 0,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{TYPE_ICONS[intg.type] || '🔗'}</span>
                    <span style={{ fontWeight: 600, fontSize: 15, color: '#ffffff' }}>{intg.name}</span>
                    <span style={{
                      background: intg.active ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.07)',
                      color: intg.active ? '#1ed760' : '#6b7280',
                      borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600
                    }}>{intg.active ? 'active' : 'inactive'}</span>
                    <span style={{ background: 'rgba(30,215,96,0.12)', color: '#1ed760', borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{intg.type}</span>
                    {intg.auth_type && intg.auth_type !== 'bearer' && (
                      <span style={{ background: 'rgba(96,165,250,0.12)', color: '#60a5fa', borderRadius: 999, padding: '2px 8px', fontSize: 11 }}>{intg.auth_type}</span>
                    )}
                  </div>
                  {intg.type === 'email'
                    ? <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 4 }}>To: {intg.email_to}</p>
                    : <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 4, fontFamily: 'monospace' }}>{intg.url}</p>
                  }
                  {intg.project_id && <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, marginTop: 2 }}>Project: {intg.project_id}</p>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {intg.events.map(ev => (
                      <span key={ev} style={{ background: 'rgba(52,211,153,0.1)', color: '#1ed760', borderRadius: 999, padding: '2px 8px', fontSize: 12 }}>{ev}</span>
                    ))}
                  </div>
                  {/* Health stats */}
                  {intg.type !== 'email' && <HealthStats integrationId={intg.id} />}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {intg.template_id && (
                    <button onClick={() => setSetupModal(intg.template_id)}
                      style={{ background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)', color: '#60a5fa', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <BookOpen size={12} /> {t('integrations.viewSetup')}
                    </button>
                  )}
                  <button onClick={() => testMut.mutate(intg.id)}
                    style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', color: '#1ed760', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>
                    {testMut.isPending ? t('testing') : t('test')}
                  </button>
                  <button onClick={() => setModal({ mode: 'edit', data: {
                    ...intg, secret: intg.secret || '', project_id: intg.project_id || '',
                    email_to: intg.email_to || '', email_subject_prefix: intg.email_subject_prefix || '[TODO Platform]',
                    auth_type: intg.auth_type || 'bearer', auth_config: intg.auth_config || {},
                    custom_headers: intg.custom_headers || {},
                  }})}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#b3b3b3', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>{t('edit')}</button>
                  <button onClick={() => deleteMut.mutate(intg.id)}
                    style={{ background: 'none', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>{t('delete')}</button>
                </div>
              </div>
              {testResults[intg.id] && (
                <div style={{ marginTop: 10, background: testResults[intg.id].success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: testResults[intg.id].success ? '#1ed760' : '#f87171' }}>
                  {testResults[intg.id].success
                    ? t('integrations.testSent', { code: testResults[intg.id].status_code })
                    : t('integrations.testFailed', { error: testResults[intg.id].error })
                  }
                </div>
              )}
              {intg.type !== 'email' && <DeliveryLog integrationId={intg.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
