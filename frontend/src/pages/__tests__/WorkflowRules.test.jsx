/**
 * The rule editor and the dry-run must not offer or report anything the engine cannot back.
 *
 * Two behaviours are pinned here, both instances of the same failure the ADR line closes:
 * a condition field the chosen trigger never supplies (the write surface 422s, so the
 * editor must say so before the save), and a dry-run whose conditions have no answer for
 * a plain subject — reported as "would not fire" it is a false negative, exactly as
 * misleading as the false green light ADR-0054 removed (ADR-0055).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Resolved against the real catalogue, because the fallback is the behaviour under test:
// a key the catalogue carries renders from it (asserted as the key itself, as elsewhere
// in this suite), and a key it does not falls back to ``defaultValue`` — which is how an
// action type added on the server still renders readable with nothing translated first.
vi.mock('react-i18next', async () => {
  const en = (await import('../../i18n/en.json')).default
  return {
    useTranslation: () => ({
      t: (key, params) => {
        if (en[key] === undefined) return params?.defaultValue ?? key
        const rest = Object.fromEntries(Object.entries(params || {}).filter(([k]) => k !== 'defaultValue'))
        return Object.keys(rest).length ? `${key}:${JSON.stringify(rest)}` : key
      },
    }),
  }
})

vi.mock('../../hooks/useFocusTrap', () => ({ default: () => ({ current: null }) }))

const mockUseQuery = vi.fn()
const mutate = vi.fn()
// What every mutation's onSuccess is handed. The dry-run is the only one whose result the
// page renders, so setting this is how a test drives the three answers.
let mutationResult = null

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
  useMutation: (options) => ({
    mutate: (payload) => { mutate(payload); options?.onSuccess?.(mutationResult, payload) },
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('../../api/client', () => ({
  getWorkflowRules: vi.fn(),
  createWorkflowRule: vi.fn(),
  updateWorkflowRule: vi.fn(),
  deleteWorkflowRule: vi.fn(),
  testWorkflowRule: vi.fn(),
  getWorkflowRuleVocabulary: vi.fn(),
  search: vi.fn(),
}))

import WorkflowRules from '../WorkflowRules'

const VOCABULARY = {
  triggers: ['node.created', 'node.updated', 'node.deleted', 'edge.added', 'edge.removed'],
  trigger_context_fields: {
    'node.created': [],
    'node.updated': ['changed_field'],
    'node.deleted': [],
    'edge.added': ['edge_side', 'edge_type', 'other_type'],
    'edge.removed': ['edge_side', 'edge_type', 'other_type'],
  },
  condition_fields: ['changed_field', 'edge_side', 'edge_type', 'has_label', 'other_type', 'status'],
  condition_ops: ['contains', 'eq', 'in', 'neq'],
  action_types: ['fire_event', 'set_priority', 'set_status'],
  // What may go in the value box, per slot (ADR-0056).
  action_values: {
    fire_event: {
      kind: 'suggest',
      options: ['task.done', 'deploy.requested'],
      subscribers: { 'task.done': 2, 'deploy.requested': 0 },
    },
    set_priority: { kind: 'enum', options: ['low', 'medium', 'high'] },
    set_status: { kind: 'enum', options: ['todo', 'in_progress', 'done', 'failed'] },
  },
  condition_values: {
    changed_field: { kind: 'suggest', options: ['status', 'priority'] },
    edge_side: { kind: 'enum', options: ['source', 'target'] },
    edge_type: { kind: 'suggest', options: ['contains', 'labeled'] },
    has_label: { kind: 'suggest', options: ['urgent'] },
    other_type: { kind: 'enum', options: ['task', 'project'] },
    status: { kind: 'suggest', options: ['todo', 'done'] },
  },
  task_only_actions: ['set_priority', 'set_status'],
}

const rule = {
  id: 'r1',
  name: 'On status change',
  trigger: 'node.updated',
  conditions: [{ field: 'changed_field', op: 'eq', value: 'status' }],
  actions: [{ type: 'set_priority', value: 'high' }],
  active: true,
  run_count: 3,
  effect_count: 0,
  warnings: [],
}

function setup(rules = [rule]) {
  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'workflow-rules') return { data: rules, isLoading: false }
    if (queryKey[0] === 'workflow-rule-vocabulary') return { data: VOCABULARY }
    if (queryKey[0] === 'rule-subject-search') {
      return { data: { tasks: [{ id: 'n1', title: 'Some task' }], projects: [] } }
    }
    return { data: undefined, isLoading: false }
  })
  return render(<WorkflowRules />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mutationResult = null
})

describe('condition fields are filtered by the trigger', () => {
  it('offers a trigger its own change fields and not another trigger\'s', () => {
    setup()
    fireEvent.click(screen.getByText('Edit'))

    const fieldSelect = screen.getAllByRole('combobox').find(s => s.value === 'changed_field')
    const offered = [...fieldSelect.options].map(o => o.value)
    expect(offered).toContain('changed_field')
    expect(offered).toContain('status')
    // edge_type belongs to the edge triggers; offering it here builds a rule the write
    // surface rejects.
    expect(offered).not.toContain('edge_type')
  })

  it('blocks the save when a trigger change strands a condition', () => {
    setup()
    fireEvent.click(screen.getByText('Edit'))

    const triggerSelect = screen.getAllByRole('combobox').find(s => s.value === 'node.updated')
    fireEvent.change(triggerSelect, { target: { value: 'node.created' } })

    expect(screen.getByText(/rules.strayConditions/)).toBeTruthy()
    expect(screen.getByText('Save').disabled).toBe(true)
  })

  it('keeps the stranded condition rather than dropping it silently', () => {
    setup()
    fireEvent.click(screen.getByText('Edit'))
    const triggerSelect = screen.getAllByRole('combobox').find(s => s.value === 'node.updated')
    fireEvent.change(triggerSelect, { target: { value: 'node.created' } })

    // Still on screen: deleting the condition that gives a rule its meaning, without
    // saying so, is how a rule ends up looking healthy and doing nothing.
    expect(screen.getAllByRole('combobox').some(s => s.value === 'changed_field')).toBe(true)
  })
})

describe('the dry-run has three answers, not two', () => {
  function runDryRun(would_fire) {
    mutationResult = {
      would_fire,
      conditions_met: [would_fire],
      node: { id: 'n1', type: 'task', title: 'Some task' },
      actions: [{ type: 'set_priority', value: 'high', outcome: 'applied' }],
      effect_count: 1,
    }
    setup()
    fireEvent.change(screen.getByPlaceholderText('rules.subjectPlaceholder'), { target: { value: 'some' } })
    fireEvent.click(screen.getByText('Some task'))
    fireEvent.click(screen.getByText('rules.test'))
  }

  it('reports an undecidable rule as depending on the change, not as dead', () => {
    runDryRun(null)

    expect(screen.getByText('rules.dependsOnChange')).toBeTruthy()
    expect(screen.queryByText('rules.wouldNotFire')).toBeNull()
    // The half a subject *can* answer is still shown: if it fires, here is what it does.
    expect(screen.getByText(/set_priority "high" · rules.outcome.applied/)).toBeTruthy()
  })

  it('still reports a genuinely unmet condition as dead', () => {
    runDryRun(false)

    expect(screen.getByText('rules.wouldNotFire')).toBeTruthy()
    expect(screen.queryByText('rules.dependsOnChange')).toBeNull()
  })

  it('counts effects when the conditions do match', () => {
    runDryRun(true)

    expect(screen.getByText(/rules.wouldChange/)).toBeTruthy()
  })
})

describe('the value box knows what belongs in it', () => {
  const openEditor = () => {
    setup()
    fireEvent.click(screen.getByText('Edit'))
  }
  const comboWith = (value) => screen.getAllByRole('combobox').find(s => s.value === value)

  it('renders a closed set as a picker instead of a text box', () => {
    openEditor()
    // set_priority takes low|medium|high and nothing else; typing anything into a text
    // box here was a 422 waiting to happen, with no way to know the three words.
    const valueSelect = comboWith('high')
    expect([...valueSelect.options].map(o => o.value)).toEqual(['low', 'medium', 'high'])
  })

  it('replaces the value when the action type changes', () => {
    openEditor()
    fireEvent.change(comboWith('set_priority'), { target: { value: 'set_status' } })

    // "high" is a priority, not a status. Left behind it would be saved as a status the
    // engine rejects — or worse, silently skipped at run time.
    expect(comboWith('high')).toBeUndefined()
    expect(comboWith('todo')).toBeTruthy()
  })

  it('replaces the value when the condition field changes', () => {
    openEditor()
    // Via an edge trigger, because that is where the enum-valued fields live.
    fireEvent.change(comboWith('node.updated'), { target: { value: 'edge.added' } })
    fireEvent.change(comboWith('changed_field'), { target: { value: 'edge_side' } })

    // changed_field's "status" means nothing to edge_side, whose only two answers are
    // source and target — so the field becomes a picker holding the first of them.
    const valueSelect = comboWith('source')
    expect([...valueSelect.options].map(o => o.value)).toEqual(['source', 'target'])
  })

  it('offers what exists for an open set without closing it', () => {
    openEditor()
    fireEvent.change(comboWith('set_priority'), { target: { value: 'fire_event' } })

    // An event name is free text — a rule may emit one nobody has invented yet — so the
    // control stays a box, with the known names attached as suggestions.
    const input = screen.getByPlaceholderText('rules.valueHint.fire_event')
    const list = document.getElementById(input.getAttribute('list'))
    expect([...list.options].map(o => o.value)).toEqual(['task.done', 'deploy.requested'])
  })
})

describe('fire_event says where the event goes', () => {
  const pickEvent = (value) => {
    setup()
    fireEvent.click(screen.getByText('Edit'))
    const typeSelect = screen.getAllByRole('combobox').find(s => s.value === 'set_priority')
    fireEvent.change(typeSelect, { target: { value: 'fire_event' } })
    fireEvent.change(screen.getByPlaceholderText('rules.valueHint.fire_event'), { target: { value } })
  }

  it('names how many integrations would receive it', () => {
    pickEvent('task.done')
    expect(screen.getByText(/rules.eventSubscribers.*"n":2/)).toBeTruthy()
  })

  it('warns when the event reaches nobody, and says where to fix it', () => {
    // The action's whole effect happens on another page. Firing an event nobody
    // subscribes to is the silent empty set this ADR line keeps closing (ADR-0047).
    pickEvent('deploy.requested')
    expect(screen.getByText('rules.eventNoSubscribers')).toBeTruthy()
  })

  it('is named by its destination, in every language', async () => {
    // Not asserted through the mocked t(): the point is that both catalogues carry the
    // rename, since "Fire Event" is what nobody could interpret in the first place.
    const en = (await import('../../i18n/en.json')).default
    const zh = (await import('../../i18n/zh-TW.json')).default
    expect(en['rules.action.fire_event']).toBeTruthy()
    expect(zh['rules.action.fire_event']).toBeTruthy()
  })
})

describe('an action that only works on tasks says so', () => {
  it('names them while the trigger can still land on anything', () => {
    setup()
    fireEvent.click(screen.getByText('Edit'))
    // node.updated fires for projects and labels too (ADR-0049/0055); set_priority is
    // skipped on all of them, which used to be discoverable only from the activity feed.
    expect(screen.getByText(/rules.taskOnlyActions.*set_priority/)).toBeTruthy()
  })
})
