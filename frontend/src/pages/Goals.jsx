import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Target, Plus, Trash2, Edit2, X, Calendar, Link2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { getGoals, createGoal, updateGoal, deleteGoal, getProjects } from '../api/client'
import { useToast } from '../context/ToastContext'
import { BRAND, DARK, INSET_SHADOW } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'
import useFocusTrap from '../hooks/useFocusTrap'

const STATUS_COLORS = {
  active:    { bg: 'rgba(83,157,245,0.12)', color: DARK.info },
  completed: { bg: 'rgba(30,215,96,0.12)', color: DARK.success },
  cancelled: { bg: 'rgba(243,114,127,0.12)', color: DARK.danger },
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
    ? { background: 'rgba(243,114,127,0.12)', color: DARK.danger, border: '1px solid rgba(243,114,127,0.2)' }
    : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: DARK.textMid }),
})

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
    <div role="dialog" aria-modal="true" aria-label={initial ? t('goals.editTitle') : t('goals.createTitle')} style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
    }}>
      <div ref={trapRef} style={{
        background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
        padding: 24, width: 520, maxWidth: '95vw', maxHeight: '85vh', overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>
            {initial ? t('goals.editTitle') : t('goals.createTitle')}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Title */}
          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>{t('goals.titleLabel')} *</div>
            <input
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder={t('goals.titlePlaceholder')}
              style={inp}
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>{t('goals.descriptionLabel')}</div>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder={t('goals.descriptionPlaceholder')}
              rows={3}
              style={{ ...inp, resize: 'vertical' }}
            />
          </div>

          {/* Target Date */}
          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>{t('goals.targetDate')}</div>
            <input
              type="date"
              value={form.target_date}
              onChange={e => set('target_date', e.target.value)}
              style={{ ...inp, colorScheme: 'dark' }}
            />
          </div>

          {/* Projects multi-select */}
          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>{t('goals.linkProjects')}</div>
            <div style={{
              maxHeight: 180, overflow: 'auto', borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.08)', padding: 4,
            }}>
              {projects.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: '#4b5563', textAlign: 'center' }}>
                  {t('goals.noProjects')}
                </div>
              ) : projects.map(p => (
                <label key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                  borderRadius: 4, cursor: 'pointer',
                  background: form.project_ids.includes(p.id) ? 'rgba(83,157,245,0.08)' : 'transparent',
                }}>
                  <input
                    type="checkbox"
                    checked={form.project_ids.includes(p.id)}
                    onChange={() => toggleProject(p.id)}
                    style={{ cursor: 'pointer', accentColor: DARK.info }}
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

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={btn()}>{t('cancel')}</button>
          <button
            onClick={handleSubmit}
            style={btn('primary')}
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
      style={{
        background: DARK.elevated,
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        padding: 16,
        position: 'relative',
        transition: 'border-color 0.15s ease',
        ...(hovered ? { borderColor: 'rgba(255,255,255,0.16)' } : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Target size={14} style={{ color: statusStyle.color, marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: DARK.text }}>
              {goal.title}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 9999,
              background: statusStyle.bg, color: statusStyle.color,
              textTransform: 'capitalize',
            }}>
              {t(`goals.status.${goal.status}`)}
            </span>
          </div>

          {/* Description (truncated) */}
          {goal.description && (
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, lineHeight: 1.4 }}>
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
            <div style={{
              height: 4, borderRadius: 9999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 9999,
                width: `${Math.min(progress, 100)}%`,
                background: progress >= 100
                  ? DARK.success
                  : progress >= 50
                  ? DARK.info
                  : DARK.warning,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>

          {/* Linked projects chips */}
          {goal.projects && goal.projects.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {goal.projects.map(p => (
                <span key={p.project_id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 9999, fontSize: 10,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                  color: DARK.textMid,
                }}>
                  <Link2 size={9} />
                  <span>{p.project_name}</span>
                  <span style={{
                    fontWeight: 700,
                    color: p.progress >= 100 ? DARK.success : p.progress >= 50 ? DARK.info : DARK.warning,
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
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4 }}
            title={t('edit')}
          >
            <Edit2 size={13} />
          </button>
          <button
            onClick={() => onDelete(goal)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.danger, padding: 4 }}
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
    <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
      {tabs.map(tab => {
        const isActive = active === tab.key
        const count = tab.key === '' ? counts.all : counts[tab.key] || 0
        const Icon = tab.icon
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 9999,
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: isActive ? '1px solid rgba(255,255,255,0.15)' : '1px solid transparent',
              background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
              color: isActive ? DARK.text : DARK.textMid,
              transition: 'all 0.15s ease',
            }}
          >
            {Icon && <Icon size={11} />}
            <span>{tab.label}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '0 5px', borderRadius: 9999,
              background: isActive ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
              color: isActive ? DARK.text : '#4b5563',
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
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
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
    <div style={{ padding: isMobile ? '20px 16px' : 28, maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', marginBottom: 24, flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, margin: 0, color: DARK.text }}>{t('goals.title')}</h1>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            {t('goals.subtitle')}
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          style={{ ...btn('primary'), display: 'flex', alignItems: 'center', gap: 6 }}
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
        <div style={{
          textAlign: 'center', padding: 64, color: '#4b5563',
          border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 12,
          animation: 'fadeIn 0.4s ease',
        }}>
          <Target size={36} style={{ marginBottom: 14, opacity: 0.3, display: 'block', margin: '0 auto 14px', color: DARK.info }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: DARK.text, marginBottom: 6 }}>
            {statusFilter ? t('goals.emptyFiltered') : t('goals.empty')}
          </div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>{t('goals.emptyHint')}</div>
          {!statusFilter && (
            <button onClick={() => setShowForm(true)} style={btn('primary')}>
              {t('goals.create')}
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
