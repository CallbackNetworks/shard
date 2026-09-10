import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import GlobalActivityTicker from '../GlobalActivityTicker'

/**
 * The ticker draws three integers, and it asks for three integers (ADR-0158).
 *
 * It used to fetch `getProjects()` — every project with every task embedded, ~327KB
 * against production — and recount overdue in the browser with a second copy of the
 * rule ADR-0089 says has exactly one. Mounted in the layout, that ran on every page
 * and again every 60 seconds, and the node page's own requests queued behind it.
 *
 * So the assertion that matters is not only that the numbers render: it is that
 * `getProjects` is never called. A regression here has no visual symptom — the
 * numbers would still be right — which is precisely why it needs a test.
 */

const mocks = vi.hoisted(() => ({
  getActivity: vi.fn(),
  getAnalyticsOverview: vi.fn(),
  getActivityWatches: vi.fn(),
  createActivityWatch: vi.fn(),
  deleteActivityWatch: vi.fn(),
  getProjects: vi.fn(),
}))

// jsdom has no ResizeObserver; the marquee measures its own loop width with one.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, opts) => (opts?.count != null ? `${key}:${opts.count}` : key) }),
}))
vi.mock('../../api/client', () => mocks)

function renderTicker() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <GlobalActivityTicker />
    </QueryClientProvider>,
  )
}

describe('GlobalActivityTicker', () => {
  it('draws the counts the server computed, and never fetches the project list', async () => {
    mocks.getActivity.mockResolvedValue([])
    mocks.getActivityWatches.mockResolvedValue([])
    mocks.getAnalyticsOverview.mockResolvedValue({
      overdue_tasks: 7,
      failed_tasks: 2,
      high_priority_active_tasks: 5,
    })

    renderTicker()

    await waitFor(() => expect(mocks.getAnalyticsOverview).toHaveBeenCalled())
    await screen.findAllByText(/ticker\.overdueTasks:7/)
    await screen.findAllByText(/ticker\.failedTasks:2/)
    await screen.findAllByText(/ticker\.highPriorityActive:5/)

    expect(mocks.getProjects).not.toHaveBeenCalled()
  })

  it('shows no alerts while the counts are zero', async () => {
    mocks.getActivity.mockResolvedValue([])
    mocks.getActivityWatches.mockResolvedValue([])
    mocks.getAnalyticsOverview.mockResolvedValue({
      overdue_tasks: 0,
      failed_tasks: 0,
      high_priority_active_tasks: 0,
    })

    renderTicker()

    await waitFor(() => expect(mocks.getAnalyticsOverview).toHaveBeenCalled())
    expect(screen.queryByText(/ticker\.overdueTasks/)).toBeNull()
    expect(mocks.getProjects).not.toHaveBeenCalled()
  })
})
