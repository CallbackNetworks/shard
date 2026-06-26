import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { GitFork, Plus, Trash2, Edit2, X, Download, Check, XCircle, Bot, User } from 'lucide-react'
import { getDecisions, getProjects, createLabel, updateLabel, deleteLabel, exportDecision } from '../api/client'
import { DARK } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'
import useFocusTrap from '../hooks/useFocusTrap'

const STATUS_COLORS = {
  proposed: { bg: 'rgba(59,130,246,0.15)', color: '#3b82f6', border: '1px dashed #3b82f6' },
  accepted: { bg: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid #10b981' },
  deprecated: { bg: 'rgba(148,163,184,0.12)', color: '#94a3b8', border: '1px solid #94a3b8' },
  superseded: { bg: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid #ef4444' },
}

const inp = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 12,
  color: DARK.text,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

const btn = (variant = 'default') => ({
  border: 'none',
  borderRadius: 9999,
  padding: '6px 14px',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 700,
  ...(variant === 'primary'
    ? { background: DARK.success, color: '#000' }
    : variant === 'danger'
    ? { background: 'rgba(239,68,68,0.12)', color: DARK.danger, border: '1px solid rgba(239,68,68,0.2)' }
    : variant === 'accept'
    ? { background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }
    : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: DARK.textMid }),
})

const TEMPLATE_DESC = `## Context\n\n\n## Decision\n\n\n## Consequences\n`

function DecisionForm({ projects, initial, onSave, onClose }) {
  const { t } = useTranslation()
  const trapRef = useFocusTrap(onClose)
  const [form, setForm] = useState(initial ? {
    name: initial.name,
    description: initial.description || '',
    project_id: initial.project_id,
    color: initial.color || '#ef4444',
  } : {
    name: '',
    description: TEMPLATE_DESC,
    project_id: projects[0]?.id || '',
    color: '#ef4444',
  })

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  return (
    <div role="dialog" aria-modal="true" aria-label={initial ? t('decisions.editTitle') : t('decisions.createTitle')} style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
    }}>
      <div ref={trapRef} style={{
        background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
        padding: 24, width: 560, maxWidth: '95vw', maxHeight: '85vh', overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>
            {initial ? t('decisions.editTitle') : t('decisions.createTitle')}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>{t('decisions.projectLabel')} *</div>
            <select value={form.project_id} onChange={e => set('project_id', e.target.value)} style={inp}>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>{t('decisions.nameLabel')} *</div>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder={t('decisions.namePlaceholder')} style={inp} />
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>{t('decisions.descriptionLabel')}</div>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder={t('decisions.contextPlaceholder')}
              rows={12}
              style={{ ...inp, resize: 'vertical', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.5 }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={btn()}>{t('cancel')}</button>
          <button
            onClick={() => form.name.trim() && form.project_id && onSave(form)}
            style={btn('primary')}
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
    <div style={{
      background: '#111111',
      border: decision.decision_status === 'proposed' ? '1px dashed rgba(59,130,246,0.4)' : '1px solid rgba(255,255,255,0.08)',
      borderRadius: 10, padding: 16,
      ...(decision.decision_status === 'proposed' ? { boxShadow: '0 1px 2px rgba(0,0,0,0.3)' } : {}),
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <GitFork size={14} style={{ color: statusStyle.color, marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setExpanded(v => !v)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontWeight: 600, fontSize: 13,
              ...(decision.decision_status === 'deprecated' || decision.decision_status === 'superseded'
                ? { textDecoration: 'line-through', opacity: 0.6 } : {}),
            }}>
              {decision.name}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 9999,
              background: statusStyle.bg, color: statusStyle.color,
            }}>
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
              <button onClick={() => onAccept(decision)} style={{ ...btn('accept'), padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Check size={11} /> {t('decisions.accept')}
              </button>
              <button onClick={() => onReject(decision)} style={{ ...btn('danger'), padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
                <XCircle size={11} /> {t('decisions.reject')}
              </button>
            </>
          )}
          <button onClick={() => onExport(decision)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4 }} title={t('decisions.export')}>
            <Download size={13} />
          </button>
          <button onClick={() => onEdit(decision)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4 }}>
            <Edit2 size={13} />
          </button>
          <button onClick={() => onDelete(decision)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.danger, padding: 4 }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {expanded && decision.description && (
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)',
          fontSize: 12, color: '#d1d5db', lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: 'monospace',
        }}>
          {decision.description}
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

  const pendingCount = decisions.filter(d => d.decision_status === 'proposed').length

  const createDecision = useMutation({
    mutationFn: (form) => createLabel(form.project_id, {
      name: form.name,
      color: form.color || '#ef4444',
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

  // Group decisions by project
  const grouped = {}
  decisions.forEach(d => {
    const key = d.project_id || '_none'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(d)
  })

  return (
    <div style={{ padding: isMobile ? '20px 16px' : 28, maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', marginBottom: 24, flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, margin: 0 }}>{t('decisions.title')}</h1>
            {pendingCount > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 9999,
                background: 'rgba(59,130,246,0.2)', color: DARK.info,
              }}>
                {t('decisions.pendingReview', { count: pendingCount })}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            {t('decisions.subtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowForm(true)} style={{ ...btn(), display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> {t('decisions.new')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
          style={{ ...inp, width: 'auto', minWidth: 140 }}>
          <option value="">{t('decisions.allProjects')}</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ ...inp, width: 'auto', minWidth: 120 }}>
          <option value="">{t('decisions.allStatuses')}</option>
          <option value="proposed">{t('decisions.proposed')}</option>
          <option value="accepted">{t('decisions.accepted')}</option>
          <option value="deprecated">{t('decisions.deprecated')}</option>
          <option value="superseded">{t('decisions.superseded')}</option>
        </select>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#4b5563', fontSize: 13 }}>{t('loading')}</div>
      ) : decisions.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 64, color: '#4b5563', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 12,
          animation: 'fadeIn 0.4s ease',
        }}>
          <GitFork size={36} style={{ marginBottom: 14, opacity: 0.3, display: 'block', margin: '0 auto 14px', color: DARK.info }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: DARK.text, marginBottom: 6 }}>{t('decisions.empty')}</div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>{t('decisions.emptyHint')}</div>
          <button onClick={() => setShowForm(true)} style={btn('primary')}>
            {t('decisions.new')}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {Object.entries(grouped).map(([projectId, items]) => (
            <div key={projectId}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>
                {projectMap[projectId] || 'Unknown Project'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((d, i) => (
                  <div key={d.id} style={{
                    animation: 'fadeUpIn 0.35s ease forwards',
                    animationDelay: `${i * 0.06}s`,
                    opacity: 0,
                  }}>
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
