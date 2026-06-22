import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => {
      const map = {
        'login.password': 'Password',
        'login.incorrectPassword': 'INCORRECT PASSWORD',
        'login.enter': 'ENTER',
        'login.verifying': 'VERIFYING',
      }
      return map[key] || key
    },
  }),
}))

// Mock AuthContext
const mockLogin = vi.fn()
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin }),
}))

// Capture window.location.href assignments
const originalLocation = window.location
let locationHref

beforeEach(() => {
  mockLogin.mockReset()
  // Replace window.location with a writable mock
  delete window.location
  window.location = { ...originalLocation, href: '', search: '' }
  Object.defineProperty(window.location, 'href', {
    set: (val) => { locationHref = val },
    get: () => locationHref || '',
  })
  locationHref = undefined
})

afterEach(() => {
  window.location = originalLocation
})

// Lazy import so mocks are applied first
let Login
beforeAll(async () => {
  const mod = await import('../Login')
  Login = mod.default
})

describe('Login', () => {
  it('renders a password input field', () => {
    render(<Login />)
    const input = screen.getByPlaceholderText('Password')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('type', 'password')
  })

  it('renders a submit button with ENTER text', () => {
    render(<Login />)
    const button = screen.getByRole('button', { name: /enter/i })
    expect(button).toBeInTheDocument()
  })

  it('submit button is disabled when password is empty', () => {
    render(<Login />)
    const button = screen.getByRole('button', { name: /enter/i })
    expect(button).toBeDisabled()
  })

  it('allows typing in the password field', () => {
    render(<Login />)
    const input = screen.getByPlaceholderText('Password')
    fireEvent.change(input, { target: { value: 'mypassword' } })
    expect(input.value).toBe('mypassword')
  })

  it('enables submit button after entering a password', () => {
    render(<Login />)
    const input = screen.getByPlaceholderText('Password')
    fireEvent.change(input, { target: { value: 'secret' } })
    const button = screen.getByRole('button', { name: /enter/i })
    expect(button).not.toBeDisabled()
  })

  it('shows error message on failed login', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Invalid password'))

    render(<Login />)
    const input = screen.getByPlaceholderText('Password')
    fireEvent.change(input, { target: { value: 'wrong' } })

    const button = screen.getByRole('button', { name: /enter/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('INCORRECT PASSWORD')).toBeInTheDocument()
    })

    // Password field should be cleared after error
    expect(input.value).toBe('')
  })

  it('redirects to / on successful login', async () => {
    mockLogin.mockResolvedValueOnce()

    render(<Login />)
    const input = screen.getByPlaceholderText('Password')
    fireEvent.change(input, { target: { value: 'correct' } })

    const button = screen.getByRole('button', { name: /enter/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('correct')
      expect(locationHref).toBe('/')
    })
  })

  it('calls login with the entered password value', async () => {
    mockLogin.mockResolvedValueOnce()

    render(<Login />)
    const input = screen.getByPlaceholderText('Password')
    fireEvent.change(input, { target: { value: 'test123' } })

    fireEvent.submit(input.closest('form'))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledTimes(1)
      expect(mockLogin).toHaveBeenCalledWith('test123')
    })
  })
})
