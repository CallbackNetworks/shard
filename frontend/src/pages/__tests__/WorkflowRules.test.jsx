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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key) }),
}))

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
  action_value_enums: {},
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
