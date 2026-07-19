import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FormModal from '../FormModal'
import FormField from '../FormField'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, opts) => opts?.defaultValue || key }),
}))

describe('FormModal', () => {
  it('renders title, children, and default footer', () => {
    const onClose = vi.fn()
    const onSubmit = vi.fn()
    render(
      <FormModal title="Edit thing" onClose={onClose} onSubmit={onSubmit} submitLabel="Save it">
        <FormField label="Name" required>
          <input aria-label="Name" />
        </FormField>
      </FormModal>
    )
    expect(screen.getByRole('dialog', { name: 'Edit thing' })).toBeInTheDocument()
    expect(screen.getByText('Name *')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Save it'))
    expect(onSubmit).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('cancel'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Escape via the focus trap', () => {
    const onClose = vi.fn()
    render(
      <FormModal title="Trap" onClose={onClose} onSubmit={() => {}}>
        <input aria-label="field" />
      </FormModal>
    )
    fireEvent.keyDown(screen.getByRole('dialog').firstChild, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('disables submit when submitDisabled', () => {
    render(
      <FormModal title="Disabled" onClose={() => {}} onSubmit={() => {}} submitLabel="Go" submitDisabled>
        <input aria-label="field" />
      </FormModal>
    )
    expect(screen.getByText('Go')).toBeDisabled()
  })

  it('renders a custom footer instead of the default', () => {
    render(
      <FormModal title="Custom" onClose={() => {}} footer={<div>custom-footer</div>}>
        <input aria-label="field" />
      </FormModal>
    )
    expect(screen.getByText('custom-footer')).toBeInTheDocument()
    expect(screen.queryByText('cancel')).not.toBeInTheDocument()
  })
})
