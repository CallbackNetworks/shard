import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import NodeShareFacet from '../NodeShareFacet'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  useQuery: vi.fn(),
  mutate: vi.fn(),
  rotateNodeShareToken: vi.fn(),
  setNodeSharePin: vi.fn(),
  clearNodeSharePin: vi.fn(),
  setNodeShareExpiry: vi.fn(),
  setNodeGuestNotes: vi.fn(() => Promise.resolve()),
  getNodeShareViews: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, opts) => (opts && 'n' in opts ? `${key}:${opts.n}` : key) }),
}))

// The mutation under test is identified by the client function it calls, so the
// stub runs mutationFn directly instead of pretending to be react-query.
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mocks.useQuery(...args),
  useMutation: ({ mutationFn, onSuccess }) => ({
    mutate: (arg) => { mutationFn(arg); onSuccess?.() },
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock('../../api/client', () => ({
  rotateNodeShareToken: mocks.rotateNodeShareToken,
  setNodeSharePin: mocks.setNodeSharePin,
  clearNodeSharePin: mocks.clearNodeSharePin,
  setNodeShareExpiry: mocks.setNodeShareExpiry,
  setNodeGuestNotes: mocks.setNodeGuestNotes,
  getNodeShareViews: mocks.getNodeShareViews,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useQuery.mockReturnValue({ data: { view_count: 0 } })
})

describe('NodeShareFacet', () => {
  // A raw Node keeps its share state under `data`; the enriched identity/project
  // reads flatten it onto the top level. Both reach this component, so both must
  // produce the same panel — the shape must not decide what the user can do.
  it.each([
    ['a node with data', { id: 'n1', data: { share_token: 'tok', allow_guest_notes: true } }],
    ['a flattened entity read', { id: 'n1', share_token: 'tok', allow_guest_notes: true }],
  ])('reads share state from %s', (_label, node) => {
    render(<NodeShareFacet node={node} subscribable />)

    expect(screen.getByTitle(`${window.location.origin}/share/n/tok`)).toBeTruthy()
    expect(screen.getByTitle(`${window.location.origin}/ical/node/tok.ics`)).toBeTruthy()
    expect(screen.getByLabelText('nodeShare.guestNotes').checked).toBe(true)
  })

  it('shows the create button and no controls when there is no token', () => {
    render(<NodeShareFacet node={{ id: 'n1', data: {} }} />)

    expect(screen.getByText('nodeShare.create')).toBeTruthy()
    expect(screen.queryByLabelText('nodeShare.guestNotes')).toBeNull()
  })

  it('toggles guest notes through the generic node endpoint', () => {
    render(<NodeShareFacet node={{ id: 'n1', share_token: 'tok', allow_guest_notes: false }} />)

    fireEvent.click(screen.getByLabelText('nodeShare.guestNotes'))

    expect(mocks.setNodeGuestNotes).toHaveBeenCalledWith('n1', true)
  })

  it('reports the view count the server returns', () => {
    mocks.useQuery.mockReturnValue({ data: { view_count: 12 } })
    render(<NodeShareFacet node={{ id: 'n1', share_token: 'tok' }} />)

    expect(screen.getByText('nodeShare.views:12')).toBeTruthy()
  })

  it('only asks for the view count once a share link exists', () => {
    render(<NodeShareFacet node={{ id: 'n1', data: {} }} />)

    expect(mocks.useQuery).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  })

  it('refreshes the caller-named query key, not just the node key', () => {
    render(<NodeShareFacet node={{ id: 'n1', share_token: 'tok' }} invalidateKeys={[['identities']]} />)

    fireEvent.click(screen.getByLabelText('nodeShare.guestNotes'))

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['identities'] })
    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['node', 'n1'] })
  })
})
