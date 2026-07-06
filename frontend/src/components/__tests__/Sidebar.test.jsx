import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

import Sidebar from '../Sidebar'

function setup(options = {}) {
  const { onOpenPalette = vi.fn() } = options

  const utils = render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar onOpenPalette={onOpenPalette} />
    </MemoryRouter>
  )

  return { ...utils, onOpenPalette }
}

describe('Sidebar', () => {
  it('renders the brand text', () => {
    setup()
    expect(screen.getByText('SHARD')).toBeTruthy()
  })

  it('renders nav links for main sections', () => {
    setup()
    expect(screen.getByText('nav.commandCenter')).toBeTruthy()
    expect(screen.getByText('nav.identities')).toBeTruthy()
    expect(screen.getByText('nav.integrations')).toBeTruthy()
    expect(screen.getByText('nav.apiKeys')).toBeTruthy()
    expect(screen.getByText('nav.analytics')).toBeTruthy()
    expect(screen.getByText('nav.workflowRules')).toBeTruthy()
    expect(screen.getByText('nav.goals')).toBeTruthy()
    expect(screen.getByText('nav.settings')).toBeTruthy()
  })

  it('does not load project data in module navigation', () => {
    setup()
    expect(screen.queryByLabelText('Project signals')).toBeNull()
    expect(screen.queryByText('nav.projects')).toBeNull()
  })

  it('calls onOpenPalette when search button is clicked', () => {
    const onOpenPalette = vi.fn()
    setup({ onOpenPalette })
    const searchButton = screen.getByText('search').closest('button')
    fireEvent.click(searchButton)
    expect(onOpenPalette).toHaveBeenCalledTimes(1)
  })

  it('renders language switcher with EN and Chinese buttons', () => {
    setup()
    expect(screen.getByText('EN')).toBeTruthy()
    expect(screen.getByText('nav.language')).toBeTruthy()
  })

  it('renders the status page link', () => {
    setup()
    expect(screen.getByText('nav.statusPage')).toBeTruthy()
  })
})
