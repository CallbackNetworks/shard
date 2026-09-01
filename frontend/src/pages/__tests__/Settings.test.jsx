import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

// Mock useBreakpoint
vi.mock('../../hooks/useBreakpoint', () => ({
  default: () => 'desktop',
}))

// Mock @tanstack/react-query
const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
  useMutation: (...args) => mockUseMutation(...args),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

// Mock api/client
vi.mock('../../api/client', () => ({
  getSettings: vi.fn(),
  changePassword: vi.fn(),
  setPreference: vi.fn(() => Promise.resolve()),
  updateSystemSettings: vi.fn(() => Promise.resolve()),
  updateLlmSettings: vi.fn(() => Promise.resolve()),
  getBackupStatus: vi.fn(() => Promise.resolve({ backups: [] })),
  runBackup: vi.fn(() => Promise.resolve({})),
  exportBackup: vi.fn(() => Promise.resolve({ data: new Blob(), headers: {} })),
  downloadBackupFile: vi.fn(() => Promise.resolve({ data: new Blob(), headers: {} })),
  restoreBackupFile: vi.fn(() => Promise.resolve({})),
  restoreServerBackup: vi.fn(() => Promise.resolve({})),
  getIcalToken: vi.fn(() => Promise.resolve({ token: null, url: null })),
  rotateGlobalIcalToken: vi.fn(() => Promise.resolve({})),
}))

// Mock ThemeContext
const mockSetMode = vi.fn()
vi.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ mode: 'dark', setMode: mockSetMode }),
}))

import Settings from '../Settings'

const mockSettings = {
  version: '1.2.3',
  auth_enabled: true,
  smtp_configured: true,
  summary_hour: 8,
  due_soon_window_hours: 24,
  reminder_cooldown_hours: 23,
  llm_provider: 'claude',
  llm_model: 'claude-sonnet',
  llm_api_key_configured: false,
  mcp_transport: 'stdio',
}

function setup(options = {}) {
  const { settings = mockSettings, isLoading = false } = options

  mockUseQuery.mockImplementation(() => ({
    data: isLoading ? undefined : settings,
    isLoading,
  }))

  mockUseMutation.mockImplementation(() => ({
    mutate: vi.fn(),
    isPending: false,
  }))

  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>
  )
}

