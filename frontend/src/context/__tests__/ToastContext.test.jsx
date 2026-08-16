import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ToastProvider, useToast, globalAddToast } from '../ToastContext'

const KINDS = ['success', 'error', 'warning', 'info']

function TestConsumer() {
  const { addToast } = useToast()
  return (
    <>
      <button onClick={() => addToast('Error toast', 'error')}>show-error</button>
      <button onClick={() => addToast('Success toast', 'success')}>show-success</button>
      {KINDS.map(kind => (
        <button key={kind} onClick={() => addToast(`${kind} message`, kind)}>{`show-${kind}-kind`}</button>
      ))}
    </>
  )
}

// The toast element is the message span's parent.
function toastFor(text) {
  return screen.getByText(text).parentElement
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

  // Regression: success and error were byte-identical yellow, so a failed
  // delete and a saved change looked exactly the same.
  it('gives each meaning a background nobody else has', () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    )
    for (const kind of KINDS) fireEvent.click(screen.getByText(`show-${kind}-kind`))

    const backgrounds = KINDS.map(kind => toastFor(`${kind} message`).style.backgroundColor)
    expect(backgrounds.every(Boolean)).toBe(true)
    expect(new Set(backgrounds).size).toBe(KINDS.length)
  })

  // 'info' had no entry in the colour table and fell through to the error style.
  it('does not dress an unknown type as an error', () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('show-error'))
    act(() => globalAddToast('Mystery', 'not-a-real-kind'))

    expect(toastFor('Mystery').style.backgroundColor)
      .not.toBe(toastFor('Error toast').style.backgroundColor)
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
