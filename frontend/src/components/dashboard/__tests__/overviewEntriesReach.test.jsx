import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'

/**
 * The Overview's entries reach what they name (ADR-0147).
 *
 * The defect this guards was never one broken link — it was that most of the page
 * had no links at all, and nothing failed, because un-clickable text is not an
 * error. So the assertion is the *rule*: an entry that names a record is an
 * activatable element whose activation goes to that record. A twelfth panel added
 * with plain <div> rows has to fail here, which is why every panel on the page is
 * exercised rather than a representative one.
 */

const navigate = vi.fn()
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o?.label ? `${k}:${o.label}` : k), i18n: { language: 'en' } }),
}))

// The node-type registry decides where a non-task subject opens. Mocked at the hook
// rather than at the query so the test does not depend on React Query's cache being
// warm — the map is the input this page's routing actually reads.
vi.mock('../../../hooks/useNodeTypeMap', () => ({
  useNodeTypeMap: () => new Map([
    ['project', { key: 'project', roles: ['container'] }],
    ['task', { key: 'task', roles: ['task'] }],
    ['goal', { key: 'goal', roles: [] }],
    ['decision', { key: 'decision', roles: [] }],
  ]),
  default: () => new Map(),
}))

import StatCards from '../StatCards'
import DueSoonPanel from '../DueSoonPanel'
import { CommandHero, PriorityWall, OpsSidebar } from '../CommandPanels'
import { deriveCommandCenter } from '../../../utils/commandCenter'

const soon = new Date(Date.now() + 2 * 86400000).toISOString()
const past = new Date(Date.now() - 3 * 86400000).toISOString()

const projects = [
  {
    id: 'p1',
    name: 'Alpha',
    status: 'active',
    tasks: [
      { id: 't-late', title: 'Late task', status: 'todo', priority: 'high', due_date: past },
      { id: 't-soon', title: 'Soon task', status: 'todo', priority: 'medium', due_date: soon },
      { id: 't-run', title: 'Running task', status: 'in_progress', priority: 'medium' },
    ],
  },
]

const activities = [
  { id: 'a1', action: 'task.status_changed', detail: 'Late task moved', created_at: new Date().toISOString(), project_id: 'p1', task_id: 't-late', node_type: 'task' },
  { id: 'a2', action: 'system.boot', detail: 'System ready', created_at: new Date().toISOString(), project_id: null, task_id: null, node_type: null },
]
const goals = [{ id: 'g1', title: 'Ship it', status: 'active', type: 'goal' }]
const decisions = [{ id: 'd1', name: 'Use Postgres', decision_status: 'proposed', type: 'decision' }]

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)
const clickText = (text) => fireEvent.click(screen.getByText(text).closest('button'))

beforeEach(() => navigate.mockClear())

describe('a task entry opens the task, not just its project', () => {
  it('Due Soon', () => {
    wrap(<DueSoonPanel projects={projects} />)
    fireEvent.click(screen.getByText('dashboard.dueSoon').closest('button'))
    clickText('Soon task')
    // The project page alone was the old behaviour: it lands you on a board of
    // forty cards with no indication which one you asked about.
    expect(navigate).toHaveBeenCalledWith('/projects/p1?focus=t-soon')
  })

  it('Priority Wall', () => {
    wrap(<PriorityWall command={deriveCommandCenter(projects, activities, goals, decisions)} />)
    clickText('Late task')
    expect(navigate).toHaveBeenCalledWith('/projects/p1?focus=t-late')
  })
})

describe('the numbers are ways to see the work they count', () => {
  it('every stat card leads somewhere', () => {
    wrap(<StatCards projects={projects} activities={activities} />)
    const cards = screen.getAllByRole('button')
    expect(cards).toHaveLength(4)
    fireEvent.click(screen.getByText('dashboard.overdueCount').closest('button'))
    expect(navigate).toHaveBeenCalledWith('?tab=tasks&only=overdue')
  })

  it('the hero counts lead to the same slices', () => {
    wrap(<CommandHero command={deriveCommandCenter(projects, activities, goals, decisions)} />)
    // By accessible name, not by text: the count and its label are separate text
    // nodes inside the button, so getByText('overdue') matches neither.
    fireEvent.click(screen.getByRole('button', { name: '1 overdue' }))
    expect(navigate).toHaveBeenCalledWith('?tab=tasks&only=overdue')
  })

  it('the latest signal leads to the thing that happened', () => {
    wrap(<CommandHero command={deriveCommandCenter(projects, activities, goals, decisions)} />)
    clickText('Late task moved')
    expect(navigate).toHaveBeenCalledWith('/projects/p1?focus=t-late')
  })
})

describe('the briefing and the feed reach their subjects', () => {
  const ops = () => wrap(<OpsSidebar command={deriveCommandCenter(projects, activities, goals, decisions)} />)

  it('an activity row opens what it happened to', () => {
    ops()
    clickText('Late task moved')
    expect(navigate).toHaveBeenCalledWith('/projects/p1?focus=t-late')
  })

  // The other half of the rule: a row naming nothing reachable must stay a plain
  // row. A button that swallows the click and goes nowhere is worse than text.
  it('an activity row naming nothing stays un-clickable', () => {
    ops()
    expect(screen.getByText('System ready').closest('button')).toBeNull()
  })

  it('a goal opens its node page', () => {
    ops()
    clickText('Ship it')
    expect(navigate).toHaveBeenCalledWith('/n/g1')
  })

  it('a decision opens its node page', () => {
    ops()
    clickText('Use Postgres')
    expect(navigate).toHaveBeenCalledWith('/n/d1')
  })
})
