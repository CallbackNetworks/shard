import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Play, X, GitMerge, AlertTriangle } from 'lucide-react'
import { getWorkflowRules, createWorkflowRule, updateWorkflowRule, deleteWorkflowRule, testWorkflowRule, search } from '../api/client'
import { DARK } from '../constants/theme'
import FormModal from '../components/shared/FormModal'
import FormField from '../components/shared/FormField'
import { useInvalidatingMutation } from '../hooks/useCrudMutations'
import { useRuleVocabulary } from '../hooks/useRuleVocabulary'
import EmptyState from '../components/shared/EmptyState'
import RuleOutcomeChips from '../components/shared/RuleOutcomeChips'
// The engine's own names are what gets saved; what gets shown is those names read as
// words (ADR-0058). Nothing here decides which is which — the served spec does.
import { actionLabel, conditionPhrase, fieldLabel, opLabel, triggerLabel, valueLabel } from '../utils/ruleTerms'

// A value the rule was saved with stays selectable even if the engine has since dropped
// it, so editing an old rule never silently rewrites the field you did not touch.
const withCurrent = (options, current) =>
  options.includes(current) ? options : [current, ...options]

// Switching what the value belongs to must not leave the old value behind: "high" is a
// priority, not a label name, and carrying it across is how a rule gets saved holding a
// value that matches nothing. A closed set lands on its first option — the only choice
// that is valid by construction — and everything else empties, because guessing at a
// label name or an event name would be inventing content the user did not write.
const defaultValueFor = (spec) => (spec?.kind === 'enum' ? (spec.options[0] ?? '') : '')

/**
 * The value box, told what it belongs to (ADR-0056).
 *
 * It used to be one plain text input for all eighteen slots, so the only way to know
 * that `set_priority` takes `low|medium|high` and `fire_event` takes an event name was
 * to have read the engine. `spec.kind` decides the control: a closed set the engine
 * rejects anything outside gets a picker; an open one with something real to offer gets
 * a datalist (type anything, see what exists); the rest gets the plain box it deserves.
 */
function ValueInput({ spec, value, slot, onChange, t }) {
  const listId = useId()
  const options = spec?.options ?? []
  if (spec?.kind === 'enum') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className="kt-input" style={{ flex: 1, minWidth: 120 }}>
        {withCurrent(options, value).map(o => <option key={o} value={o}>{valueLabel(o, spec)}</option>)}
      </select>
    )
  }
  return (
    <>
      <input
        list={options.length ? listId : undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={t(`rules.valueHint.${slot}`, { defaultValue: t('rules.valuePlaceholder') })}
        className="kt-input"
        style={{ flex: 1, minWidth: 100 }}
      />
      {options.length > 0 && (
        <datalist id={listId}>
          {/* The box holds the raw value because the raw value is what gets saved; the
              readable form rides along as the option's label rather than replacing it,
              since a suggestion list that shows something other than what it inserts is
              a list you cannot trust. */}
          {options.map(o => <option key={o} value={o} label={spec?.vocabulary ? valueLabel(o, spec) : undefined} />)}
        </datalist>
      )}
    </>
  )
}

function ConditionRow({ cond, fields, ops, specs, onChange, onRemove, t }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select
        value={cond.field}
        onChange={e => onChange({ ...cond, field: e.target.value, value: defaultValueFor(specs[e.target.value]) })}
        className="kt-input"
        style={{ width: 'auto', minWidth: 120 }}
      >
        {withCurrent(fields, cond.field).map(f => <option key={f} value={f}>{fieldLabel(f, t)}</option>)}
      </select>
      <select value={cond.op} onChange={e => onChange({ ...cond, op: e.target.value })} className="kt-input" style={{ width: 'auto', minWidth: 80 }}>
        {withCurrent(ops, cond.op).map(o => <option key={o} value={o}>{opLabel(o, t)}</option>)}
      </select>
      <ValueInput spec={specs[cond.field]} value={cond.value} slot={cond.field} onChange={v => onChange({ ...cond, value: v })} t={t} />
      <button onClick={onRemove} className="kt-icon-btn" style={{ color: DARK.danger }}>
        <X size={12} />
      </button>
    </div>
  )
}

