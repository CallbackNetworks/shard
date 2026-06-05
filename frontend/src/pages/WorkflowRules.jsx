import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Play, X, Zap, GitMerge } from 'lucide-react'
import { getWorkflowRules, createWorkflowRule, updateWorkflowRule, deleteWorkflowRule, testWorkflowRule } from '../api/client'
import { useToast } from '../context/ToastContext'
import { DARK } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'

const TRIGGERS = [
  { value: 'task.created', label: 'Task Created' },
  { value: 'task.status_changed', label: 'Task Status Changed' },
  { value: 'task.label_added', label: 'Task Label Added' },
  { value: 'task.priority_changed', label: 'Task Priority Changed' },
]

const CONDITION_FIELDS = ['status', 'priority', 'assignee', 'title_contains', 'has_label']
const CONDITION_OPS = ['eq', 'neq', 'contains', 'in']
const ACTION_TYPES = [
  { value: 'set_status', label: 'Set Status' },
  { value: 'set_priority', label: 'Set Priority' },
  { value: 'set_assignee', label: 'Set Assignee' },
  { value: 'add_label', label: 'Add Label (by ID)' },
  { value: 'remove_label', label: 'Remove Label (by ID)' },
  { value: 'add_comment', label: 'Add Comment' },
  { value: 'fire_event', label: 'Fire Integration Event' },
]

const inp = {
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6, padding: '5px 10px', fontSize: 12, color: DARK.text, outline: 'none',
}
const btn = (variant = 'default') => ({
  border: 'none', borderRadius: 9999, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
  ...(variant === 'primary' ? { background: DARK.success, color: '#000' }
    : variant === 'danger' ? { background: 'rgba(243,114,127,0.12)', color: DARK.danger, border: '1px solid rgba(243,114,127,0.2)' }
    : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: DARK.textMid }),
})

