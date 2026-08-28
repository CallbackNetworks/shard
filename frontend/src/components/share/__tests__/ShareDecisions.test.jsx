import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ShareDecisions from '../ShareDecisions'

const ref = (id, title) => ({ id, title })

function projects(decisions, { name = 'Shard', id = 'p1' } = {}) {
  return [{ id, name, decisions }]
}

describe('ShareDecisions', () => {
  it('renders nothing when the share carries no decisions', () => {
    const { container } = render(<ShareDecisions projects={projects([])} />)
    expect(container.firstChild).toBeNull()
  })

  it('states a decision and its status', () => {
    render(<ShareDecisions projects={projects([
      { id: 'd1', name: 'Use PostgreSQL', decision_status: 'accepted', description: 'Because locks.' },
    ])} />)
    expect(screen.getByText('Use PostgreSQL')).toBeTruthy()
    expect(screen.getByText('accepted')).toBeTruthy()
    expect(screen.getByText('Because locks.')).toBeTruthy()
  })

  it('nests a replaced decision under the one that replaced it', () => {
    // The same lineage rule the owner's page uses (ADR-0118), so a visitor reading an old
    // record can see it is old — the status word alone never said by what.
    const { container } = render(<ShareDecisions projects={projects([
      { id: 'new', name: 'Use PostgreSQL', decision_status: 'accepted', supersedes: [ref('old', 'Use MySQL')] },
      { id: 'old', name: 'Use MySQL', decision_status: 'superseded', superseded_by: [ref('new', 'Use PostgreSQL')] },
    ])} />)
    expect(screen.getByText('replaced by the decision above')).toBeTruthy()
    const depths = [...container.querySelectorAll('[data-depth]')].map(e => e.getAttribute('data-depth'))
    expect(depths).toEqual(['0', '1'])
  })

  it('names the work a decision governs', () => {
    render(<ShareDecisions projects={projects([
      { id: 'd1', name: 'Use PostgreSQL', decision_status: 'accepted', governs: [ref('t1', 'Migrate the schema')] },
    ])} />)
    expect(screen.getByText('Migrate the schema')).toBeTruthy()
  })

  it('expands a long record on click rather than truncating it forever', () => {
    const body = 'x'.repeat(400)
    render(<ShareDecisions projects={projects([
      { id: 'd1', name: 'Long one', decision_status: 'accepted', description: body },
    ])} />)
    expect(screen.queryByText(body)).toBeNull()
    fireEvent.click(screen.getByText('Long one'))
    expect(screen.getByText(body)).toBeTruthy()
  })

  it('groups by project only when there is more than one', () => {
    const one = render(<ShareDecisions projects={projects([{ id: 'd1', name: 'A', decision_status: 'accepted' }])} />)
    expect(one.queryByText('Shard')).toBeNull()
    one.unmount()

    render(<ShareDecisions projects={[
      { id: 'p1', name: 'Shard', decisions: [{ id: 'd1', name: 'A', decision_status: 'accepted' }] },
      { id: 'p2', name: 'Relay', decisions: [{ id: 'd2', name: 'B', decision_status: 'accepted' }] },
    ]} />)
    expect(screen.getByText('Shard')).toBeTruthy()
    expect(screen.getByText('Relay')).toBeTruthy()
  })
})
