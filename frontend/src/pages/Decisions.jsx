import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { GitFork, Plus, Trash2, Edit2, X, Download, Check, XCircle, Bot, User } from 'lucide-react'
import { getDecisions, getProjects, createLabel, updateLabel, deleteLabel, exportDecision } from '../api/client'
import MarkdownEditor from '../components/MarkdownEditor'
import MarkdownPreview from '../components/MarkdownPreview'
import { BRAND, DARK } from '../constants/theme'
import { deriveDecisionRoom, groupDecisionsByProject } from '../utils/decisionRoom'
import useBreakpoint from '../hooks/useBreakpoint'
import useFocusTrap from '../hooks/useFocusTrap'

const STATUS_COLORS = {
  proposed: { bg: 'rgba(250,204,21,0.15)', color: BRAND, border: `1px dashed ${BRAND}` },
  accepted: { bg: 'rgba(250,204,21,0.12)', color: BRAND, border: `1px solid ${BRAND}` },
  deprecated: { bg: 'rgba(148,163,184,0.12)', color: '#94a3b8', border: '1px solid #94a3b8' },
  superseded: { bg: 'rgba(250,204,21,0.12)', color: BRAND, border: `1px solid ${BRAND}` },
}

const TEMPLATE_DESC = `## Context\n\n\n## Decision\n\n\n## Consequences\n`

const DECISION_SNIPPETS = [
  { key: 'context', text: '## Context\n\n' },
  { key: 'decision', text: '## Decision\n\n' },
  { key: 'consequences', text: '## Consequences\n\n' },
  { key: 'tradeoffs', text: '## Tradeoffs\n\n- \n' },
  { key: 'followups', text: '## Follow-ups\n\n- [ ] \n' },
]

function DecisionForm({ projects, initial, onSave, onClose }) {
  const { t } = useTranslation()
  const trapRef = useFocusTrap(onClose)
  const [form, setForm] = useState(initial ? {
    name: initial.name,
    description: initial.description || '',
    project_id: initial.project_id,
    color: initial.color || BRAND,
  } : {
    name: '',
    description: TEMPLATE_DESC,
    project_id: projects[0]?.id || '',
    color: BRAND,
  })

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const insertSnippet = (text) => {
    setForm(f => ({
      ...f,
      description: `${f.description || ''}${f.description?.endsWith('\n') ? '' : '\n\n'}${text}`,
    }))
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={initial ? t('decisions.editTitle') : t('decisions.createTitle')} className="kt-modal-backdrop">
      <div ref={trapRef} className="kt-modal kt-modal-wide">
        <div className="kt-modal-header">
          <span className="kt-modal-title">
            {initial ? t('decisions.editTitle') : t('decisions.createTitle')}
          </span>
          <button onClick={onClose} className="kt-icon-btn">
            <X size={16} />
          </button>
        </div>

        <div className="kt-form-stack">
          <div>
            <div className="kt-field-label">{t('decisions.projectLabel')} *</div>
            <select value={form.project_id} onChange={e => set('project_id', e.target.value)} className="kt-input">
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="kt-field-label">{t('decisions.nameLabel')} *</div>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder={t('decisions.namePlaceholder')} className="kt-input" />
          </div>

          <div>
            <div className="kt-field-label">{t('decisions.descriptionLabel')}</div>
            <div className="kt-decision-editor-tools">
              {DECISION_SNIPPETS.map(snippet => (
                <button key={snippet.key} type="button" onClick={() => insertSnippet(snippet.text)}>
                  {t(`decisions.snippet.${snippet.key}`)}
                </button>
              ))}
            </div>
            <MarkdownEditor
              value={form.description}
              onChange={val => set('description', val)}
              placeholder={t('decisions.contextPlaceholder')}
              minHeight={260}
            />
          </div>
        </div>

        <div className="kt-toolbar" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} className="kt-btn">{t('cancel')}</button>
          <button
            onClick={() => form.name.trim() && form.project_id && onSave(form)}
            className="kt-btn kt-btn-primary"
            disabled={!form.name.trim() || !form.project_id}
          >
            {initial ? t('save') : t('create')}
          </button>
        </div>
      </div>
    </div>
  )
}

