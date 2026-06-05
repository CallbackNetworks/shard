import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ErrorBoundary from '../ErrorBoundary'

function ThrowingChild({ message }) {
  throw new Error(message || 'Test explosion')
}

function GoodChild() {
  return <span>All good</span>
}

describe('ErrorBoundary', () => {
  let consoleSpy

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>
    )
    expect(screen.getByText('All good')).toBeTruthy()
  })

  it('renders multiple children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <span>First</span>
        <span>Second</span>
      </ErrorBoundary>
    )
    expect(screen.getByText('First')).toBeTruthy()
    expect(screen.getByText('Second')).toBeTruthy()
  })

  it('shows error message when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="Kaboom" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(screen.getByText('Kaboom')).toBeTruthy()
  })

  it('shows a reload button when an error is caught', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    )
    expect(screen.getByText('Reload page')).toBeTruthy()
  })

  it('does not render children after an error is caught', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    )
    expect(screen.queryByText('All good')).toBeNull()
  })

  it('calls console.error via componentDidCatch', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="catch me" />
      </ErrorBoundary>
    )
    const boundaryCall = consoleSpy.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('ErrorBoundary caught:')
    )
    expect(boundaryCall).toBeTruthy()
  })

  it('displays the specific error message text', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="Something specific broke" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something specific broke')).toBeTruthy()
  })
})
