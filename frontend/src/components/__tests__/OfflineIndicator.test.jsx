import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import OfflineIndicator from '../OfflineIndicator'
import useOfflineSync from '../../hooks/useOfflineSync'

vi.mock('../../hooks/useOfflineSync', () => ({
  default: vi.fn(),
}))

function mockOfflineSync(overrides = {}) {
  useOfflineSync.mockReturnValue({
    isOnline: true,
    pendingCount: 0,
    syncing: false,
    syncPending: vi.fn(),
    ...overrides,
  })
}

describe('OfflineIndicator', () => {
  it('renders nothing when online by default', () => {
    mockOfflineSync()

    const { container } = render(<OfflineIndicator />)

    expect(container.firstChild).toBeNull()
  })

  it('shows offline indicator when isOffline=true', () => {
    mockOfflineSync({ isOnline: false })

    render(<OfflineIndicator />)

    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('displays pending count when pendingCount > 0', () => {
    mockOfflineSync({ pendingCount: 3 })

    render(<OfflineIndicator />)

    expect(screen.getByText('3 pending changes')).toBeInTheDocument()
  })

  it('shows sync message when syncing', () => {
    mockOfflineSync({ pendingCount: 1, syncing: true })

    render(<OfflineIndicator />)

    expect(screen.getByText('Syncing...')).toBeInTheDocument()
  })
})
