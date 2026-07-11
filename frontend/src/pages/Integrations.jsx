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
import { BRAND, DARK, STATUS_COLOR, STATUS_BG } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'
import s from './Integrations.module.css'

const TYPE_ICONS = {
  jenkins: '⚙️', drone: '🚁', generic: '🔗', email: '📧', webhook: '🪝',
  github: '', gitlab: '🦊', bitbucket: '🪣', circleci: '⭕',
}
const EVENT_GROUPS = {
  task: ['task.created', 'task.status_changed', 'task.done', 'task.failed', 'task.in_progress', 'task.assigned', 'task.deleted', 'task.due_soon', 'task.overdue'],
  project: ['project.created', 'project.complete', 'project.archived'],
  other: ['comment.created', 'rule.triggered'],
}
const ALL_EVENTS = [...EVENT_GROUPS.task, ...EVENT_GROUPS.project, ...EVENT_GROUPS.other]
const CRITICAL_EVENTS = ['task.done', 'task.failed', 'task.overdue', 'project.complete']

const STATUS_COLORS = {
  success: { bg: STATUS_BG.done, color: STATUS_COLOR.done, dot: STATUS_COLOR.done },
  failed:  { bg: STATUS_BG.failed, color: STATUS_COLOR.failed, dot: STATUS_COLOR.failed },
  dead:    { bg: STATUS_BG.failed, color: STATUS_COLOR.failed, dot: STATUS_COLOR.failed },
  pending: { bg: STATUS_BG.in_progress, color: STATUS_COLOR.in_progress, dot: STATUS_COLOR.in_progress },
}

