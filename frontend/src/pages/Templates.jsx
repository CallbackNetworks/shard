import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, X, FileText, ChevronDown, ChevronUp } from 'lucide-react'
import { getTemplates, createTemplate, updateTemplate, deleteTemplate } from '../api/client'

const PRIORITIES = ['low', 'medium', 'high']

const PRIORITY_COLOR = {
  low: '#4ade80',
  medium: '#facc15',
  high: '#f87171',
}

const inp = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 12,
  color: '#ffffff',
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
    ? { background: '#1ed760', color: '#000' }
    : variant === 'danger'
    ? { background: 'rgba(243,114,127,0.12)', color: '#f3727f', border: '1px solid rgba(243,114,127,0.2)' }
    : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#b3b3b3' }),
})

const EMPTY_FORM = { name: '', description: '', priority: 'medium', subtasks: [], label_names: [] }

function TemplateForm({ initial, onSave, onClose }) {
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
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
    }}>
      <div style={{
        background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
        padding: 24, width: 520, maxHeight: '85vh', overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{initial ? 'Edit Template' : 'New Template'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Name *</div>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Template name" style={inp} />
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Description</div>
            <textarea
              value={form.description || ''}
              onChange={e => set('description', e.target.value)}
              placeholder="Optional description"
              rows={2}
              style={{ ...inp, resize: 'vertical' }}
            />
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Default Priority</div>
            <select value={form.priority} onChange={e => set('priority', e.target.value)} style={inp}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Subtasks</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input
                value={subtaskInput}
                onChange={e => setSubtaskInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSubtask()}
                placeholder="Add subtask title..."
                style={{ ...inp, flex: 1 }}
              />
              <button onClick={addSubtask} style={{ ...btn(), padding: '5px 10px' }}>Add</button>
            </div>
            {form.subtasks.map((s, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
                background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: 4,
              }}>
                <span style={{ flex: 1, fontSize: 12 }}>{s.title}</span>
                <button onClick={() => removeSubtask(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f3727f', padding: 0 }}>
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Labels (names)</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input
                value={labelInput}
                onChange={e => setLabelInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addLabel()}
                placeholder="Add label name..."
                style={{ ...inp, flex: 1 }}
              />
              <button onClick={addLabel} style={{ ...btn(), padding: '5px 10px' }}>Add</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {form.label_names.map(l => (
                <span key={l} style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px',
                  background: 'rgba(129,140,248,0.15)', borderRadius: 9999, fontSize: 11, color: '#818cf8',
                }}>
                  {l}
                  <button onClick={() => removeLabel(l)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#818cf8', padding: 0, lineHeight: 1 }}>
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={btn()}>Cancel</button>
          <button
            onClick={() => form.name.trim() && onSave(form)}
            style={btn('primary')}
            disabled={!form.name.trim()}
          >
            {initial ? 'Save Changes' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TemplateCard({ tpl, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{
      background: '#0f1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <FileText size={14} style={{ color: '#818cf8', marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{tpl.name}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 9999,
              background: `${PRIORITY_COLOR[tpl.priority]}20`, color: PRIORITY_COLOR[tpl.priority],
            }}>
              {tpl.priority}
            </span>
          </div>
          {tpl.description && (
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{tpl.description}</div>
          )}
          <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: '#4b5563' }}>
            {tpl.subtasks.length > 0 && (
              <button
                onClick={() => setExpanded(v => !v)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 11, padding: 0, display: 'flex', alignItems: 'center', gap: 3 }}
              >
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                {tpl.subtasks.length} subtask{tpl.subtasks.length !== 1 ? 's' : ''}
              </button>
            )}
            {tpl.label_names.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {tpl.label_names.map(l => (
                  <span key={l} style={{
                    padding: '1px 6px', borderRadius: 9999, fontSize: 10,
                    background: 'rgba(129,140,248,0.12)', color: '#818cf8',
                  }}>{l}</span>
                ))}
              </div>
            )}
          </div>
          {expanded && tpl.subtasks.length > 0 && (
            <div style={{ marginTop: 8, paddingLeft: 8, borderLeft: '2px solid rgba(255,255,255,0.06)' }}>
              {tpl.subtasks.map((s, i) => (
                <div key={i} style={{ fontSize: 11, color: '#9ca3af', padding: '2px 0' }}>• {s.title}</div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => onEdit(tpl)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4 }}>
            <Edit2 size={13} />
          </button>
          <button onClick={() => onDelete(tpl.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f3727f', padding: 4 }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Templates() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => getTemplates(),
  })

  const create = useMutation({
    mutationFn: createTemplate,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); setShowForm(false) },
  })

  const edit = useMutation({
    mutationFn: ({ id, data }) => updateTemplate(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); setEditTarget(null) },
  })

  const remove = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })

  const handleDelete = (id) => {
    if (window.confirm('Delete this template?')) remove.mutate(id)
  }

  return (
    <div style={{ padding: 28, maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Task Templates</h1>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            Reusable task blueprints with default priority, subtasks, and labels.
          </div>
        </div>
        <button onClick={() => setShowForm(true)} style={{ ...btn('primary'), display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={13} /> New Template
        </button>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#4b5563', fontSize: 13 }}>Loading...</div>
      ) : templates.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 64, color: '#4b5563', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 12,
        }}>
          <FileText size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>No templates yet</div>
          <div style={{ fontSize: 12 }}>Create a template to speed up task creation.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {templates.map(tpl => (
            <TemplateCard
              key={tpl.id}
              tpl={tpl}
              onEdit={t => setEditTarget(t)}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {showForm && (
        <TemplateForm
          onSave={data => create.mutate(data)}
          onClose={() => setShowForm(false)}
        />
      )}

      {editTarget && (
        <TemplateForm
          initial={editTarget}
          onSave={data => edit.mutate({ id: editTarget.id, data })}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  )
}
