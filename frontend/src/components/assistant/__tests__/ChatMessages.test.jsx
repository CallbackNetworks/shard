import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StreamingMessage } from '../ChatMessages'

describe('StreamingMessage', () => {
  it('shows a working indicator while a tool result awaits the next round (ADR-0104)', () => {
    const events = [
      { type: 'tool_start', name: 'list_tasks' },
      { type: 'tool_result', name: 'list_tasks', result: '[]' },
    ]
    render(<StreamingMessage events={events} />)
    expect(screen.getByText(/thinking/i)).toBeInTheDocument()
  })

  it('hides the working indicator once the next round\'s text starts arriving', () => {
    const events = [
      { type: 'tool_start', name: 'list_tasks' },
      { type: 'tool_result', name: 'list_tasks', result: '[]' },
      { type: 'text', text: 'Here you go.' },
    ]
    render(<StreamingMessage events={events} />)
    expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument()
    expect(screen.getByText('Here you go.')).toBeInTheDocument()
  })

  it('does not show the indicator before any tool has run', () => {
    const events = [{ type: 'text', text: 'Hi' }]
    render(<StreamingMessage events={events} />)
    expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument()
  })
})
