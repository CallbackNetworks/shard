import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, X, FileText, ChevronDown, ChevronUp } from 'lucide-react'
import { getTemplates, createTemplate, updateTemplate, deleteTemplate } from '../api/client'
import { useToast } from '../context/ToastContext'
import { BRAND, DARK } from '../constants/theme'
import useFocusTrap from '../hooks/useFocusTrap'

const PRIORITIES = ['low', 'medium', 'high']

const PRIORITY_COLOR = {
  low: '#9ca3af',
  medium: '#facc15',
  high: '#facc15',
}

const EMPTY_FORM = { name: '', description: '', priority: 'medium', subtasks: [], label_names: [] }

function TemplateForm({ initial, onSave, onClose }) {
  const { t } = useTranslation()
  const trapRef = useFocusTrap(onClose)
  const [form, setForm] = useState(initial || EMPTY_FORM)
  const [subtaskInput, setSubtaskInput] = useState('')
  const [labelInput, setLabelInput] = useState('')

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const addSubtask = () => {
    const title = subtaskInput.trim()
    if (!title) return
    set('subtasks', [...form.subtasks, { title, priority: 'medium' }])
    setSubtaskInput('')
  }

  const removeSubtask = (idx) => set('subtasks', form.subtasks.filter((_, i) => i !== idx))

  const addLabel = () => {
    const label = labelInput.trim()
    if (!label || form.label_names.includes(label)) return
    set('label_names', [...form.label_names, label])
    setLabelInput('')
  }

  const removeLabel = (label) => set('label_names', form.label_names.filter(l => l !== label))

  return (
    <div role="dialog" aria-modal="true" aria-label={initial ? t('templates.editDialog') : t('templates.newDialog')} className="kt-modal-backdrop">
      <div ref={trapRef} className="kt-modal">
        <div className="kt-modal-header">
          <span className="kt-modal-title">
            {initial ? t('templates.editDialog') : t('templates.newDialog')}
          </span>
          <button onClick={onClose} className="kt-icon-btn">
            <X size={16} />
          </button>
        </div>

        <div className="kt-form-stack">
          <div>
            <div className="kt-field-label">{t('name')} *</div>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder={t('templates.namePlaceholder')} className="kt-input" />
          </div>

          <div>
            <div className="kt-field-label">{t('description')}</div>
            <textarea
              value={form.description || ''}
              onChange={e => set('description', e.target.value)}
              placeholder={t('templates.descriptionPlaceholder')}
              rows={2}
              className="kt-input"
              style={{ resize: 'vertical' }}
            />
          </div>

          <div>
            <div className="kt-field-label">{t('templates.defaultPriority')}</div>
            <select value={form.priority} onChange={e => set('priority', e.target.value)} className="kt-input">
              {PRIORITIES.map(p => (
                <option key={p} value={p}>{t(p)}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="kt-field-label">{t('templates.subtasks')}</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input
                value={subtaskInput}
                onChange={e => setSubtaskInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSubtask()}
                placeholder={t('templates.addSubtask')}
                className="kt-input"
                style={{ flex: 1 }}
              />
              <button onClick={addSubtask} className="kt-btn">{t('add')}</button>
            </div>
            {form.subtasks.map((s, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
                background: 'rgba(var(--kt-ink-rgb), 0.03)', marginBottom: 4,
              }}>
                <span style={{ flex: 1, fontSize: 12 }}>{s.title}</span>
                <button onClick={() => removeSubtask(i)} className="kt-icon-btn" style={{ color: DARK.danger, padding: 0 }}>
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>

          <div>
            <div className="kt-field-label">{t('templates.labelsNames')}</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input
                value={labelInput}
                onChange={e => setLabelInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addLabel()}
                placeholder={t('templates.addLabel')}
                className="kt-input"
                style={{ flex: 1 }}
              />
              <button onClick={addLabel} className="kt-btn">{t('add')}</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {form.label_names.map(l => (
                <span key={l} style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px',
                  background: 'rgba(250,204,21,0.15)', fontSize: 11, color: BRAND,
                }}>
                  {l}
                  <button onClick={() => removeLabel(l)} className="kt-icon-btn" style={{ color: BRAND, padding: 0, lineHeight: 1 }}>
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="kt-toolbar" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} className="kt-btn">{t('cancel')}</button>
          <button
            onClick={() => form.name.trim() && onSave(form)}
            className="kt-btn kt-btn-primary"
            disabled={!form.name.trim()}
          >
            {initial ? t('templates.saveChanges') : t('templates.createTemplate')}
          </button>
        </div>
      </div>
    </div>
  )
}

function TemplateCard({ tpl, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="kt-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <FileText size={14} style={{ color: BRAND, marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="kt-card-title">{tpl.name}</span>
            <span className="kt-badge" style={{ background: `${PRIORITY_COLOR[tpl.priority]}20`, color: PRIORITY_COLOR[tpl.priority] }}>
              {tpl.priority}
            </span>
          </div>
          {tpl.description && (
            <div className="kt-card-description">{tpl.description}</div>
          )}
          <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: '#4b5563' }}>
            {tpl.subtasks.length > 0 && (
              <button
                onClick={() => setExpanded(v => !v)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 11, padding: 0, display: 'flex', alignItems: 'center', gap: 3 }}
              >
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                {tpl.subtasks.length}
              </button>
            )}
            {tpl.label_names.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {tpl.label_names.map(l => (
                  <span key={l} className="kt-chip">{l}</span>
                ))}
              </div>
            )}
          </div>
          {expanded && tpl.subtasks.length > 0 && (
            <div style={{ marginTop: 8, paddingLeft: 8, borderLeft: '2px solid rgba(var(--kt-ink-rgb), 0.06)' }}>
              {tpl.subtasks.map((s, i) => (
                <div key={i} style={{ fontSize: 11, color: '#9ca3af', padding: '2px 0' }}>• {s.title}</div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => onEdit(tpl)} className="kt-icon-btn">
            <Edit2 size={13} />
          </button>
          <button onClick={() => onDelete(tpl.id)} className="kt-icon-btn" style={{ color: DARK.danger }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Templates() {
  const { t } = useTranslation()
  const { addToast } = useToast()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [search, setSearch] = useState('')

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => getTemplates(),
  })

  const create = useMutation({
    mutationFn: createTemplate,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); setShowForm(false); addToast(t('templates.createdSuccess'), 'success') },
  })

  const edit = useMutation({
    mutationFn: ({ id, data }) => updateTemplate(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); setEditTarget(null); addToast(t('templates.updatedSuccess'), 'success') },
  })

  const remove = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); addToast(t('templates.deletedSuccess'), 'success') },
  })

  const handleDelete = (id) => {
    if (window.confirm(t('issue.deleteConfirm', { title: t('templates.title') }))) remove.mutate(id)
  }

  return (
    <div className="kt-page">
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('templates.title')}</h1>
          <div className="kt-page-subtitle">
            {t('templates.subtitle')}
          </div>
        </div>
        <button onClick={() => setShowForm(true)} className="kt-btn kt-btn-primary">
          <Plus size={13} /> {t('templates.new')}
        </button>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#4b5563', fontSize: 13 }}>{t('loading')}</div>
      ) : templates.length === 0 ? (
        <div className="kt-empty">
          <FileText size={36} className="kt-empty-icon" />
          <div className="kt-empty-title">{t('templates.empty')}</div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>{t('templates.emptyHint')}</div>
          <button onClick={() => setShowForm(true)} className="kt-btn kt-btn-primary">
            {t('templates.new')}
          </button>
        </div>
      ) : (
        <>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('search')}
            style={{
              marginBottom: 14,
              fontSize: 13,
              padding: '7px 12px',
            }}
            className="kt-input"
          />
          {(() => {
            const filtered = templates.filter(tp =>
              !search ||
              tp.name.toLowerCase().includes(search.toLowerCase()) ||
              (tp.description || '').toLowerCase().includes(search.toLowerCase())
            )
            if (filtered.length === 0) {
              return (
                <div style={{ textAlign: 'center', padding: 32, color: '#6b7280', fontSize: 13 }}>
                  {t('noResults')}
                </div>
              )
            }
            return (
              <div className="kt-stack">
                {filtered.map((tpl, i) => (
                  <div key={tpl.id} style={{
                    animation: 'fadeUpIn 0.35s ease forwards',
                    animationDelay: `${i * 0.06}s`,
                    opacity: 0,
                  }}>
                    <TemplateCard
                      tpl={tpl}
                      onEdit={tpl2 => setEditTarget(tpl2)}
                      onDelete={handleDelete}
                    />
                  </div>
                ))}
              </div>
            )
          })()}
        </>
      )}

      {(showForm || editTarget) && (
        <TemplateForm
          initial={editTarget}
          onSave={(data) => {
            if (editTarget) edit.mutate({ id: editTarget.id, data })
            else create.mutate(data)
          }}
          onClose={() => { setShowForm(false); setEditTarget(null) }}
        />
      )}
    </div>
  )
}