function ConditionRow({ cond, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={cond.field} onChange={e => onChange({ ...cond, field: e.target.value })} style={{ ...inp, minWidth: 120 }}>
        {CONDITION_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
      <select value={cond.op} onChange={e => onChange({ ...cond, op: e.target.value })} style={{ ...inp, minWidth: 80 }}>
        {CONDITION_OPS.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <input value={cond.value} onChange={e => onChange({ ...cond, value: e.target.value })} placeholder="value" style={{ ...inp, flex: 1, minWidth: 100 }} />
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(248,113,113,0.6)', padding: '2px 4px' }}>
        <X size={12} />
      </button>
    </div>
  )
}

function ActionRow({ action, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={action.type} onChange={e => onChange({ ...action, type: e.target.value })} style={{ ...inp, minWidth: 160 }}>
        {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
      </select>
      <input value={action.value} onChange={e => onChange({ ...action, value: e.target.value })} placeholder="value" style={{ ...inp, flex: 1, minWidth: 100 }} />
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(248,113,113,0.6)', padding: '2px 4px' }}>
        <X size={12} />
      </button>
    </div>
  )
}

function RuleModal({ initial, onSave, onClose }) {
  const emptyRule = { name: '', trigger: 'task.created', conditions: [], actions: [{ type: 'set_priority', value: 'high' }], active: true, project_id: '' }
  const [form, setForm] = useState(initial ? {
    ...initial,
    project_id: initial.project_id || '',
    conditions: initial.conditions || [],
    actions: initial.actions || [],
  } : emptyRule)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const updateCond = (i, c) => set('conditions', form.conditions.map((x, j) => j === i ? c : x))
  const removeCond = (i) => set('conditions', form.conditions.filter((_, j) => j !== i))
  const addCond = () => set('conditions', [...form.conditions, { field: 'status', op: 'eq', value: 'todo' }])
  const updateAction = (i, a) => set('actions', form.actions.map((x, j) => j === i ? a : x))
  const removeAction = (i) => set('actions', form.actions.filter((_, j) => j !== i))
  const addAction = () => set('actions', [...form.actions, { type: 'set_status', value: 'in_progress' }])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: '#10111e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 28, width: '90vw', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontWeight: 700, marginBottom: 20, color: DARK.text, fontSize: 16 }}>{initial ? 'Edit' : 'New'} Workflow Rule</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Name</div>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Auto-escalate urgent tasks" style={{ ...inp, width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Trigger</div>
            <select value={form.trigger} onChange={e => set('trigger', e.target.value)} style={{ ...inp, width: '100%' }}>
              {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Conditions (all must match)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {form.conditions.map((c, i) => <ConditionRow key={i} cond={c} onChange={v => updateCond(i, v)} onRemove={() => removeCond(i)} />)}
              <button onClick={addCond} style={{ ...btn(), alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Plus size={10} /> Add Condition
              </button>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Actions
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {form.actions.map((a, i) => <ActionRow key={i} action={a} onChange={v => updateAction(i, v)} onRemove={() => removeAction(i)} />)}
              <button onClick={addAction} style={{ ...btn(), alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Plus size={10} /> Add Action
              </button>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Project ID (optional, leave blank for global)</div>
            <input value={form.project_id} onChange={e => set('project_id', e.target.value)} placeholder="(all projects)" style={{ ...inp, width: '100%' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: DARK.textMid, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
            Active
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={() => onSave(form)} disabled={!form.name || form.actions.length === 0} style={{ ...btn('primary'), opacity: (!form.name || form.actions.length === 0) ? 0.4 : 1 }}>Save</button>
          <button onClick={onClose} style={btn()}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function WorkflowRules() {
  const { t } = useTranslation()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const qc = useQueryClient()
  const { addToast } = useToast()
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['workflow-rules'], queryFn: getWorkflowRules })
  const [modal, setModal] = useState(null)
  const [testResults, setTestResults] = useState({})
  const [testTaskId, setTestTaskId] = useState('')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workflow-rules'] })

  const createMut = useMutation({ mutationFn: createWorkflowRule, onSuccess: () => { invalidate(); setModal(null); addToast(t('rules.createdSuccess'), 'success') } })
  const updateMut = useMutation({ mutationFn: ({ id, data }) => updateWorkflowRule(id, data), onSuccess: () => { invalidate(); setModal(null); addToast(t('rules.updatedSuccess'), 'success') } })
  const deleteMut = useMutation({ mutationFn: deleteWorkflowRule, onSuccess: () => { invalidate(); addToast(t('rules.deletedSuccess'), 'success') } })
  const toggleMut = useMutation({
    mutationFn: ({ id, active }) => updateWorkflowRule(id, { active }),
    onSuccess: invalidate,
  })
  const testMut = useMutation({
    mutationFn: ({ ruleId, taskId }) => testWorkflowRule(ruleId, taskId),
    onSuccess: (data, { ruleId }) => setTestResults(r => ({ ...r, [ruleId]: data })),
  })

  const handleSave = (form) => {
    const data = {
      ...form,
      project_id: form.project_id || null,
      conditions: form.conditions,
      actions: form.actions,
    }
    if (modal.mode === 'edit') updateMut.mutate({ id: modal.data.id, data })
    else createMut.mutate(data)
  }

  const TRIGGER_LABELS = Object.fromEntries(TRIGGERS.map(t => [t.value, t.label]))

  return (
    <div className="page-content" style={{ padding: isMobile ? '20px 16px' : '32px 40px' }}>
      {modal && <RuleModal initial={modal.data} onSave={handleSave} onClose={() => setModal(null)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'flex-start', marginBottom: isMobile ? 20 : 28, flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 18 : 24, fontWeight: 700, color: DARK.text, margin: 0 }}>Workflow Rules</h1>
          <p style={{ color: 'rgba(255,255,255,0.3)', marginTop: 4, fontSize: 13 }}>Automate task actions with if-this-then-that rules</p>
        </div>
        <button onClick={() => setModal({ mode: 'create' })} style={{ ...btn('primary'), display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={13} /> New Rule
        </button>
      </div>

      {isLoading ? (
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Loading…</div>
      ) : rules.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.2)', animation: 'fadeIn 0.4s ease' }}>
          <GitMerge size={36} style={{ margin: '0 auto 14px', opacity: 0.3, display: 'block', color: DARK.info }} />
          <p style={{ fontSize: 16, fontWeight: 700, color: DARK.text }}>{t('rules.empty')}</p>
          <p style={{ marginTop: 6, fontSize: 13 }}>{t('rules.emptyHint')}</p>
          <button
            onClick={() => setModal({ mode: 'create' })}
            style={{ marginTop: 16, ...btn('primary'), display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={13} /> {t('rules.new')}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rules.map((rule, ruleIdx) => (
            <div key={rule.id} style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 10, padding: '14px 18px',
              animation: 'fadeUpIn 0.35s ease forwards',
              animationDelay: `${ruleIdx * 0.06}s`,
              opacity: 0,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: DARK.text }}>{rule.name}</span>
                    <span style={{
                      fontSize: 10, padding: '1px 8px', borderRadius: 999, fontWeight: 600,
                      background: rule.active ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.07)',
                      color: rule.active ? DARK.success : '#6b7280',
                    }}>{rule.active ? 'active' : 'paused'}</span>
                    {rule.run_count > 0 && (
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>ran {rule.run_count}×</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
                    <span style={{ background: 'rgba(30,215,96,0.1)', color: DARK.success, borderRadius: 6, padding: '2px 8px' }}>
                      when: {TRIGGER_LABELS[rule.trigger] || rule.trigger}
                    </span>
                    {(rule.conditions || []).map((c, i) => (
                      <span key={i} style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', borderRadius: 6, padding: '2px 8px' }}>
                        if {c.field} {c.op} "{c.value}"
                      </span>
                    ))}
                    {(rule.actions || []).map((a, i) => (
                      <span key={i} style={{ background: 'rgba(52,211,153,0.1)', color: DARK.success, borderRadius: 6, padding: '2px 8px' }}>
                        → {a.type}: {a.value}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: isMobile ? 0 : 12, marginTop: isMobile ? 8 : 0, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => toggleMut.mutate({ id: rule.id, active: !rule.active })}
                    style={{ ...btn(), fontSize: 11 }}
                  >
                    {rule.active ? 'Pause' : 'Resume'}
                  </button>
                  <button onClick={() => setModal({ mode: 'edit', data: rule })} style={{ ...btn(), fontSize: 11 }}>Edit</button>
                  <button onClick={() => { if (confirm(`Delete rule "${rule.name}"?`)) deleteMut.mutate(rule.id) }} style={{ ...btn('danger'), fontSize: 11 }}>
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {/* Test section */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>Dry-run:</span>
                <input
                  value={testTaskId}
                  onChange={e => setTestTaskId(e.target.value)}
                  placeholder="task ID"
                  style={{ ...inp, width: 220, fontSize: 11 }}
                />
                <button
                  onClick={() => testMut.mutate({ ruleId: rule.id, taskId: testTaskId })}
                  disabled={!testTaskId.trim()}
                  style={{ ...btn(), fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, opacity: testTaskId.trim() ? 1 : 0.4 }}
                >
                  <Play size={10} /> Test
                </button>
                {testResults[rule.id] && (
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 6,
                    background: testResults[rule.id].would_fire ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)',
                    color: testResults[rule.id].would_fire ? DARK.success : 'rgba(255,255,255,0.3)',
                  }}>
                    {testResults[rule.id].would_fire
                      ? `Would fire ${testResults[rule.id].actions?.length} action(s)`
                      : 'Would not fire'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
