import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { X, Zap, Plus, Trash2, BookOpen } from 'lucide-react'
import {
  getIntegrations, createIntegration, updateIntegration, deleteIntegration,
  testIntegration, getIntegrationTemplates, getIntegrationTemplate, getIntegrationEvents,
  getIntegrationSources,
} from '../api/client'
import { globalAddToast } from '../context/ToastContext'
import { BRAND, DARK } from '../constants/theme'
import FormModal from '../components/shared/FormModal'
import DeliveryLog from '../components/integrations/DeliveryLog'
import HealthStats from '../components/integrations/HealthStats'
import useBreakpoint from '../hooks/useBreakpoint'
import { useInvalidatingMutation } from '../hooks/useCrudMutations'
import EmptyState from '../components/shared/EmptyState'
import s from './Integrations.module.css'

const TYPE_ICONS = {
  jenkins: '⚙️', drone: '🚁', generic: '🔗', email: '📧', webhook: '🪝',
  github: '', gitlab: '🦊', bitbucket: '🪣', circleci: '⭕',
}
const CRITICAL_EVENTS = ['task.done', 'task.failed', 'task.overdue', 'project.complete']
const EVENT_GROUP_ORDER = ['task', 'project', 'other']

// The event list is served by the backend (ADR-0047) rather than kept here, so the
// checkboxes cannot drift from the events the notifier actually delivers. Grouping is
// presentation only: the prefix picks the heading, anything else falls under "other".
function groupEvents(events) {
  const groups = { task: [], project: [], other: [] }
  for (const ev of events) {
    const prefix = ev.split('.')[0]
    groups[prefix in groups ? prefix : 'other'].push(ev)
  }
  return EVENT_GROUP_ORDER.filter(g => groups[g].length).map(g => [g, groups[g]])
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
    <FormModal
      title={`${template.name} - ${t('integrations.templateSetup')}`}
      onClose={onClose}
      wide
      footer={(
        <div className={s.setupFooter}>
          <button onClick={onClose} className="btn-ghost">{t('close')}</button>
        </div>
      )}
    >
      <div className={s.setupBody}>
        {template.setup_instructions?.split('```').map((block, i) =>
          i % 2 === 0
            ? <span key={i}>{block}</span>
            : <pre key={i} className={s.setupCodeBlock}>{block.replace(/^(yaml|groovy|json)\n/, '')}</pre>
        )}
      </div>
    </FormModal>
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
            {/* A withheld value reads back as null (ADR-0063) and has to reach the server as
                null again, because that is what "unchanged" means there. The null lives in
                form state; this only keeps the input controlled while displaying nothing.
                Do not normalise it away on the way in or out — that is how editing the
                header name would silently clear its value. */}
            <input value={v ?? ''} onChange={e => updateValue(k, e.target.value)}
              placeholder={v === null ? t('integrations.headerValueSet') : t('integrations.headerValue')}
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
    events: ['task.done', 'task.failed', 'project.complete'], sources: [], active: true,
    email_to: '', email_subject_prefix: '[Shard]',
    auth_type: 'bearer', auth_config: {}, custom_headers: {}, template_id: null,
  })
  const [showSetup, setShowSetup] = useState(null)
  const { data: allEvents = [] } = useQuery({
    queryKey: ['integration-events'],
    queryFn: getIntegrationEvents,
  })
  const { data: allSources = [] } = useQuery({
    queryKey: ['integration-sources'],
    queryFn: getIntegrationSources,
  })

  const allSelected = allEvents.length > 0 && form.events.length === allEvents.length
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const toggleEvent = (ev) => set('events', form.events.includes(ev) ? form.events.filter(e => e !== ev) : [...form.events, ev])
  // An empty selection means every source, so there is no "all" checkbox to keep in sync.
  const selectedSources = form.sources || []
  const toggleSource = (src) => set('sources', selectedSources.includes(src) ? selectedSources.filter(x => x !== src) : [...selectedSources, src])

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

              {/* Signing is independent of authentication (ADR-0051): a webhook
                  integration signs every payload with `secret` whatever auth_type is,
                  so the field cannot live inside the bearer branch — choosing basic auth
                  used to hide a key that was still in use. */}
              {/* The secret itself is never served back (ADR-0063), so an existing one shows
                  as an empty box. Say so, or it reads as "no secret set". */}
              {form.type === 'webhook' && (
                <label className={s.labelStyle}>{t('integrations.signingSecret')}
                  <input value={form.secret} onChange={e => set('secret', e.target.value)}
                    placeholder={form.secret_set ? t('integrations.secretKeepPlaceholder') : t('integrations.signingSecretPlaceholder')}
                    className={`kt-input ${s.inputStyle}`} />
                  <div className={s.hmacInfo}>{t('integrations.hmacSecretNote')}</div>
                </label>
              )}

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
              {form.auth_type === 'bearer' && form.type !== 'webhook' && (
                <label className={s.labelStyle}>{t('integrations.bearerToken')}
                  <input value={form.secret} onChange={e => set('secret', e.target.value)}
                    placeholder={form.secret_set ? t('integrations.secretKeepPlaceholder') : 'token...'}
                    className={`kt-input ${s.inputStyle}`} />
                </label>
              )}
              {form.auth_type === 'basic' && (
                <>
                  <label className={s.labelStyle}>{t('integrations.basicUsername')}
                    <input value={form.auth_config?.username || ''} onChange={e => set('auth_config', { ...form.auth_config, username: e.target.value })} className={`kt-input ${s.inputStyle}`} />
                  </label>
                  {/* The null that means "set, withheld" has to survive form state untouched
                      and go back as null (ADR-0063); the input only displays around it. */}
                  <label className={s.labelStyle}>{t('integrations.basicPassword')}
                    <input type="password" value={form.auth_config?.password ?? ''}
                      placeholder={form.auth_config?.password === null ? t('integrations.secretKeepPlaceholder') : ''}
                      onChange={e => set('auth_config', { ...form.auth_config, password: e.target.value })} className={`kt-input ${s.inputStyle}`} />
                  </label>
                </>
              )}
              {form.auth_type === 'api_key' && (
                <>
                  <label className={s.labelStyle}>{t('integrations.apiKeyHeader')}
                    <input value={form.auth_config?.header_name || 'X-API-Key'} onChange={e => set('auth_config', { ...form.auth_config, header_name: e.target.value })} className={`kt-input ${s.inputStyle}`} />
                  </label>
                  <label className={s.labelStyle}>{t('integrations.apiKeyValue')}
                    <input value={form.auth_config?.header_value ?? ''}
                      placeholder={form.auth_config?.header_value === null ? t('integrations.secretKeepPlaceholder') : ''}
                      onChange={e => set('auth_config', { ...form.auth_config, header_value: e.target.value })} className={`kt-input ${s.inputStyle}`} />
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
              <button type="button" onClick={() => set('events', [...allEvents])}
                style={{ fontSize: 10, padding: '3px 10px', borderRadius: 9999, border: '1px solid rgba(var(--kt-ink-rgb), 0.12)', background: allSelected ? 'rgba(250,204,21,0.15)' : 'rgba(var(--kt-ink-rgb), 0.04)', color: allSelected ? BRAND : DARK.textMid, cursor: 'pointer', fontWeight: 600 }}>
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
            {groupEvents(allEvents).map(([group, events]) => (
              <div key={group} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(var(--kt-ink-rgb), 0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  {t(`integrations.eventGroup.${group}`)}
                </div>
                <div className={s.eventsGrid}>
                  {events.map(ev => (
                    <label key={ev} className={form.events.includes(ev) ? s.eventChipActive : s.eventChipInactive}>
                      <input type="checkbox" checked={form.events.includes(ev)} onChange={() => toggleEvent(ev)} style={{ cursor: 'pointer' }} />
                      {group === 'other' ? ev : ev.split('.').pop()}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Sources — who caused the change (ADR-0048) */}
          <div className={s.labelStyle}>{t('integrations.sources')}
            <div style={{ fontSize: 10, color: DARK.textDim, marginBottom: 6, marginTop: 2 }}>
              {t('integrations.sourcesHint')}
            </div>
            <div className={s.eventsGrid}>
              {allSources.map(src => (
                <label key={src} className={selectedSources.includes(src) ? s.eventChipActive : s.eventChipInactive}>
                  <input type="checkbox" checked={selectedSources.includes(src)} onChange={() => toggleSource(src)} style={{ cursor: 'pointer' }} />
                  {t(`integrations.source.${src}`)}
                </label>
              ))}
            </div>
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
  const { data: integrations = [], isLoading } = useQuery({ queryKey: ['integrations'], queryFn: getIntegrations })
  const [modal, setModal] = useState(null)
  const [templatePicker, setTemplatePicker] = useState(false)
  const [testResults, setTestResults] = useState({})
  const [setupModal, setSetupModal] = useState(null)

  const _checkSmtpWarning = (data) => {
    if (data?.smtp_warning) globalAddToast(data.smtp_warning, 'warning')
  }

  const createMut = useInvalidatingMutation({
    mutationFn: createIntegration,
    invalidateKeys: [['integrations']],
    successMessage: t('integrations.createdSuccess'),
    onSuccess: (data) => { setModal(null); _checkSmtpWarning(data) },
  })
  const updateMut = useInvalidatingMutation({
    mutationFn: ({ id, data }) => updateIntegration(id, data),
    invalidateKeys: [['integrations']],
    successMessage: t('integrations.updatedSuccess'),
    onSuccess: (data) => { setModal(null); _checkSmtpWarning(data) },
  })
  const deleteMut = useInvalidatingMutation({
    mutationFn: deleteIntegration,
    invalidateKeys: [['integrations']],
    successMessage: t('integrations.deletedSuccess'),
  })
  const testMut = useInvalidatingMutation({
    mutationFn: testIntegration,
    onSuccess: (data, id) => setTestResults(r => ({ ...r, [id]: data })),
  })

  const handleSave = (form) => {
    const data = {
      ...form,
      project_id: form.project_id || null,
      // Empty means "leave the stored secret alone", which is the only thing an empty box
      // can honestly mean once the value is never shown (ADR-0063).
      secret: form.secret || null,
      email_to: form.email_to || null,
      email_subject_prefix: form.email_subject_prefix || '[Shard]',
      custom_headers: form.custom_headers && Object.keys(form.custom_headers).length > 0 ? form.custom_headers : null,
      auth_config: form.auth_config && Object.keys(form.auth_config).length > 0 ? form.auth_config : null,
    }
    // Read-only projection of whether a secret exists (ADR-0063), not a field to write back.
    delete data.secret_set
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
        <EmptyState
          className={s.emptyState}
          icon={<Zap size={36} className="kt-empty-icon" />}
          message={t('integrations.empty')}
          hint={t('integrations.emptyHint')}
          action={(
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
          )}
        />
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
                  {/* `intg.secret` is never present (ADR-0063); `secret_set` rides along in
                      the spread so the field can say whether one exists. */}
                  <button onClick={() => setModal({ mode: 'edit', data: {
                    ...intg, secret: '', project_id: intg.project_id || '',
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
