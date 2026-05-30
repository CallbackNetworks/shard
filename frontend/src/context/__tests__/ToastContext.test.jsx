import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ToastProvider, useToast, globalAddToast, setGlobalToastFn } from '../ToastContext'

function TestConsumer() {
  const { addToast } = useToast()
  return (
    <>
      <button onClick={() => addToast('Error toast', 'error')}>show-error</button>
      <button onClick={() => addToast('Success toast', 'success')}>show-success</button>
    </>
  )
}

describe('ToastContext', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('renders children without toasts by default', () => {
    render(
      <ToastProvider>
        <span>child</span>
      </ToastProvider>
    )
    expect(screen.getByText('child')).toBeTruthy()
    expect(screen.queryByText('Error toast')).toBeNull()
  })

  it('shows a toast when addToast is called', () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('show-error'))
    expect(screen.getByText('Error toast')).toBeTruthy()
  })

  it('dismisses a toast when close button is clicked', () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('show-error'))
    expect(screen.getByText('Error toast')).toBeTruthy()
    fireEvent.click(screen.getByText('×'))
    expect(screen.queryByText('Error toast')).toBeNull()
  })

  it('auto-dismisses toast after 4 seconds', () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('show-error'))
    expect(screen.getByText('Error toast')).toBeTruthy()
    act(() => vi.advanceTimersByTime(4100))
    expect(screen.queryByText('Error toast')).toBeNull()
  })

  it('limits to 5 toasts maximum', () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    )
    for (let i = 0; i < 7; i++) {
      fireEvent.click(screen.getByText('show-error'))
    }
    const toasts = screen.getAllByText('Error toast')
    expect(toasts.length).toBeLessThanOrEqual(5)
  })

  it('supports globalAddToast function', () => {
    render(
      <ToastProvider>
        <span>child</span>
      </ToastProvider>
    )
    act(() => globalAddToast('Global error'))
    expect(screen.getByText('Global error')).toBeTruthy()
  })

  it('useToast returns context with addToast', () => {
    let ctx
    function Probe() {
      ctx = useToast()
      return null
    }
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>
    )
    expect(ctx).toBeTruthy()
    expect(typeof ctx.addToast).toBe('function')
  })
})
