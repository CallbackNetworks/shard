/**
 * Editing an integration must not delete the credentials it was never shown (ADR-0063).
 *
 * The backend withholds a stored credential as `null` and reads `null` back as "unchanged",
 * so the whole safety property rests on the form preserving that null. `|| ''` instead of
 * `?? ''` turns it into an empty string, which the server reads as "clear it" — the form is
 * load-bearing here, so it is tested through the real component rather than around it.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k, i18n: { language: 'en' } }),
}))

vi.mock('../../hooks/useBreakpoint', () => ({ default: () => 'desktop' }))

const INTEGRATION = {
  id: 'int-1',
  name: 'Signed hook',
  type: 'webhook',
  url: 'https://example.com/hook',
  secret_set: true,
  auth_type: 'basic',
  // Exactly what the server serves: the username readable, the password withheld.
  auth_config: { username: 'alice', password: null },
  custom_headers: { 'X-Api-Token': null },
  events: ['task.done'],
  sources: [],
  active: true,
  project_id: null,
  created_at: '2026-08-06T00:00:00Z',
}

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }) => {
    if (queryKey[0] === 'integrations') return { data: [INTEGRATION], isLoading: false }
    return { data: [], isLoading: false }
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

const saved = vi.fn()
vi.mock('../../hooks/useCrudMutations', () => ({
  useInvalidatingMutation: ({ mutationFn }) => ({
    mutate: (args) => { if (mutationFn.name === 'updateIntegration') saved(args); else saved(args) },
    isPending: false,
  }),
}))

vi.mock('../../api/client', () => ({
  getIntegrations: vi.fn(),
  createIntegration: vi.fn(),
  updateIntegration: function updateIntegration() {},
  deleteIntegration: vi.fn(),
  testIntegration: vi.fn(),
  getIntegrationTemplates: vi.fn(),
  getIntegrationTemplate: vi.fn(),
  getIntegrationEvents: vi.fn(),
  getIntegrationSources: vi.fn(),
}))

vi.mock('../../components/integrations/DeliveryLog', () => ({ default: () => null }))
vi.mock('../../components/integrations/HealthStats', () => ({ default: () => null }))

const { default: Integrations } = await import('../Integrations')

const openEditor = () => {
  render(<Integrations />)
  fireEvent.click(screen.getByText('edit'))
}

const savedPayload = () => saved.mock.calls.at(-1)[0].data

describe('editing an integration with withheld credentials', () => {
  beforeEach(() => saved.mockClear())

  it('sends the untouched password back as null, not as an empty string', () => {
    openEditor()
    fireEvent.click(screen.getByText('save'))

    expect(savedPayload().auth_config).toEqual({ username: 'alice', password: null })
  })

  it('sends untouched custom header values back as null', () => {
    openEditor()
    fireEvent.click(screen.getByText('save'))

    expect(savedPayload().custom_headers).toEqual({ 'X-Api-Token': null })
  })

  it('omits the secret when the box is left empty', () => {
    openEditor()
    fireEvent.click(screen.getByText('save'))

    expect(savedPayload().secret).toBeNull()
  })

  it('sends a password the user actually typed', () => {
    openEditor()
    const pw = document.querySelector('input[type="password"]')
    fireEvent.change(pw, { target: { value: 'typed-in' } })
    fireEvent.click(screen.getByText('save'))

    expect(savedPayload().auth_config.password).toBe('typed-in')
  })

  it('does not send secret_set back as a field', () => {
    openEditor()
    fireEvent.click(screen.getByText('save'))

    expect(savedPayload()).not.toHaveProperty('secret_set')
  })
})
