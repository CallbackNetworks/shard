/**
 * What the reader has actually done (ADR-0148).
 *
 * Derived from live data, never stored. A stored checklist drifts the moment
 * something is created or deleted outside the flow that ticked the box — and it
 * drifts *upwards*, so it congratulates you for work that no longer exists. The
 * cost of deriving is that a step cannot be ticked by doing it a different way
 * than this function recognises, which is the correct direction to be wrong in.
 *
 * `dismissed` is the one piece of real state: finishing is a fact about the data,
 * putting it away is a decision by the person.
 */
export const CHECKLIST_STEPS = [
  { id: 'project', labelKey: 'onboarding.stepProject', hintKey: 'onboarding.stepProjectHint', to: '/?new=project' },
  { id: 'task', labelKey: 'onboarding.stepTask', hintKey: 'onboarding.stepTaskHint' },
  { id: 'due', labelKey: 'onboarding.stepDue', hintKey: 'onboarding.stepDueHint' },
  { id: 'organise', labelKey: 'onboarding.stepOrganise', hintKey: 'onboarding.stepOrganiseHint' },
  { id: 'decision', labelKey: 'onboarding.stepDecision', hintKey: 'onboarding.stepDecisionHint', to: '/decisions' },
  { id: 'automate', labelKey: 'onboarding.stepAutomate', hintKey: 'onboarding.stepAutomateHint', to: '/workflow-rules' },
]

export function deriveChecklist({ projects = [], decisions = [], rules = [], integrations = [] } = {}) {
  const tasks = projects.flatMap(p => p.tasks || [])
  const done = {
    project: projects.length > 0,
    task: tasks.length > 0,
    due: tasks.some(t => t.due_date),
    // Either axis counts as having organised something: a label is the lightweight
    // way and a subtask is the structural one, and insisting on one of them would
    // leave somebody who did the other looking at an unticked box for work they did.
    organise: tasks.some(t => (t.labels || []).length > 0 || t.parent_id),
    decision: decisions.length > 0,
    automate: rules.length > 0 || integrations.length > 0,
  }
  const completed = CHECKLIST_STEPS.filter(s => done[s.id]).length
  return {
    done,
    completed,
    total: CHECKLIST_STEPS.length,
    // The first thing still outstanding, in declared order — the panel points at
    // one next action rather than presenting six equally.
    next: CHECKLIST_STEPS.find(s => !done[s.id]) || null,
    allDone: completed === CHECKLIST_STEPS.length,
  }
}