function ActionRow({ action, types, specs, onChange, onRemove, t }) {
  const spec = specs[action.type]
  // Who would receive this, said while the rule is being written rather than after it
  // has fired into the void. `fire_event` is the only action whose effect lands
  // somewhere else, and an event nobody subscribes to is delivered to nobody — the
  // same silent empty set the warning on the saved rule reports (ADR-0054).
  const subscribers = spec?.subscribers?.[action.value]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={action.type}
          onChange={e => onChange({ ...action, type: e.target.value, value: defaultValueFor(specs[e.target.value]) })}
          className="kt-input"
          style={{ width: 'auto', minWidth: 180 }}
        >
          {withCurrent(types, action.type).map(a => <option key={a} value={a}>{actionLabel(a, t)}</option>)}
        </select>
        <ValueInput spec={spec} value={action.value} slot={action.type} onChange={v => onChange({ ...action, value: v })} t={t} />
        <button onClick={onRemove} className="kt-icon-btn" style={{ color: DARK.danger }}>
          <X size={12} />
        </button>
      </div>
      {action.type === 'fire_event' && action.value && (
        <span className="kt-rule-hint" style={{ color: subscribers ? DARK.textDim : DARK.warning }}>
          {subscribers
            ? t('rules.eventSubscribers', { n: subscribers })
            : <><AlertTriangle size={11} /> {t('rules.eventNoSubscribers')}</>}
        </span>
      )}
    </div>
  )
}

/**
 * Pick the node to dry-run against, by name.
 *
 * This used to be a bare text box asking for a node ID — a value the user has to go and
 * copy from somewhere else, which made the button that checks a rule harder to use than
 * the rule itself. Projects are offered alongside tasks because a rule can trigger on any
 * node (ADR-0049), and a non-task subject is precisely the case worth checking.
 */
