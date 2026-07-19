import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Target, Plus, Trash2, Edit2, X, Calendar, Link2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { getGoals, createGoal, updateGoal, deleteGoal, getProjects } from '../api/client'
import { useToast } from '../context/ToastContext'
import { BRAND, DARK, GOAL_STATUS_COLORS as STATUS_COLORS } from '../constants/theme'
import useFocusTrap from '../hooks/useFocusTrap'

/* ── Goal Form Modal ── */
function GoalForm({ projects, initial, onSave, onClose }) {
  const { t } = useTranslation()
  const trapRef = useFocusTrap(onClose)
  const [form, setForm] = useState(initial ? {
    title: initial.title,
    description: initial.description || '',
    target_date: initial.target_date ? initial.target_date.slice(0, 10) : '',
    project_ids: (initial.projects || []).map(p => p.project_id),
  } : {
    title: '',
    description: '',
    target_date: '',
    project_ids: [],
  })

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const toggleProject = (projectId) => {
    set('project_ids', form.project_ids.includes(projectId)
      ? form.project_ids.filter(id => id !== projectId)
      : [...form.project_ids, projectId]
    )
  }

  const handleSubmit = () => {
    if (!form.title.trim()) return
    onSave({
      title: form.title.trim(),
      description: form.description.trim() || null,
      target_date: form.target_date || null,
      project_ids: form.project_ids,
    })
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={initial ? t('goals.editTitle') : t('goals.createTitle')} className="kt-modal-backdrop">
      <div ref={trapRef} className="kt-modal">
        <div className="kt-modal-header">
          <span className="kt-modal-title">
            {initial ? t('goals.editTitle') : t('goals.createTitle')}
          </span>
          <button onClick={onClose} className="kt-icon-btn">
            <X size={16} />
          </button>
        </div>

        <div className="kt-form-stack">
          {/* Title */}
          <div>
            <div className="kt-field-label">{t('goals.titleLabel')} *</div>
            <input
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder={t('goals.titlePlaceholder')}
              className="kt-input"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <div className="kt-field-label">{t('goals.descriptionLabel')}</div>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder={t('goals.descriptionPlaceholder')}
              rows={3}
              className="kt-input"
              style={{ resize: 'vertical' }}
            />
          </div>

          {/* Target Date */}
          <div>
            <div className="kt-field-label">{t('goals.targetDate')}</div>
            <input
              type="date"
              value={form.target_date}
              onChange={e => set('target_date', e.target.value)}
              className="kt-input"
              style={{ colorScheme: 'dark' }}
            />
          </div>

          {/* Projects multi-select */}
          <div>
            <div className="kt-field-label">{t('goals.linkProjects')}</div>
            <div className="kt-panel" style={{ maxHeight: 180, overflow: 'auto', padding: 4 }}>
              {projects.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: '#4b5563', textAlign: 'center' }}>
                  {t('goals.noProjects')}
                </div>
              ) : projects.map(p => (
                <label key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                  borderRadius: 4, cursor: 'pointer',
                  background: form.project_ids.includes(p.id) ? 'rgba(250,204,21,0.1)' : 'transparent',
                }}>
                  <input
                    type="checkbox"
                    checked={form.project_ids.includes(p.id)}
                    onChange={() => toggleProject(p.id)}
                    style={{ cursor: 'pointer', accentColor: BRAND }}
                  />
                  <span style={{ fontSize: 12, color: form.project_ids.includes(p.id) ? DARK.text : DARK.textMid }}>
                    {p.name}
                  </span>
                  {p.progress != null && (
                    <span style={{ fontSize: 10, color: '#4b5563', marginLeft: 'auto' }}>
                      {Math.round(p.progress)}%
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="kt-toolbar" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} className="kt-btn">{t('cancel')}</button>
          <button
            onClick={handleSubmit}
            className="kt-btn kt-btn-primary"
            disabled={!form.title.trim()}
          >
            {initial ? t('save') : t('create')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Goal Card ── */
function GoalCard({ goal, onEdit, onDelete }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const statusStyle = STATUS_COLORS[goal.status] || STATUS_COLORS.active
  const progress = goal.progress != null ? Math.round(goal.progress) : 0

  const isOverdue = goal.target_date && goal.status === 'active' && new Date(goal.target_date) < new Date()
  const daysLeft = goal.target_date
    ? Math.ceil((new Date(goal.target_date) - new Date()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div
      className="kt-card"
      style={hovered ? { borderColor: BRAND } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Target size={14} style={{ color: statusStyle.color, marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="kt-card-title">
              {goal.title}
            </span>
            <span className="kt-badge" style={{ background: statusStyle.bg, color: statusStyle.color, textTransform: 'capitalize' }}>
              {t(`goals.status.${goal.status}`)}
            </span>
          </div>

          {/* Description (truncated) */}
          {goal.description && (
            <div className="kt-card-description">
              {goal.description.length > 120
                ? goal.description.slice(0, 120) + '...'
                : goal.description}
            </div>
          )}

          {/* Target date */}
          {goal.target_date && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11, marginTop: 6,
              color: isOverdue ? DARK.danger : daysLeft != null && daysLeft <= 7 ? DARK.warning : '#6b7280',
            }}>
              <Calendar size={10} />
              <span>
                {new Date(goal.target_date).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              {goal.status === 'active' && daysLeft != null && (
                <span style={{ marginLeft: 4, fontSize: 10 }}>
                  {isOverdue
                    ? t('goals.overdue', { days: Math.abs(daysLeft) })
                    : t('goals.daysLeft', { days: daysLeft })}
                </span>
              )}
            </div>
          )}

          {/* Progress bar */}
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#6b7280' }}>{t('goals.progress')}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: progress >= 100 ? DARK.success : DARK.textMid }}>
                {progress}%
              </span>
            </div>
            <div className="kt-progress-track" style={{
              height: 4, borderRadius: 0, background: 'rgba(var(--kt-ink-rgb), 0.08)', overflow: 'hidden',
            }}>
              <div className="kt-progress-fill" style={{
                height: '100%', borderRadius: 0,
                width: `${Math.min(progress, 100)}%`,
                background: progress >= 100
                  ? DARK.success
                  : progress >= 50
                  ? BRAND
                  : DARK.warning,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>

          {/* Linked projects chips */}
          {goal.projects && goal.projects.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {goal.projects.map(p => (
                <span key={p.project_id} className="kt-chip" style={{ color: DARK.textMid }}>
                  <Link2 size={9} />
                  <span>{p.project_name}</span>
                  <span style={{
                    fontWeight: 700,
                    color: p.progress >= 100 ? DARK.success : p.progress >= 50 ? BRAND : DARK.warning,
                  }}>
                    {Math.round(p.progress || 0)}%
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Action buttons (visible on hover) */}
        <div style={{
          display: 'flex', gap: 4, flexShrink: 0,
          opacity: hovered ? 1 : 0, transition: 'opacity 0.15s ease',
        }}>
          <button
            onClick={() => onEdit(goal)}
            className="kt-icon-btn"
            title={t('edit')}
          >
            <Edit2 size={13} />
          </button>
          <button
            onClick={() => onDelete(goal)}
            className="kt-icon-btn"
            style={{ color: DARK.danger }}
            title={t('delete')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Status Filter Tabs ── */
function StatusTabs({ active, onChange, counts }) {
  const { t } = useTranslation()
  const tabs = [
    { key: '', label: t('goals.filterAll'), icon: null },
    { key: 'active', label: t('goals.filterActive'), icon: Clock },
    { key: 'completed', label: t('goals.filterCompleted'), icon: CheckCircle2 },
    { key: 'cancelled', label: t('goals.filterCancelled'), icon: XCircle },
  ]

  return (
    <div className="kt-toolbar" style={{ marginBottom: 16 }}>
      {tabs.map(tab => {
        const isActive = active === tab.key
        const count = tab.key === '' ? counts.all : counts[tab.key] || 0
        const Icon = tab.icon
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`kt-btn${isActive ? ' kt-badge-accent' : ''}`}
            style={{
              borderColor: isActive ? BRAND : 'transparent',
              background: isActive ? 'rgba(250,204,21,0.12)' : 'transparent',
              color: isActive ? DARK.text : DARK.textMid,
            }}
          >
            {Icon && <Icon size={11} />}
            <span>{tab.label}</span>
            <span className="kt-badge" style={{
              background: isActive ? 'rgba(250,204,21,0.16)' : 'rgba(var(--kt-ink-rgb), 0.04)',
              color: isActive ? BRAND : '#4b5563',
            }}>
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ── Main Goals Page ── */
export default function Goals() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { addToast } = useToast()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')

  const { data: goals = [], isLoading } = useQuery({
    queryKey: ['goals', statusFilter],
    queryFn: () => getGoals(statusFilter ? { status: statusFilter } : {}),
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  })

  // Compute counts across all goals (unfiltered) for tab badges
  const { data: allGoals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: () => getGoals(),
    staleTime: 30000,
  })

  const counts = {
    all: allGoals.length,
    active: allGoals.filter(g => g.status === 'active').length,
    completed: allGoals.filter(g => g.status === 'completed').length,
    cancelled: allGoals.filter(g => g.status === 'cancelled').length,
  }

  const createMut = useMutation({
    mutationFn: createGoal,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['goals'] }); setShowForm(false); addToast(t('goals.created'), 'success') },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateGoal(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['goals'] }); setEditTarget(null); addToast(t('goals.updated'), 'success') },
  })

  const deleteMut = useMutation({
    mutationFn: deleteGoal,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['goals'] }); addToast(t('goals.deleted'), 'success') },
  })

  const handleSave = (form) => {
    if (editTarget) {
      updateMut.mutate({ id: editTarget.id, data: form })
    } else {
      createMut.mutate(form)
    }
  }

  const handleEdit = (goal) => setEditTarget(goal)

  const handleDelete = (goal) => {
    if (window.confirm(t('goals.deleteConfirm', { title: goal.title }))) {
      deleteMut.mutate(goal.id)
    }
  }

  return (
    <div className="kt-page">
      {/* Header */}
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('goals.title')}</h1>
          <div className="kt-page-subtitle">
            {t('goals.subtitle')}
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="kt-btn kt-btn-primary"
        >
          <Plus size={13} /> {t('goals.create')}
        </button>
      </div>

      {/* Status filter tabs */}
      <StatusTabs active={statusFilter} onChange={setStatusFilter} counts={counts} />

      {/* Content */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#4b5563', fontSize: 13 }}>{t('loading')}</div>
      ) : goals.length === 0 ? (
        <div className="kt-empty">
          <Target size={36} className="kt-empty-icon" />
          <div className="kt-empty-title">
            {statusFilter ? t('goals.emptyFiltered') : t('goals.empty')}
          </div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>{t('goals.emptyHint')}</div>
          {!statusFilter && (
            <button onClick={() => setShowForm(true)} className="kt-btn kt-btn-primary">
              {t('goals.create')}
            </button>
          )}
        </div>
      ) : (
        <div className="kt-stack">
          {goals.map((goal, i) => (
            <div key={goal.id} style={{
              animation: 'fadeUpIn 0.35s ease forwards',
              animationDelay: `${i * 0.06}s`,
              opacity: 0,
            }}>
              <GoalCard
                goal={goal}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      {(showForm || editTarget) && (
        <GoalForm
          projects={projects}
          initial={editTarget}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditTarget(null) }}
        />
      )}
    </div>
  )
}