function DecisionCard({ decision, projectName, onAccept, onReject, onEdit, onDelete, onExport, isMobile }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const statusStyle = STATUS_COLORS[decision.decision_status] || STATUS_COLORS.proposed

  return (
    <div className={`kt-card kt-decision-card is-${decision.decision_status || 'proposed'}`} style={{
      borderStyle: decision.decision_status === 'proposed' ? 'dashed' : 'solid',
      borderColor: decision.decision_status === 'proposed' ? BRAND : undefined,
      ...(decision.decision_status === 'proposed' ? { boxShadow: '0 1px 2px rgba(0,0,0,0.3)' } : {}),
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <GitFork size={14} style={{ color: statusStyle.color, marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setExpanded(v => !v)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="kt-card-title" style={{
              ...(decision.decision_status === 'deprecated' || decision.decision_status === 'superseded'
                ? { textDecoration: 'line-through', opacity: 0.6 } : {}),
            }}>
              {decision.name}
            </span>
            <span className="kt-badge" style={{ background: statusStyle.bg, color: statusStyle.color }}>
              {t(`decisions.${decision.decision_status || 'proposed'}`)}
            </span>
            {decision.source && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 10, color: '#6b7280',
              }}>
                {decision.source === 'ai' ? <Bot size={10} /> : <User size={10} />}
                {t(`decisions.source.${decision.source}`)}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
            {projectName}
            {decision.description && !expanded && (
              <span style={{ marginLeft: 8, color: '#4b5563' }}>
                {decision.description.slice(0, 80)}{decision.description.length > 80 ? '...' : ''}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap', ...(isMobile ? { marginTop: 8 } : {}) }}>
          {decision.decision_status === 'proposed' && (
            <>
              <button onClick={() => onAccept(decision)} className="kt-btn kt-btn-accept" style={{ padding: '4px 10px' }}>
                <Check size={11} /> {t('decisions.accept')}
              </button>
              <button onClick={() => onReject(decision)} className="kt-btn kt-btn-danger" style={{ padding: '4px 10px' }}>
                <XCircle size={11} /> {t('decisions.reject')}
              </button>
            </>
          )}
          <button onClick={() => onExport(decision)} className="kt-icon-btn" title={t('decisions.export')}>
            <Download size={13} />
          </button>
          <button onClick={() => onEdit(decision)} className="kt-icon-btn">
            <Edit2 size={13} />
          </button>
          <button onClick={() => onDelete(decision)} className="kt-icon-btn" style={{ color: DARK.danger }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {expanded && decision.description && (
        <div className="kt-decision-preview">
          <MarkdownPreview content={decision.description} />
        </div>
      )}
    </div>
  )
}

export default function Decisions() {
  const { t } = useTranslation()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [filterProject, setFilterProject] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const { data: decisions = [], isLoading } = useQuery({
    queryKey: ['decisions', filterProject, filterStatus],
    queryFn: () => getDecisions({
      ...(filterProject ? { project_id: filterProject } : {}),
      ...(filterStatus ? { status: filterStatus } : {}),
    }),
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  })

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]))

  const room = deriveDecisionRoom(decisions)
  const pendingCount = room.counts.proposed

  const createDecision = useMutation({
    mutationFn: (form) => createLabel(form.project_id, {
      name: form.name,
      color: form.color || BRAND,
      type: 'decision',
      description: form.description,
      decision_status: 'proposed',
      source: 'manual',
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['decisions'] }); setShowForm(false) },
  })

  const editDecision = useMutation({
    mutationFn: ({ projectId, id, data }) => updateLabel(projectId, id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['decisions'] }); setEditTarget(null) },
  })

  const removeDecision = useMutation({
    mutationFn: ({ projectId, id }) => deleteLabel(projectId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decisions'] }),
  })

  const handleAccept = (d) => {
    editDecision.mutate({ projectId: d.project_id, id: d.id, data: { decision_status: 'accepted' } })
  }

  const handleReject = (d) => {
    if (window.confirm(t('issue.deleteConfirm', { title: d.name }))) {
      removeDecision.mutate({ projectId: d.project_id, id: d.id })
    }
  }

  const handleEdit = (d) => setEditTarget(d)

  const handleDelete = (d) => {
    if (window.confirm(t('issue.deleteConfirm', { title: d.name }))) {
      removeDecision.mutate({ projectId: d.project_id, id: d.id })
    }
  }

  const handleExport = async (d) => {
    try {
      const md = await exportDecision(d.id)
      const blob = new Blob([md], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `decision-${d.name.replace(/\s+/g, '-').toLowerCase()}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  const groupedOutcomes = groupDecisionsByProject(room.outcomes)

  return (
    <div className="kt-page kt-decision-room-page">
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="kt-page-title">{t('decisions.title')}</h1>
            {pendingCount > 0 && (
              <span className="kt-badge kt-badge-accent" style={{ padding: '2px 8px' }}>
                {t('decisions.pendingReview', { count: pendingCount })}
              </span>
            )}
          </div>
          <div className="kt-page-subtitle">
            {t('decisions.subtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowForm(true)} className="kt-btn kt-btn-primary">
            <Plus size={13} /> {t('decisions.new')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#4b5563', fontSize: 13 }}>{t('loading')}</div>
      ) : decisions.length === 0 ? (
        <div className="kt-empty">
          <GitFork size={36} className="kt-empty-icon" />
          <div className="kt-empty-title">{t('decisions.empty')}</div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>{t('decisions.emptyHint')}</div>
          <button onClick={() => setShowForm(true)} className="kt-btn kt-btn-primary">
            {t('decisions.new')}
          </button>
        </div>
      ) : (
        <div className={isMobile ? 'kt-decision-room is-mobile' : 'kt-decision-room'}>
          <aside className="kt-decision-console">
            <div className="kt-decision-console-title">
              <GitFork size={13} />
              {t('decisions.room')}
            </div>

            <div className="kt-decision-scoreboard">
              <div><span>{room.counts.proposed}</span><b>{t('decisions.proposed')}</b></div>
              <div><span>{room.counts.accepted}</span><b>{t('decisions.accepted')}</b></div>
              <div><span>{room.counts.superseded + room.counts.deprecated}</span><b>{t('decisions.archived')}</b></div>
            </div>

            <div className="kt-decision-filter-stack">
              <select value={filterProject} onChange={e => setFilterProject(e.target.value)} className="kt-input">
                <option value="">{t('decisions.allProjects')}</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="kt-input">
                <option value="">{t('decisions.allStatuses')}</option>
                <option value="proposed">{t('decisions.proposed')}</option>
                <option value="accepted">{t('decisions.accepted')}</option>
                <option value="deprecated">{t('decisions.deprecated')}</option>
                <option value="superseded">{t('decisions.superseded')}</option>
              </select>
            </div>
          </aside>

          <section className="kt-decision-queue">
            <div className="kt-decision-section-head">
              <span>{t('decisions.pendingQueue')}</span>
              <b>{room.queue.length}</b>
            </div>
            {room.queue.length === 0 ? (
              <div className="kt-empty kt-decision-empty">{t('decisions.noPendingQueue')}</div>
            ) : (
              <div className="kt-decision-stack">
                {room.queue.map((d, i) => (
                  <div key={d.id} style={{ animation: 'fadeUpIn 0.35s ease forwards', animationDelay: `${i * 0.06}s`, opacity: 0 }}>
                    <DecisionCard
                      decision={d}
                      projectName={projectMap[d.project_id] || ''}
                      onAccept={handleAccept}
                      onReject={handleReject}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onExport={handleExport}
                      isMobile={isMobile}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="kt-decision-outcomes">
            <div className="kt-decision-section-head">
              <span>{t('decisions.outcomes')}</span>
              <b>{room.outcomes.length}</b>
            </div>
            {room.outcomes.length === 0 ? (
              <div className="kt-empty kt-decision-empty">{t('decisions.noOutcomes')}</div>
            ) : (
              <div className="kt-decision-project-groups">
                {Object.entries(groupedOutcomes).map(([projectId, items]) => (
                  <div key={projectId} className="kt-decision-project-group">
                    <div className="kt-decision-project-label">
                      {projectMap[projectId] || 'Unknown Project'}
                    </div>
                    <div className="kt-decision-stack">
                      {items.map((d, i) => (
                        <div key={d.id} style={{ animation: 'fadeUpIn 0.35s ease forwards', animationDelay: `${i * 0.04}s`, opacity: 0 }}>
                          <DecisionCard
                            decision={d}
                            projectName={projectMap[d.project_id] || ''}
                            onAccept={handleAccept}
                            onReject={handleReject}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onExport={handleExport}
                            isMobile={isMobile}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {(showForm || editTarget) && (
        <DecisionForm
          projects={projects}
          initial={editTarget}
          onSave={(form) => {
            if (editTarget) {
              editDecision.mutate({
                projectId: editTarget.project_id,
                id: editTarget.id,
                data: { name: form.name, description: form.description, color: form.color },
              })
            } else {
              createDecision.mutate(form)
            }
          }}
          onClose={() => { setShowForm(false); setEditTarget(null) }}
        />
      )}
    </div>
  )
}
