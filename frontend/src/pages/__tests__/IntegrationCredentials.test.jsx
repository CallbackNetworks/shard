/**
 * Editing an integration must not delete the credentials it was never shown (ADR-0063).
 *
 * The backend withholds a stored credential as `null` and reads `null` back as "unchanged",
 * so the property under test is that the null survives the round trip through form state
 * untouched. Normalising it to `''` anywhere between opening the editor and submitting —
 * most plausibly when seeding the form — turns "leave it alone" into "clear it". The input
 * bindings are not what carries this (`v ?? ''` and `v || ''` are identical for null); only
 * the value actually submitted is, so this runs the real component and reads the payload.
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
