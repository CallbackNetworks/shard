import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, vars) => (vars ? `${k}:${JSON.stringify(vars)}` : k) }),
}))

const focus = vi.hoisted(() => ({
  focusTargets: [],
  focusId: null,
  focusTarget: null,
  setFocusId: vi.fn(),
}))
vi.mock('../../context/IdentityFocusContext', () => ({
  useIdentityFocus: () => focus,
}))

import FocusSwitcher from '../FocusSwitcher'

const IDENTITIES = [
  { id: 'a', name: 'Platform Ops', type: 'identity', color: '#22d3ee', avatar: 'PO', project_count: 4 },
  { id: 'b', name: 'Design Broadcast', type: 'identity', color: '#f472b6', avatar: 'DB', project_count: 2 },
  { id: 'c', name: 'Product Control', type: 'identity', color: '#facc15', avatar: 'PC', project_count: 7 },
]

function setup({ open = false, targets = IDENTITIES, focusId = null } = {}) {
  focus.focusTargets = targets
  focus.focusId = focusId
  focus.focusTarget = targets.find(i => i.id === focusId) || null
  const onOpenChange = vi.fn()
  const utils = render(<FocusSwitcher open={open} onOpenChange={onOpenChange} />)
  return { ...utils, onOpenChange }
}

beforeEach(() => {
  focus.setFocusId.mockClear()
})

describe('FocusSwitcher', () => {
  // The defect the redesign fixes: N identities used to mean N rail rows.
  it('occupies one rail row regardless of how many targets exist', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, name: `P${i}`, type: 'identity', color: '#fff' }))
    const { container } = setup({ targets: many })
    expect(container.querySelectorAll('.kt-mini-nav-button').length).toBe(1)
  })

  it('renders nothing when there are no focus targets', () => {
    const { container } = setup({ targets: [] })
    expect(container.firstChild).toBeNull()
  })

  it('shows the focused identity on the trigger', () => {
    setup({ focusId: 'a' })
    expect(screen.getByText('Platform Ops')).toBeTruthy()
    expect(screen.getByText('PO')).toBeTruthy()
  })

  it('falls back to the neutral label when nothing is focused', () => {
    setup()
    expect(screen.getByRole('button', { name: 'focus.title' })).toBeTruthy()
  })

  it('asks to open when the trigger is clicked', () => {
    const { onOpenChange } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'focus.title' }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('lists every target plus a no-focus option when open', () => {
    setup({ open: true })
    const options = screen.getAllByRole('option')
    expect(options.length).toBe(IDENTITIES.length + 1)
    expect(options[0].textContent).toContain('focus.allTargets')
  })

  it('marks the focused target as the selected option', () => {
    setup({ open: true, focusId: 'b' })
    const selected = screen.getAllByRole('option').filter(o => o.getAttribute('aria-selected') === 'true')
    expect(selected.length).toBe(1)
    expect(selected[0].textContent).toContain('Design Broadcast')
  })

  it('filters the list by the search box', () => {
    setup({ open: true })
    fireEvent.change(screen.getByLabelText('focus.searchPlaceholder'), { target: { value: 'design' } })
    const names = screen.getAllByRole('option').map(o => o.textContent)
    expect(names.some(n => n.includes('Design Broadcast'))).toBe(true)
    expect(names.some(n => n.includes('Platform Ops'))).toBe(false)
  })

  it('reports no matches without dropping the no-focus option', () => {
    setup({ open: true })
    fireEvent.change(screen.getByLabelText('focus.searchPlaceholder'), { target: { value: 'zzz' } })
    expect(screen.getByText('focus.noMatches')).toBeTruthy()
    expect(screen.getAllByRole('option').length).toBe(1)
  })

  it('sets focus and closes when a target is picked', () => {
    const { onOpenChange } = setup({ open: true })
    fireEvent.click(screen.getByText('Product Control'))
    expect(focus.setFocusId).toHaveBeenCalledWith('c')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // Clearing is a value of the same control, not a separate button that only
  // appears once a focus is active.
  it('clears focus through the no-focus option', () => {
    setup({ open: true, focusId: 'a' })
    fireEvent.click(screen.getByText('focus.allTargets'))
    expect(focus.setFocusId).toHaveBeenCalledWith(null)
  })

  it('picks the keyboard-highlighted option on Enter', () => {
    setup({ open: true })
    const input = screen.getByLabelText('focus.searchPlaceholder')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(focus.setFocusId).toHaveBeenCalledWith('a')
  })

  it('closes on Escape', () => {
    const { onOpenChange } = setup({ open: true })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes on an outside click', () => {
    const { onOpenChange } = setup({ open: true })
    fireEvent.mouseDown(document.body)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // ADR-0081: focus targets are not only identities — a container-role custom
  // type (e.g. "organization") is a valid target and shows its own type label.
  it('mixes non-identity targets in and labels them by their own type', () => {
    const mixed = [
      ...IDENTITIES,
      { id: 'org1', name: 'CGCG', type: 'organization', type_label: 'Organization', color: '#f59e0b', project_count: 1 },
    ]
    setup({ open: true, targets: mixed })
    const options = screen.getAllByRole('option')
    expect(options.length).toBe(mixed.length + 1)
    const orgOption = options.find(o => o.textContent.includes('CGCG'))
    expect(orgOption.textContent).toContain('Organization')
    const identityOption = options.find(o => o.textContent.includes('Platform Ops'))
    expect(identityOption.textContent).toContain('focus.typeIdentity')
  })
})
