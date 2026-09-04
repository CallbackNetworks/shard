import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))

const mockUseQuery = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
  useQueryClient: () => ({ setQueryData: vi.fn() }),
}))

vi.mock('../../../api/client', () => ({
  getWorkflowRules: vi.fn(),
  getIntegrations: vi.fn(),
  getPreference: vi.fn(),
  setPreference: vi.fn(),
}))

import OnboardingChecklist from '../OnboardingChecklist'

// The component runs three queries: rules, integrations, the dismissal preference.
// Keyed off the queryKey so a reordering of the calls does not silently change
// which fixture each one gets.
function mockQueries({ rules = [], integrations = [], dismissed = undefined } = {}) {
  mockUseQuery.mockImplementation(({ queryKey }) => {
    const key = JSON.stringify(queryKey)
    if (key.includes('workflow-rules')) return { data: rules }
    if (key.includes('integrations')) return { data: integrations }
    return { data: dismissed }
  })
}

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('OnboardingChecklist', () => {
  it('shows every step and points at the first outstanding one', () => {
    mockQueries()
    wrap(<OnboardingChecklist projects={[]} decisions={[]} />)
    expect(screen.getByText('onboarding.stepProject')).toBeInTheDocument()
    expect(screen.getByText('onboarding.stepAutomate')).toBeInTheDocument()
    // Only the next step gets a hint: six hints at once is a paragraph.
    expect(screen.getByText('onboarding.stepProjectHint')).toBeInTheDocument()
    expect(screen.queryByText('onboarding.stepTaskHint')).toBeNull()
  })

  // Finishing is its own dismissal — asking somebody to close a congratulation is a
  // small rudeness, and a panel reading "6 of 6" is asking to be closed.
  it('removes itself once everything is done', () => {
    mockQueries({ rules: [{ id: 'r1' }] })
    const { container } = wrap(
      <OnboardingChecklist
        projects={[{ id: 'p1', tasks: [{ id: 't1', due_date: '2026-01-01', labels: [{ id: 'l1' }] }] }]}
        decisions={[{ id: 'd1' }]}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('stays hidden once dismissed', () => {
    mockQueries({ dismissed: { value: { dismissed: true } } })
    const { container } = wrap(<OnboardingChecklist projects={[]} decisions={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers the guide', () => {
    mockQueries()
    wrap(<OnboardingChecklist projects={[]} decisions={[]} />)
    expect(screen.getByText('onboarding.readGuide').closest('a')).toHaveAttribute('href', '/guide')
  })
})
