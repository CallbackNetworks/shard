import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, params) => params?.count !== undefined ? `${key}:${params.count}` : key }),
}))

const mockUseQuery = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
}))

const getDecisionsGoverning = vi.fn()
vi.mock('../../api/client', () => ({ getDecisionsGoverning: (...a) => getDecisionsGoverning(...a) }))

import GoverningDecisions from '../GoverningDecisions'

function setup(data) {
  mockUseQuery.mockImplementation(({ queryKey, queryFn }) => {
    expect(queryKey[0]).toBe('governing-decisions')
    expect(typeof queryFn).toBe('function')
    return { data }
  })
  return render(
    <MemoryRouter>
      <GoverningDecisions nodeId="t1" />
    </MemoryRouter>
  )
}

describe('GoverningDecisions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('names the decisions that govern the node, with their status', () => {
    // ADR-0118 gave `governs` a read endpoint, a reverse read endpoint and two client
    // helpers, and no caller for any of them: a decision could say what it governed and
    // the governed work could not say what decided it.
    setup([
      { id: 'd1', name: 'Use PostgreSQL', decision_status: 'accepted' },
      { id: 'd2', name: 'Cache in Redis', decision_status: 'superseded' },
    ])
    expect(screen.getByText('decisions.governedBy:2')).toBeTruthy()
    expect(screen.getByText('Use PostgreSQL')).toBeTruthy()
    // The status travels with the chip: work run on thinking that has been replaced is
    // the case worth seeing without opening the record.
    expect(screen.getByText('decisions.superseded')).toBeTruthy()
    expect(screen.getByText('Cache in Redis').closest('a').getAttribute('href')).toBe('/n/d2')
  })

  it('renders nothing when nothing governs the node', () => {
    // Every node page mounts this; almost no node has an answer yet, so an empty
    // heading would be a row of noise on every page in the app.
    const { container } = setup([])
    expect(container.innerHTML).toBe('')
  })
})
