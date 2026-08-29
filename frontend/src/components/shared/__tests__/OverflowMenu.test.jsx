import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

import OverflowMenu from '../OverflowMenu'

const renderMenu = (items) => render(
  <MemoryRouter>
    <OverflowMenu items={items} />
  </MemoryRouter>
)

describe('OverflowMenu', () => {
  it('keeps its items closed until asked, then runs the one clicked', () => {
    const onClick = vi.fn()
    renderMenu([{ key: 'export', label: 'Export', onClick }])
    expect(screen.queryByText('Export')).toBeNull()

    fireEvent.click(screen.getByLabelText('more'))
    // mousedown first, the way a real pointer does it: the menu is portalled out of the
    // component's own subtree, so an outside-click guard that only knows about the root
    // closes it on mousedown and the item's click then lands on a removed node.
    const item = screen.getByText('Export')
    fireEvent.mouseDown(item)
    fireEvent.click(item)
    expect(onClick).toHaveBeenCalled()
    // Acting closes it; a menu left open over the card it belongs to hides the card.
    expect(screen.queryByText('Export')).toBeNull()
  })

  it('renders a navigating item as a real anchor', () => {
    // Middle-click and copy-link are the reason: a button that navigates loses both,
    // silently, on the one control whose whole job is to go somewhere.
    renderMenu([{ key: 'node', label: 'Open node', href: '/n/d1' }])
    fireEvent.click(screen.getByLabelText('more'))
    expect(screen.getByText('Open node').closest('a').getAttribute('href')).toBe('/n/d1')
  })

  it('closes when the pointer goes down outside it', () => {
    renderMenu([{ key: 'a', label: 'Alpha', onClick: vi.fn() }])
    fireEvent.click(screen.getByLabelText('more'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('Alpha')).toBeNull()
  })

  it('closes on Escape', () => {
    renderMenu([{ key: 'a', label: 'Alpha', onClick: vi.fn() }])
    fireEvent.click(screen.getByLabelText('more'))
    expect(screen.getByText('Alpha')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Alpha')).toBeNull()
  })

  it('draws no trigger when it would open onto nothing', () => {
    const { container } = renderMenu([])
    expect(container.innerHTML).toBe('')
  })
})