function SubjectPicker({ selected, onPick, t }) {
  const [term, setTerm] = useState('')
  const { data } = useQuery({
    queryKey: ['rule-subject-search', term],
    queryFn: () => search(term),
    enabled: term.trim().length >= 2,
    staleTime: 30_000,
  })
  const results = [
    ...(data?.tasks || []).map(x => ({ id: x.id, title: x.title, type: 'task' })),
    ...(data?.projects || []).map(x => ({ id: x.id, title: x.name, type: 'project' })),
  ].slice(0, 6)

  if (selected) {
    return (
      <span className="kt-chip" style={{ fontSize: 11 }}>
        {selected.type}: {selected.title}
        <button onClick={() => onPick(null)} className="kt-icon-btn" style={{ color: DARK.danger, marginLeft: 4 }}>
          <X size={10} />
        </button>
      </span>
    )
  }
  return (
    <span style={{ position: 'relative' }}>
      <input
        value={term}
        onChange={e => setTerm(e.target.value)}
        placeholder={t('rules.subjectPlaceholder')}
        className="kt-input"
        style={{ width: 220, fontSize: 11 }}
      />
      {results.length > 0 && (
        <div className="kt-card kt-rule-subject-results">
          {results.map(r => (
            <button
              key={r.id}
              onClick={() => { onPick(r); setTerm('') }}
              className="kt-rule-subject-option"
            >
              <span style={{ color: DARK.textDim }}>{r.type}</span> {r.title}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

function RuleModal({ initial, onSave, onClose, t }) {
  const emptyRule = { name: '', trigger: 'node.created', conditions: [], actions: [{ type: 'set_priority', value: 'high' }], active: true, project_id: '' }
  const [form, setForm] = useState(initial ? {
    ...initial,
    project_id: initial.project_id || '',
    conditions: initial.conditions || [],
    actions: initial.actions || [],
  } : emptyRule)

  // Scoped to the rule being written: a project-scoped rule resolves its label names
  // against that project, so offering the whole installation's labels here would offer
  // values that warn the moment they are saved.
  const vocabulary = useRuleVocabulary(form.project_id)
  const triggers = vocabulary?.triggers ?? []
  const conditionFields = vocabulary?.condition_fields ?? []
  const conditionOps = vocabulary?.condition_ops ?? []
  const actionTypes = vocabulary?.action_types ?? []
  // What may go in each value box (ADR-0056). Served per action type and per condition
  // field, so the control matches the slot instead of being one text box for all of them.
  const actionValues = vocabulary?.action_values ?? {}
  const conditionValues = vocabulary?.condition_values ?? {}
  const taskOnlyActions = vocabulary?.task_only_actions ?? []
  // Which condition fields describe *the change* rather than the subject, and which of
  // them each trigger actually reports (ADR-0055). A field the trigger never supplies is
  // rejected by the write surface, so the editor must not offer it in the first place.
  const triggerContextFields = vocabulary?.trigger_context_fields ?? {}
  const contextFields = new Set(Object.values(triggerContextFields).flat())

  const allowedContext = triggerContextFields[form.trigger] ?? []
  const fieldsForTrigger = conditionFields.filter(f => !contextFields.has(f) || allowedContext.includes(f))
  // Conditions the *current* trigger cannot answer. Surfaced instead of dropped: a rule
  // being edited was saved under some trigger, and silently deleting the condition that
  // gave it its meaning is how a rule ends up looking healthy and doing nothing.
  const strayFields = [...new Set(
    form.conditions.map(c => c.field).filter(f => contextFields.has(f) && !allowedContext.includes(f))
  )]
  // Every trigger now fires for every node type (ADR-0049/0055), so a rule with no
  // condition narrowing it to tasks will land on projects, labels and cycles too — where
  // all but `fire_event` are skipped. Said once, next to the actions it concerns, and
  // only when the rule has not already narrowed itself.
  const narrowedToTasks = form.conditions.some(
    c => c.op === 'eq' && ((c.field === 'has_role' && c.value === 'task') || (c.field === 'type' && c.value === 'task'))
  )
  const taskOnlyInUse = narrowedToTasks
    ? []
    : [...new Set(form.actions.map(a => a.type).filter(t => taskOnlyActions.includes(t)))]

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const updateCond = (i, c) => set('conditions', form.conditions.map((x, j) => j === i ? c : x))
  const removeCond = (i) => set('conditions', form.conditions.filter((_, j) => j !== i))
  const addCond = () => set('conditions', [...form.conditions, { field: 'status', op: 'eq', value: defaultValueFor(conditionValues.status) }])
  const updateAction = (i, a) => set('actions', form.actions.map((x, j) => j === i ? a : x))
  const removeAction = (i) => set('actions', form.actions.filter((_, j) => j !== i))
  const addAction = () => set('actions', [...form.actions, { type: 'set_status', value: defaultValueFor(actionValues.set_status) }])

  return (
    <FormModal
      title={`${initial ? 'Edit' : 'New'} Workflow Rule`}
      onClose={onClose}
      onSubmit={() => onSave(form)}
      submitLabel="Save"
      submitDisabled={!form.name || form.actions.length === 0 || strayFields.length > 0}
      wide
    >
      <FormField label="Name">
        <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Auto-escalate urgent tasks" className="kt-input" />
      </FormField>
      <FormField label="Trigger">
        <select value={form.trigger} onChange={e => set('trigger', e.target.value)} className="kt-input">
          {withCurrent(triggers, form.trigger)
            .map(tr => <option key={tr} value={tr}>{triggerLabel(tr, t)}</option>)}
        </select>
      </FormField>
      <FormField label="Conditions (all must match)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {form.conditions.map((c, i) => <ConditionRow key={i} cond={c} fields={fieldsForTrigger} ops={conditionOps} specs={conditionValues} onChange={v => updateCond(i, v)} onRemove={() => removeCond(i)} t={t} />)}
          <button onClick={addCond} className="kt-btn" style={{ alignSelf: 'flex-start' }}>
            <Plus size={10} /> Add Condition
          </button>
          {strayFields.length > 0 && (
            <span className="kt-rule-stray" style={{ color: DARK.warning }}>
              <AlertTriangle size={11} />
              {t('rules.strayConditions', {
                trigger: triggerLabel(form.trigger, t),
                fields: strayFields.map(f => fieldLabel(f, t)).join(', '),
              })}
            </span>
          )}
        </div>
      </FormField>
      <FormField label="Actions">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {form.actions.map((a, i) => <ActionRow key={i} action={a} types={actionTypes} specs={actionValues} onChange={v => updateAction(i, v)} onRemove={() => removeAction(i)} t={t} />)}
          <button onClick={addAction} className="kt-btn" style={{ alignSelf: 'flex-start' }}>
            <Plus size={10} /> Add Action
          </button>
          {taskOnlyInUse.length > 0 && (
            <span className="kt-rule-hint" style={{ color: DARK.textDim }}>
              {t('rules.taskOnlyActions', { actions: taskOnlyInUse.map(a => actionLabel(a, t)).join(', ') })}
            </span>
          )}
        </div>
      </FormField>
      <FormField label="Project ID (optional, leave blank for global)">
        <input value={form.project_id} onChange={e => set('project_id', e.target.value)} placeholder="(all projects)" className="kt-input" />
      </FormField>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: DARK.textMid, cursor: 'pointer' }}>
        <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
        Active
      </label>
    </FormModal>
  )
}

export default function WorkflowRules() {
  const { t } = useTranslation()
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['workflow-rules'], queryFn: getWorkflowRules })
  // The cards read a saved rule back in words, which needs the same vocabulary the editor
  // writes it with — unscoped here, because the list mixes rules from every project.
  const vocabulary = useRuleVocabulary()
  const actionValues = vocabulary?.action_values ?? {}
  const conditionValues = vocabulary?.condition_values ?? {}
  const [modal, setModal] = useState(null)
  const [testResults, setTestResults] = useState({})
  const [subject, setSubject] = useState(null)

  const createMut = useInvalidatingMutation({
    mutationFn: createWorkflowRule,
    invalidateKeys: [['workflow-rules']],
    successMessage: t('rules.createdSuccess'),
    onSuccess: () => setModal(null),
  })
  const updateMut = useInvalidatingMutation({
    mutationFn: ({ id, data }) => updateWorkflowRule(id, data),
    invalidateKeys: [['workflow-rules']],
    successMessage: t('rules.updatedSuccess'),
    onSuccess: () => setModal(null),
  })
  const deleteMut = useInvalidatingMutation({
    mutationFn: deleteWorkflowRule,
    invalidateKeys: [['workflow-rules']],
    successMessage: t('rules.deletedSuccess'),
  })
  const toggleMut = useInvalidatingMutation({
    mutationFn: ({ id, active }) => updateWorkflowRule(id, { active }),
    invalidateKeys: [['workflow-rules']],
  })
  const testMut = useInvalidatingMutation({
    mutationFn: ({ ruleId, nodeId }) => testWorkflowRule(ruleId, nodeId),
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

  return (
    <div className="kt-page">
      {modal && <RuleModal initial={modal.data} onSave={handleSave} onClose={() => setModal(null)} t={t} />}

      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">Workflow Rules</h1>
          <p className="kt-page-subtitle">Automate task actions with if-this-then-that rules</p>
        </div>
        <button onClick={() => setModal({ mode: 'create' })} className="kt-btn kt-btn-primary">
          <Plus size={13} /> New Rule
        </button>
      </div>

      {isLoading ? (
        <div style={{ color: 'rgba(var(--kt-ink-rgb), 0.3)', fontSize: 13 }}>Loading…</div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<GitMerge size={36} className="kt-empty-icon" />}
          message={t('rules.empty')}
          hint={t('rules.emptyHint')}
          action={(
            <button onClick={() => setModal({ mode: 'create' })} className="kt-btn kt-btn-primary">
              <Plus size={13} /> {t('rules.new')}
            </button>
          )}
        />
      ) : (
        <div className="kt-stack">
          {rules.map((rule, ruleIdx) => (
            <div key={rule.id} className="kt-card" style={{
              padding: '14px 18px',
              animation: 'fadeUpIn 0.35s ease forwards',
              animationDelay: `${ruleIdx * 0.06}s`,
              opacity: 0,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: DARK.text }}>{rule.name}</span>
                    <span style={{
                      fontSize: 10, padding: '1px 8px', fontWeight: 600,
                      background: rule.active ? 'rgba(250,204,21,0.15)' : 'rgba(var(--kt-ink-rgb), 0.07)',
                      color: rule.active ? DARK.success : '#6b7280',
                    }}>{rule.active ? 'active' : 'paused'}</span>
                    {/* "ran 47×" answers a question nobody asked. A rule that fires
                        constantly and changes nothing looks identical to one that works,
                        so the effect count sits next to it — and stands out when it is
                        zero, because that is the case worth acting on (ADR-0053). */}
                    {rule.run_count > 0 && (
                      <span style={{ fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.2)' }}>
                        {t('rules.ranCount', { n: rule.run_count })}
                        {' · '}
                        <span style={{ color: rule.effect_count ? undefined : DARK.warning }}>
                          {t('rules.withEffect', { n: rule.effect_count || 0 })}
                        </span>
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
                    <span className="kt-chip" style={{ color: DARK.success, background: 'rgba(250,204,21,0.1)' }}>
                      when: {triggerLabel(rule.trigger, t)}
                    </span>
                    {/* The rule read back, not its JSON transcribed. `title` keeps the
                        stored keys one hover away, because they are still what the API
                        takes and what a support question will quote (ADR-0058). */}
                    {(rule.conditions || []).map((c, i) => (
                      <span key={i} className="kt-chip" title={`${c.field} ${c.op} ${c.value}`}>
                        if {conditionPhrase(c, t, conditionValues)}
                      </span>
                    ))}
                    {(rule.actions || []).map((a, i) => (
                      <span key={i} className="kt-chip" title={`${a.type} ${a.value}`} style={{ color: DARK.success, background: 'rgba(250,204,21,0.1)' }}>
                        → {actionLabel(a.type, t)}: {valueLabel(a.value, actionValues[a.type])}
                      </span>
                    ))}
                  </div>
                  {/* What can never work, said the moment the rule is saved rather than
                      after it has quietly done nothing for a week. Not an error: the
                      label may be created tomorrow, and the warning clears itself when
                      it is (ADR-0054). */}
                  {rule.warnings?.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <AlertTriangle size={11} style={{ color: DARK.warning, flexShrink: 0 }} />
                      <RuleOutcomeChips records={rule.warnings} specs={actionValues} />
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 12, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => toggleMut.mutate({ id: rule.id, active: !rule.active })}
                    className="kt-btn"
                    style={{ fontSize: 11 }}
                  >
                    {rule.active ? 'Pause' : 'Resume'}
                  </button>
                  <button onClick={() => setModal({ mode: 'edit', data: rule })} className="kt-btn" style={{ fontSize: 11 }}>Edit</button>
                  <button onClick={() => { if (confirm(`Delete rule "${rule.name}"?`)) deleteMut.mutate(rule.id) }} className="kt-btn kt-btn-danger" style={{ fontSize: 11 }}>
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {/* Test section */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(var(--kt-ink-rgb), 0.05)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.2)' }}>{t('rules.dryRun')}</span>
                <SubjectPicker selected={subject} onPick={setSubject} t={t} />
                <button
                  onClick={() => testMut.mutate({ ruleId: rule.id, nodeId: subject.id })}
                  disabled={!subject}
                  className="kt-btn"
                  style={{ fontSize: 11, opacity: subject ? 1 : 0.4 }}
                >
                  <Play size={10} /> {t('rules.test')}
                </button>
                {/* Two answers, not one: whether the conditions match this subject, and
                    what each action would then do. "Would fire 1 action" was neither —
                    it counted the rule's own configuration back at the user, and said
                    "would fire" for actions that skip every time (ADR-0054).

                    Three states, not two: a subject is not an event, so a rule asking
                    about the change that fires it (changed_field, edge_type…) has no
                    answer here. Rendering that as "would not fire" would be the same
                    false report in the opposite direction (ADR-0055). The action
                    predictions are still worth showing — "if it fires, here is what it
                    would do" is the half of the question a subject can answer. */}
                {testResults[rule.id] && (
                  testResults[rule.id].would_fire === false ? (
                    <span style={{ fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.3)' }}>
                      {t('rules.wouldNotFire')}
                    </span>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, color: DARK.textMid }}>
                        {testResults[rule.id].would_fire === null
                          ? t('rules.dependsOnChange')
                          : t('rules.wouldChange', {
                            n: testResults[rule.id].effect_count,
                            total: testResults[rule.id].actions?.length ?? 0,
                          })}
                      </span>
                      <RuleOutcomeChips records={testResults[rule.id].actions} specs={actionValues} />
                    </>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
