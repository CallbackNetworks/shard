import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import NodeFieldsPanel from '../NodeFieldsPanel'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  updateNode: vi.fn(() => Promise.resolve()),
  getManagedDataKeys: vi.fn(),
  managed: { keys: ['share_token', 'share_pin_set', 'callback_token', 'allow_guest_notes'] },
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.managed }),
  useMutation: ({ mutationFn, onSuccess }) => ({
    mutate: () => { mutationFn(); onSuccess?.() },
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock('../../api/client', () => ({ updateNode: mocks.updateNode, getManagedDataKeys: mocks.getManagedDataKeys }))

const identityType = {
  key: 'identity',
  fields: [
    { key: 'color', label: 'Colour', kind: 'color' },
    { key: 'avatar', label: 'Avatar', kind: 'emoji', max_length: 2 },
    { key: 'description', label: 'Description', kind: 'longtext' },
  ],
}

beforeEach(() => vi.clearAllMocks())

describe('NodeFieldsPanel', () => {
  it('draws a widget per declared kind, with the node values in them', () => {
    render(<NodeFieldsPanel
      node={{ id: 'n1', data: { color: '#818cf8', avatar: 'PO', description: 'Delivery work' } }}
      typeMeta={identityType} />)

    expect(screen.getByLabelText('Avatar').value).toBe('PO')
    expect(screen.getByLabelText('Description').tagName).toBe('TEXTAREA')
    expect(screen.getByLabelText('Description').value).toBe('Delivery work')
    // A colour is a swatch row, not a text box the user has to know hex for.
    expect(screen.getByLabelText('#818cf8')).toBeTruthy()
  })

  it('saves only what changed, through the generic node write', () => {
    render(<NodeFieldsPanel
      node={{ id: 'n1', data: { color: '#818cf8', avatar: 'PO', description: 'old' } }}
      typeMeta={identityType} />)

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'new' } })
    fireEvent.click(screen.getByText('save'))

    expect(mocks.updateNode).toHaveBeenCalledWith('n1', { data: { description: 'new' } })
  })

  it('offers nothing to save until something changes', () => {
    render(<NodeFieldsPanel node={{ id: 'n1', data: { avatar: 'PO' } }} typeMeta={identityType} />)
    expect(screen.queryByText('save')).toBeNull()
  })

  it('renders an enum as a picker of exactly its options', () => {
    render(<NodeFieldsPanel
      node={{ id: 'l1', data: { type: 'decision' } }}
      typeMeta={{ key: 'label', fields: [{ key: 'type', label: 'Kind', kind: 'enum', options: ['label', 'decision'] }] }} />)

    const select = screen.getByLabelText('Kind')
    expect(select.tagName).toBe('SELECT')
    expect([...select.options].map(o => o.value)).toEqual(['', 'label', 'decision'])
    expect(select.value).toBe('decision')
  })

  it('shows keys the type never declared instead of hiding them', () => {
    // Six nodes in the live database carry keys like these; a schema-only editor
    // would leave them visible to API callers only.
    render(<NodeFieldsPanel
      node={{ id: 'p1', data: { description: 'x', pager_rotation: 'primary' } }}
      typeMeta={{ key: 'project', fields: [{ key: 'description', label: 'Description', kind: 'longtext' }] }} />)

    expect(screen.getByText('pager_rotation')).toBeInTheDocument()
    expect(screen.getByText('primary')).toBeInTheDocument()
  })

  it('leaves a feature\'s own keys out of the undeclared list', () => {
    // They are real and they are served, but the share panel below shows them properly.
    // Listing a share token under "not declared by this type" reads like leftover junk.
    render(<NodeFieldsPanel
      node={{ id: 'i1', data: { avatar: 'PC', share_token: 'tok', share_pin_set: true, allow_guest_notes: false, pager_rotation: 'primary' } }}
      typeMeta={identityType} />)

    expect(screen.queryByText('share_token')).toBeNull()
    expect(screen.queryByText('share_pin_set')).toBeNull()
    expect(screen.queryByText('allow_guest_notes')).toBeNull()
    expect(screen.getByText('pager_rotation')).toBeInTheDocument()
  })

  it('renders nothing at all for a type with no fields and a bare node', () => {
    const { container } = render(<NodeFieldsPanel node={{ id: 'n1', data: {} }} typeMeta={{ key: 'topic' }} />)
    expect(container.firstChild).toBeNull()
  })

  it('forgets a half-typed edit when the node changes underneath it', () => {
    const { rerender } = render(
      <NodeFieldsPanel node={{ id: 'n1', data: { avatar: 'AA' } }} typeMeta={identityType} />)
    fireEvent.change(screen.getByLabelText('Avatar'), { target: { value: 'ZZ' } })
    expect(screen.getByText('save')).toBeTruthy()

    rerender(<NodeFieldsPanel node={{ id: 'n2', data: { avatar: 'BB' } }} typeMeta={identityType} />)

    expect(screen.getByLabelText('Avatar').value).toBe('BB')
    expect(screen.queryByText('save')).toBeNull()
  })
})