describe('Settings', () => {
  it('renders the settings title', () => {
    setup()
    expect(screen.getByText('settings.title')).toBeTruthy()
  })

  it('shows loading state', () => {
    setup({ isLoading: true })
    expect(screen.getByText('loading')).toBeTruthy()
  })

  it('renders the system status section', () => {
    setup()
    expect(screen.getByText('settings.systemStatus')).toBeTruthy()
    expect(screen.getByText('settings.authentication')).toBeTruthy()
    expect(screen.getByText('settings.email')).toBeTruthy()
    expect(screen.getByText('settings.summaryHour')).toBeTruthy()
  })

  it('shows authentication enabled badge', () => {
    setup()
    expect(screen.getByText('settings.enabled')).toBeTruthy()
  })

  it('shows smtp configured badge', () => {
    setup()
    expect(screen.getByText('settings.configured')).toBeTruthy()
  })

  it('renders the notifications section with an editable summary hour', () => {
    setup()
    expect(screen.getByText('settings.notifications')).toBeTruthy()
    expect(screen.getByText('settings.dueSoonWindow')).toBeTruthy()
    // Both the summary-hour and backup-hour selects list every hour
    expect(screen.getAllByText('08:00 UTC').length).toBeGreaterThan(0)
  })

  it('renders the backup section with controls', () => {
    setup()
    expect(screen.getByText('settings.backup')).toBeTruthy()
    expect(screen.getByText('settings.backupAuto')).toBeTruthy()
    expect(screen.getByText('settings.backupNow')).toBeTruthy()
  })

  it('renders date/time and list preference sections', () => {
    setup()
    expect(screen.getByText('settings.dateTime')).toBeTruthy()
    expect(screen.getByText('settings.timeFormat')).toBeTruthy()
    expect(screen.getByText('settings.weekStart')).toBeTruthy()
    expect(screen.getByText('settings.listsRefresh')).toBeTruthy()
    expect(screen.getByText('settings.listDensity')).toBeTruthy()
    expect(screen.getByText('settings.refreshRate')).toBeTruthy()
  })

  it('renders the AI assistant section', () => {
    setup()
    expect(screen.getByText('settings.aiAssistant')).toBeTruthy()
    expect(screen.getByText('settings.provider')).toBeTruthy()
    expect(screen.getByText('Claude (Anthropic)')).toBeTruthy()
  })

  it('shows the LLM model name', () => {
    setup()
    expect(screen.getByText('settings.model')).toBeTruthy()
    expect(screen.getByDisplayValue('claude-sonnet')).toBeTruthy()
  })

  // ADR-0136: the number a self-hoster is asked to quote in a bug report. It comes from
  // the backend, so what is on screen is the version that answered, not the one this
  // bundle was built from.
  it('shows the running version', () => {
    setup()
    expect(screen.getByText('1.2.3')).toBeTruthy()
  })

  it('shows the MCP transport', () => {
    setup()
    expect(screen.getByText('MCP Transport')).toBeTruthy()
    expect(screen.getByText('stdio')).toBeTruthy()
  })

  it('renders password change form when auth is enabled', () => {
    setup()
    expect(screen.getByText('settings.changePassword')).toBeTruthy()
    expect(screen.getByPlaceholderText('settings.currentPassword')).toBeTruthy()
    expect(screen.getByPlaceholderText('settings.newPassword')).toBeTruthy()
  })

  it('does not render password change form when auth is disabled', () => {
    setup({ settings: { ...mockSettings, auth_enabled: false } })
    expect(screen.queryByText('settings.changePassword')).toBeNull()
    expect(screen.queryByPlaceholderText('settings.currentPassword')).toBeNull()
  })

  it('disables submit button when password fields are empty', () => {
    setup()
    const submitBtn = screen.getByText('settings.updatePassword')
    expect(submitBtn.closest('button')).toBeDisabled()
  })

  it('disables submit button when new password is too short', () => {
    setup()
    const currentPw = screen.getByPlaceholderText('settings.currentPassword')
    const newPw = screen.getByPlaceholderText('settings.newPassword')
    fireEvent.change(currentPw, { target: { value: 'oldpass' } })
    fireEvent.change(newPw, { target: { value: 'abc' } })
    const submitBtn = screen.getByText('settings.updatePassword')
    expect(submitBtn.closest('button')).toBeDisabled()
  })

  it('enables submit button when both fields have valid values', () => {
    setup()
    const currentPw = screen.getByPlaceholderText('settings.currentPassword')
    const newPw = screen.getByPlaceholderText('settings.newPassword')
    fireEvent.change(currentPw, { target: { value: 'oldpass' } })
    fireEvent.change(newPw, { target: { value: 'newpass123' } })
    const submitBtn = screen.getByText('settings.updatePassword')
    expect(submitBtn.closest('button')).not.toBeDisabled()
  })

  it('shows disabled badge when auth is off', () => {
    setup({ settings: { ...mockSettings, auth_enabled: false } })
    expect(screen.getByText('settings.disabled')).toBeTruthy()
  })

  it('renders the preferences section with adjustable controls', () => {
    setup()
    expect(screen.getByText('settings.preferences')).toBeTruthy()
    expect(screen.getByText('settings.theme')).toBeTruthy()
    expect(screen.getByText('settings.language')).toBeTruthy()
    expect(screen.getByText('settings.defaultView')).toBeTruthy()
    expect(screen.getByText('settings.defaultPriority')).toBeTruthy()
    expect(screen.getByText('settings.reduceMotion')).toBeTruthy()
  })

  it('renders preferences even while system settings load', () => {
    setup({ isLoading: true })
    expect(screen.getByText('settings.preferences')).toBeTruthy()
  })

  it('switches theme mode when the light button is clicked', () => {
    setup()
    fireEvent.click(screen.getByText('settings.themeLight'))
    expect(mockSetMode).toHaveBeenCalledWith('light')
  })

  it('renders accent color and interface size controls', () => {
    setup()
    expect(screen.getByText('settings.accent')).toBeTruthy()
    expect(screen.getByText('settings.uiScale')).toBeTruthy()
    expect(screen.getByLabelText('indigo')).toBeTruthy()
    expect(screen.getByText('settings.scaleCompact')).toBeTruthy()
  })

  it('renders the sidebar modules section with nav items', () => {
    setup()
    expect(screen.getByText('settings.sidebarModules')).toBeTruthy()
    expect(screen.getByText('nav.commandCenter')).toBeTruthy()
    expect(screen.getByText('nav.activity')).toBeTruthy()
    expect(screen.getByText('nav.settings')).toBeTruthy()
  })
})
