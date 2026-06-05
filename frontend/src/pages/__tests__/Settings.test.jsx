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
}))

// Mock api/client
vi.mock('../../api/client', () => ({
  getSettings: vi.fn(),
  changePassword: vi.fn(),
}))

import Settings from '../Settings'

const mockSettings = {
  auth_enabled: true,
  smtp_configured: true,
  summary_hour: 8,
  llm_provider: 'claude',
  llm_model: 'claude-sonnet',
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

  it('shows summary hour value', () => {
    setup()
    expect(screen.getByText('8:00 UTC')).toBeTruthy()
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
    expect(screen.getByText('claude-sonnet')).toBeTruthy()
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
})
