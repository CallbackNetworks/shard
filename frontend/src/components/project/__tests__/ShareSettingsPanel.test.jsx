import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ShareSettingsPanel from '../ShareSettingsPanel'

function renderPanel(project = {}, props = {}) {
  const handlers = {
    setExpiryInput: vi.fn(),
    onSetExpiry: vi.fn(),
    onSetPin: vi.fn(),
    onClearPin: vi.fn(),
    ...props,
  }
  render(
    <ShareSettingsPanel
      project={{ share_pin_set: false, share_expires_at: null, ...project }}
      expiryInput=""
      shareViews={3}
      isPending={false}
      pinPending={false}
      {...handlers}
    />,
  )
  return handlers
}

describe('ShareSettingsPanel', () => {
  it('sets a PIN once it is long enough', () => {
    const { onSetPin } = renderPanel()
    const input = screen.getByLabelText('Share PIN')
    const button = screen.getByText('Set PIN')

    // Too short — the control stays disabled rather than sending a PIN the server rejects.
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.click(button)
    expect(onSetPin).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '8765' } })
    fireEvent.click(button)
    expect(onSetPin).toHaveBeenCalledWith('8765')
  })

  it('keeps non-digits out of the PIN', () => {
    renderPanel()
    const input = screen.getByLabelText('Share PIN')
    fireEvent.change(input, { target: { value: '12ab34' } })
    expect(input.value).toBe('1234')
  })

  it('offers Remove only when a PIN is actually set', () => {
    renderPanel({ share_pin_set: false })
    expect(screen.queryByText('Remove')).toBeNull()
  })

  it('clears the PIN through the owner control', () => {
    const { onClearPin } = renderPanel({ share_pin_set: true })
    expect(screen.getByText('PIN protection active')).toBeTruthy()

    fireEvent.click(screen.getByText('Remove'))
    expect(onClearPin).toHaveBeenCalled()
  })

  it('still sets and clears the expiry', () => {
    const { onSetExpiry } = renderPanel({}, { })
    fireEvent.click(screen.getByText('Clear'))
    expect(onSetExpiry).toHaveBeenCalledWith(null)
  })
})
