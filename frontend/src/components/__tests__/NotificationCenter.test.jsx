import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import NotificationCenter from '../NotificationCenter'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  invalidateQueries: vi.fn(),
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  getNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  dismissNotification: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => (options?.n ? `${key}:${options.n}` : key),
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mocks.useQuery(...args),
  useMutation: (...args) => mocks.useMutation(...args),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}))

vi.mock('../../api/client', () => ({
  getNotifications: mocks.getNotifications,
  getUnreadCount: mocks.getUnreadCount,
  markNotificationRead: mocks.markNotificationRead,
  markAllNotificationsRead: mocks.markAllNotificationsRead,
  dismissNotification: mocks.dismissNotification,
}))

const notifications = [
  {
    id: 1,
    type: 'task.done',
    message: 'Build passed',
    read: false,
    link: '/projects/1/tasks/2',
    created_at: new Date().toISOString(),
  },
  {
    id: 2,
    type: 'task.failed',
    message: 'Deploy failed',
    read: true,
    created_at: new Date().toISOString(),
  },
]

function setup(options = {}) {
  const { unread = 2, items = notifications } = options
  const markReadMutate = vi.fn()
  const markAllMutate = vi.fn()
  const dismissMutate = vi.fn()

  mocks.navigate.mockClear()
  mocks.invalidateQueries.mockClear()
  mocks.useQuery.mockReset()
  mocks.useMutation.mockReset()

  mocks.useQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'notification-count') return { data: { count: unread } }
    if (queryKey[0] === 'notifications') return { data: items }
    return { data: undefined }
  })

  mocks.useMutation.mockImplementation(({ mutationFn }) => {
    if (mutationFn === mocks.markNotificationRead) return { mutate: markReadMutate }
    if (mutationFn === mocks.markAllNotificationsRead) return { mutate: markAllMutate }
    if (mutationFn === mocks.dismissNotification) return { mutate: dismissMutate }
    return { mutate: vi.fn() }
  })

  const utils = render(<NotificationCenter />)

  return {
    ...utils,
    markReadMutate,
    markAllMutate,
    dismissMutate,
  }
}

describe('NotificationCenter', () => {
  it('renders the notification bell button', () => {
    setup()
    expect(screen.getByTitle('Notifications')).toBeTruthy()
  })

  it('shows the unread notification count badge', () => {
    setup({ unread: 5 })
    expect(screen.getByText('5')).toBeTruthy()
  })

  it('opens the notification panel when the bell is clicked', () => {
    setup()
    fireEvent.click(screen.getByTitle('Notifications'))
    expect(screen.getByText('notifications.title')).toBeTruthy()
  })

  it('renders notification items in the panel', () => {
    setup()
    fireEvent.click(screen.getByTitle('Notifications'))
    expect(screen.getByText('Build passed')).toBeTruthy()
    expect(screen.getByText('Deploy failed')).toBeTruthy()
  })

  it('marks an unread notification as read when clicked', () => {
    const { markReadMutate } = setup()

    fireEvent.click(screen.getByTitle('Notifications'))
    fireEvent.click(screen.getByText('Build passed'))

    expect(markReadMutate).toHaveBeenCalledWith(1)
  })
})