/* ── Delivery Detail Modal ── */
function DeliveryDetailModal({ delivery, onClose, onRetry }) {
  const { t } = useTranslation()
  return (
    <div className={s.overlayDark}>
      <div className={s.modalPanelNarrow}>
        <div className={s.modalHeader}>
          <h3 className={s.modalTitle}>Delivery Detail</h3>
          <button onClick={onClose} className={s.closeBtn}><X size={16} /></button>
        </div>
        <div className={s.deliveryDetailBody}>
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
              <div className={s.detailLabel}>Error</div>
              <pre className={s.errorPre}>{delivery.error}</pre>
            </div>
          )}
          {delivery.response_body && (
            <div>
              <div className={s.detailLabel}>Response Body</div>
              <pre className={s.responsePre}>{delivery.response_body}</pre>
            </div>
          )}
          <div>
            <div className={s.detailLabel}>Payload</div>
            <pre className={s.payloadPre}>{JSON.stringify(delivery.payload, null, 2)}</pre>
          </div>
        </div>
        <div className={s.modalActions}>
          {['failed', 'dead'].includes(delivery.status) && (
            <button onClick={() => onRetry(delivery.id)} className="btn-primary">{t('retry')}</button>
          )}
          <button onClick={onClose} className="btn-ghost">{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, mono, color }) {
  return (
    <div className={s.row}>
      <span className={s.rowLabel}>{label}</span>
      <span className={mono ? s.rowValueMono : s.rowValue} style={{ color: color || DARK.textMid }}>{String(value)}</span>
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

  const rateColor = health.success_rate >= 90 ? BRAND : health.success_rate >= 50 ? '#f59e0b' : BRAND

  return (
    <div className={s.healthStats}>
      <span style={{ color: rateColor }}>
        <Activity size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
        {health.success_rate}% {t('integrations.successRate').toLowerCase()}
      </span>
      {health.avg_latency_ms != null && (
        <span className={s.healthLatency}>
          {health.avg_latency_ms}ms {t('integrations.avgLatency').toLowerCase()}
        </span>
      )}
      {health.last_success_at && (
        <span className={s.healthLastSuccess}>
          {t('integrations.lastSuccess')}: {new Date(health.last_success_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
        </span>
      )}
      {health.dead > 0 && (
        <span className={s.healthDead}>{health.dead} dead</span>
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
    <div className={s.deliveryLogWrapper}>
      <button
        onClick={() => setExpanded(v => !v)}
        className={s.deliveryToggleBtn}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t('integrations.recentDeliveries')}
        <button
          onClick={(e) => { e.stopPropagation(); refetch() }}
          className={s.refreshBtn}
          title="Refresh"
        >
          <RefreshCw size={10} />
        </button>
      </button>

      {expanded && (
        <div className={s.deliveryContent}>
          {/* Filters Row */}
          <div className={s.filtersRow}>
            <select value={filterEvent} onChange={e => setFilterEvent(e.target.value)}
              className={s.filterSelect}>
              <option value="">{t('integrations.allEvents')}</option>
              {ALL_EVENTS.map(ev => <option key={ev} value={ev}>{ev}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className={s.filterSelect}>
              <option value="">{t('integrations.allStatuses')}</option>
              {['success', 'failed', 'dead', 'pending'].map(st => <option key={st} value={st}>{st}</option>)}
            </select>
            {hasFailures && (
              <button onClick={() => bulkRetryMut.mutate()} disabled={bulkRetryMut.isPending}
                className={s.bulkRetryBtn} style={{ color: BRAND }}>
                <RotateCcw size={10} /> {t('integrations.bulkRetry')}
              </button>
            )}
          </div>

          {deliveries.length === 0 ? (
            <div className={s.noDeliveries}>{t('integrations.noDeliveries')}</div>
          ) : (
            <div className={s.deliveryList}>
              {deliveries.slice(0, 20).map(d => {
                const sc = STATUS_COLORS[d.status] || STATUS_COLORS.pending
                return (
                  <div key={d.id} onClick={() => setSelected(d)}
                    className={s.deliveryRow}>
                    <span className={s.deliveryDot} style={{ background: sc.dot }} />
                    <span className={s.deliveryEvent}>{d.event}</span>
                    <span className={s.deliveryStatusCode} style={{ color: sc.color }}>{d.status_code ?? d.status}</span>
                    <span className={s.deliveryDate}>
                      {new Date(d.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {['failed', 'dead'].includes(d.status) && (
                      <button onClick={(e) => { e.stopPropagation(); retryMut.mutate(d.id) }}
                        className={s.retryBtn}>
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
    <div className={s.overlayDarker}>
      <div className={s.modalPanelTemplate}>
        <div className={s.modalHeaderLarge}>
          <h2 className={s.modalTitle}>{t('integrations.fromTemplate')}</h2>
          <button onClick={onClose} className={s.closeBtn}><X size={16} /></button>
        </div>
        <div className={s.templateGrid}>
          {templates.map(tmpl => (
            <button key={tmpl.id} onClick={() => onSelect(tmpl)}
              className={s.templateCard}>
              <div className={s.templateIcon}>{TYPE_ICONS[tmpl.type] || '🔗'}</div>
              <div className={s.templateName}>{tmpl.name}</div>
              <div className={s.templateDesc}>{tmpl.description}</div>
            </button>
          ))}
        </div>
        <div className={s.templateFooter}>
          <button onClick={onClose} className="btn-ghost" style={{ fontSize: 13 }}>{t('integrations.orManual')}</button>
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
    <div className={s.overlayDark}>
      <div className={s.modalPanelWide}>
        <div className={s.modalHeader}>
          <h3 className={s.modalTitle}>{template.name} - {t('integrations.templateSetup')}</h3>
          <button onClick={onClose} className={s.closeBtn}><X size={16} /></button>
        </div>
        <div className={s.setupBody}>
          {template.setup_instructions?.split('```').map((block, i) =>
            i % 2 === 0
              ? <span key={i}>{block}</span>
              : <pre key={i} className={s.setupCodeBlock}>{block.replace(/^(yaml|groovy|json)\n/, '')}</pre>
          )}
        </div>
        <div className={s.setupFooter}>
          <button onClick={onClose} className="btn-ghost">{t('close')}</button>
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
      <div className={s.headersTitle}>{t('integrations.customHeaders')}</div>
      <div className={s.headersColumn}>
        {entries.map(([k, v], i) => (
          <div key={i} className={s.headerRow}>
            <input value={k} onChange={e => updateKey(k, e.target.value)} placeholder={t('integrations.headerKey')}
              className={`kt-input ${s.inputStyle} ${s.headerKeyInput}`} />
            <input value={v} onChange={e => updateValue(k, e.target.value)} placeholder={t('integrations.headerValue')}
              className={`kt-input ${s.inputStyle} ${s.headerValueInput}`} />
            <button onClick={() => removeHeader(k)}
              className={s.removeHeaderBtn}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={addHeader}
        className="btn-ghost" style={{ fontSize: 12, marginTop: 6, padding: '4px 10px' }}>
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
    email_to: '', email_subject_prefix: '[Shard]',
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
    <div className={s.overlayDarker}>
      <div className={s.modalPanelForm}>
        <div className={s.modalHeaderLarge}>
          <h2 className={s.modalTitle}>{initial ? t('integrations.editDialog') : t('integrations.newDialog')}</h2>
          {form.template_id && (
            <button onClick={() => setShowSetup(form.template_id)}
              className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <BookOpen size={12} /> {t('integrations.viewSetup')}
            </button>
          )}
        </div>
        <div className={s.formColumn}>
          {/* Name */}
          <label className={s.labelStyle}>{t('name')}
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder={t('integrations.namePlaceholder')} className={`kt-input ${s.inputStyle}`} />
          </label>

          {/* Type */}
          <label className={s.labelStyle}>{t('type')}
            <select value={form.type} onChange={e => set('type', e.target.value)} className={`kt-input ${s.selectStyle}`}>
              {Object.entries(typeLabels).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </label>

          {form.type === 'email' ? (
            <>
              <label className={s.labelStyle}>{t('integrations.recipients')}
                <input value={form.email_to} onChange={e => set('email_to', e.target.value)} placeholder={t('integrations.recipientsPlaceholder')} className={`kt-input ${s.inputStyle}`} />
              </label>
              <label className={s.labelStyle}>{t('integrations.subjectPrefix')}
                <input value={form.email_subject_prefix} onChange={e => set('email_subject_prefix', e.target.value)} placeholder="[Shard]" className={`kt-input ${s.inputStyle}`} />
              </label>
            </>
          ) : (
            <>
              {/* URL */}
              <label className={s.labelStyle}>{t('integrations.webhookUrl')}
                <input value={form.url} onChange={e => set('url', e.target.value)} placeholder={t('integrations.webhookUrlPlaceholder')} className={`kt-input ${s.inputStyle}`} />
              </label>

              {/* Auth Type */}
              <label className={s.labelStyle}>{t('integrations.authType')}
                <select value={form.auth_type || 'bearer'} onChange={e => set('auth_type', e.target.value)} className={`kt-input ${s.selectStyle}`}>
                  <option value="bearer">{t('integrations.authBearer')}</option>
                  <option value="basic">{t('integrations.authBasic')}</option>
                  <option value="api_key">{t('integrations.authApiKey')}</option>
                  <option value="none">{t('integrations.authNone')}</option>
                </select>
              </label>

              {/* Auth config based on type */}
              {form.auth_type === 'bearer' && (
                <label className={s.labelStyle}>
                  {form.type === 'webhook' ? t('integrations.signingSecret') : t('integrations.bearerToken')}
                  <input value={form.secret} onChange={e => set('secret', e.target.value)}
                    placeholder={form.type === 'webhook' ? t('integrations.signingSecretPlaceholder') : 'token...'} className={`kt-input ${s.inputStyle}`} />
                </label>
              )}
              {form.auth_type === 'basic' && (
                <>
                  <label className={s.labelStyle}>{t('integrations.basicUsername')}
                    <input value={form.auth_config?.username || ''} onChange={e => set('auth_config', { ...form.auth_config, username: e.target.value })} className={`kt-input ${s.inputStyle}`} />
                  </label>
                  <label className={s.labelStyle}>{t('integrations.basicPassword')}
                    <input type="password" value={form.auth_config?.password || ''} onChange={e => set('auth_config', { ...form.auth_config, password: e.target.value })} className={`kt-input ${s.inputStyle}`} />
                  </label>
                </>
              )}
              {form.auth_type === 'api_key' && (
                <>
                  <label className={s.labelStyle}>{t('integrations.apiKeyHeader')}
                    <input value={form.auth_config?.header_name || 'X-API-Key'} onChange={e => set('auth_config', { ...form.auth_config, header_name: e.target.value })} className={`kt-input ${s.inputStyle}`} />
                  </label>
                  <label className={s.labelStyle}>{t('integrations.apiKeyValue')}
                    <input value={form.auth_config?.header_value || ''} onChange={e => set('auth_config', { ...form.auth_config, header_value: e.target.value })} className={`kt-input ${s.inputStyle}`} />
                  </label>
                </>
              )}

              {form.type === 'webhook' && (
                <div className={s.hmacInfo}>
                  {t('integrations.hmacInfo')}
                </div>
              )}

              {/* Custom Headers */}
              <CustomHeadersEditor headers={form.custom_headers || {}} onChange={h => set('custom_headers', h)} />
            </>
          )}

          {/* Project ID */}
          <label className={s.labelStyle}>{t('integrations.projectIdLabel')}
            <input value={form.project_id} onChange={e => set('project_id', e.target.value)} placeholder={t('integrations.projectIdPlaceholder')} className={`kt-input ${s.inputStyle}`} />
          </label>

          {/* Events */}
          <div className={s.labelStyle}>{t('integrations.events')}
            {/* Quick presets */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, marginTop: 4 }}>
              <button type="button" onClick={() => set('events', [...ALL_EVENTS])}
                style={{ fontSize: 10, padding: '3px 10px', borderRadius: 9999, border: '1px solid rgba(var(--kt-ink-rgb), 0.12)', background: form.events.length === ALL_EVENTS.length ? 'rgba(250,204,21,0.15)' : 'rgba(var(--kt-ink-rgb), 0.04)', color: form.events.length === ALL_EVENTS.length ? BRAND : DARK.textMid, cursor: 'pointer', fontWeight: 600 }}>
                {t('integrations.allEvents')}
              </button>
              <button type="button" onClick={() => set('events', [...CRITICAL_EVENTS])}
                style={{ fontSize: 10, padding: '3px 10px', borderRadius: 9999, border: '1px solid rgba(var(--kt-ink-rgb), 0.12)', background: JSON.stringify([...form.events].sort()) === JSON.stringify([...CRITICAL_EVENTS].sort()) ? 'rgba(250,204,21,0.15)' : 'rgba(var(--kt-ink-rgb), 0.04)', color: JSON.stringify([...form.events].sort()) === JSON.stringify([...CRITICAL_EVENTS].sort()) ? '#facc15' : DARK.textMid, cursor: 'pointer', fontWeight: 600 }}>
                {t('integrations.criticalOnly')}
              </button>
              <button type="button" onClick={() => set('events', [])}
                style={{ fontSize: 10, padding: '3px 10px', borderRadius: 9999, border: '1px solid rgba(var(--kt-ink-rgb), 0.08)', background: 'rgba(var(--kt-ink-rgb), 0.04)', color: DARK.textDim, cursor: 'pointer', fontWeight: 600 }}>
                {t('integrations.clearAll')}
              </button>
            </div>
            {/* Grouped events */}
            {Object.entries(EVENT_GROUPS).map(([group, events]) => (
              <div key={group} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(var(--kt-ink-rgb), 0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  {t(`integrations.eventGroup.${group}`)}
                </div>
                <div className={s.eventsGrid}>
                  {events.map(ev => (
                    <label key={ev} className={form.events.includes(ev) ? s.eventChipActive : s.eventChipInactive}>
                      <input type="checkbox" checked={form.events.includes(ev)} onChange={() => toggleEvent(ev)} style={{ cursor: 'pointer' }} />
                      {ev.split('.').pop()}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Active */}
          <label className={s.activeLabel}>
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
            Active
          </label>
        </div>
        <div className={s.formActions}>
          <button onClick={() => onSave(form)} disabled={!form.name || (form.type !== 'email' && !form.url) || (form.type === 'email' && !form.email_to)}
            className="btn-primary">{t('save')}</button>
          <button onClick={onClose} className="btn-ghost">{t('cancel')}</button>
        </div>
      </div>
      {showSetup && <SetupModal templateId={showSetup} onClose={() => setShowSetup(null)} />}
    </div>
  )
}

/* ── Main Page ── */
export default function Integrations() {
  const { t } = useTranslation()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
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

  const createMut = useMutation({ mutationFn: createIntegration, onSuccess: (data) => { invalidate(); setModal(null); _checkSmtpWarning(data); globalAddToast(t('integrations.createdSuccess'), 'success') } })
  const updateMut = useMutation({ mutationFn: ({ id, data }) => updateIntegration(id, data), onSuccess: (data) => { invalidate(); setModal(null); _checkSmtpWarning(data); globalAddToast(t('integrations.updatedSuccess'), 'success') } })
  const deleteMut = useMutation({ mutationFn: deleteIntegration, onSuccess: () => { invalidate(); globalAddToast(t('integrations.deletedSuccess'), 'success') } })
  const testMut = useMutation({ mutationFn: testIntegration, onSuccess: (data, id) => setTestResults(r => ({ ...r, [id]: data })) })

  const handleSave = (form) => {
    const data = {
      ...form,
      project_id: form.project_id || null,
      secret: form.secret || null,
      email_to: form.email_to || null,
      email_subject_prefix: form.email_subject_prefix || '[Shard]',
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
        email_to: '', email_subject_prefix: '[Shard]',
        auth_type: tmpl.auth_type || 'bearer', auth_config: {}, custom_headers: {},
        template_id: tmpl.id,
      },
    })
  }

  if (isLoading) return <p className="kt-muted" style={{ padding: 24 }}>{t('loading')}</p>

  return (
    <div className={`kt-page ${isMobile ? s.pageContentMobile : s.pageContent}`}>
      {modal && <IntegrationModal initial={modal.data} onSave={handleSave} onClose={() => setModal(null)} />}
      {templatePicker && <TemplatePicker onSelect={handleTemplateSelect} onClose={() => setTemplatePicker(false)} />}
      {setupModal && <SetupModal templateId={setupModal} onClose={() => setSetupModal(null)} />}

      <div className={`kt-page-header ${isMobile ? s.pageHeaderMobile : s.pageHeader}`}>
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('integrations.title')}</h1>
          <p className="kt-page-subtitle">{t('integrations.subtitle')}</p>
        </div>
        <div className={s.headerButtons}>
          <button onClick={() => setTemplatePicker(true)}
            className={`kt-btn ${s.flexCenter}`}>
            <BookOpen size={14} /> {t('integrations.fromTemplate')}
          </button>
          <button onClick={() => setModal({ mode: 'create' })} className="kt-btn kt-btn-primary">
            {t('integrations.new')}
          </button>
        </div>
      </div>

      {integrations.length === 0 ? (
        <div className={`kt-empty ${s.emptyState}`}>
          <Zap size={36} className="kt-empty-icon" />
          <p className="kt-empty-title">{t('integrations.empty')}</p>
          <p style={{ marginTop: 6, fontSize: 13 }}>{t('integrations.emptyHint')}</p>
          <div className={s.emptyActions}>
            <button onClick={() => setTemplatePicker(true)}
              className={`kt-btn ${s.inlineFlex}`}>
              <BookOpen size={14} /> {t('integrations.fromTemplate')}
            </button>
            <button onClick={() => setModal({ mode: 'create' })}
              className={`kt-btn kt-btn-primary ${s.inlineFlex}`}>
              {t('integrations.new')}
            </button>
          </div>
        </div>
      ) : (
        <div className={`kt-stack ${s.cardList}`}>
          {integrations.map((intg, intgIdx) => (
            <div key={intg.id} className={`kt-card ${s.card}`}
              style={{ animationDelay: `${intgIdx * 0.06}s` }}>
              <div className={isMobile ? s.cardBodyMobile : s.cardBody}>
                <div>
                  <div className={s.cardTitleRow}>
                    <span className={s.cardTypeIcon}>{TYPE_ICONS[intg.type] || '🔗'}</span>
                    <span className={s.cardName}>{intg.name}</span>
                    <span className={intg.active ? s.badgeActive : s.badgeInactive}>{intg.active ? 'active' : 'inactive'}</span>
                    <span className={s.badgeType}>{intg.type}</span>
                    {intg.auth_type && intg.auth_type !== 'bearer' && (
                      <span className={s.badgeAuth}>{intg.auth_type}</span>
                    )}
                  </div>
                  {intg.type === 'email'
                    ? <p className={s.cardUrl}>To: {intg.email_to}</p>
                    : <p className={s.cardUrlMono}>{intg.url}</p>
                  }
                  {intg.project_id && <p className={s.cardProjectId}>Project: {intg.project_id}</p>}
                  <div className={s.eventTags}>
                    {intg.events.map(ev => (
                      <span key={ev} className={s.eventTag}>{ev}</span>
                    ))}
                  </div>
                  {/* Health stats */}
                  {intg.type !== 'email' && <HealthStats integrationId={intg.id} />}
                </div>
                <div className={s.cardActions}>
                  {intg.template_id && (
                    <button onClick={() => setSetupModal(intg.template_id)}
                      className={s.setupBtn}>
                      <BookOpen size={12} /> {t('integrations.viewSetup')}
                    </button>
                  )}
                  <button onClick={() => testMut.mutate(intg.id)}
                    className={s.testBtn}>
                    {testMut.isPending ? t('testing') : t('test')}
                  </button>
                  <button onClick={() => setModal({ mode: 'edit', data: {
                    ...intg, secret: intg.secret || '', project_id: intg.project_id || '',
                    email_to: intg.email_to || '', email_subject_prefix: intg.email_subject_prefix || '[Shard]',
                    auth_type: intg.auth_type || 'bearer', auth_config: intg.auth_config || {},
                    custom_headers: intg.custom_headers || {},
                  }})}
                    className={s.editBtn}>{t('edit')}</button>
                  <button onClick={() => deleteMut.mutate(intg.id)}
                    className={s.deleteBtn}>{t('delete')}</button>
                </div>
              </div>
              {testResults[intg.id] && (
                <div className={testResults[intg.id].success ? s.testResultSuccess : s.testResultFailed}>
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
