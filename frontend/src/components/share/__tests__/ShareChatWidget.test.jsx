import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ShareChatWidget from '../ShareChatWidget'

class MockIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function mockFetchStream(events) {
  const encoder = new TextEncoder()
  const chunks = events.map(e => encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
  let i = 0
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
      }),
    },
  })
}

describe('ShareChatWidget', () => {
  beforeEach(() => {
    global.IntersectionObserver = MockIntersectionObserver
  })

  // The widget is a dock (ADR-0157): closed it is one launcher, and the conversation
  // is not on the page at all. A test rendering it open is testing the panel, so the
  // closed state needs its own — otherwise "the input exists" would keep passing for a
  // widget that had lost its way onto the screen.
  it('shows only a launcher until it is opened', () => {
    const onOpenChange = vi.fn()
    render(<ShareChatWidget token="tok123" open={false} onOpenChange={onOpenChange} />)

    expect(screen.queryByLabelText('Ask a question')).toBeNull()
    fireEvent.click(screen.getByLabelText('Ask a question about this page'))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('sends a question and renders the streamed reply', async () => {
    mockFetchStream([
      { type: 'text', text: 'The project is ' },
      { type: 'text', text: 'on track.' },
      { type: 'done' },
    ])

    render(<ShareChatWidget token="tok123" open onOpenChange={() => {}} />)
    fireEvent.change(screen.getByLabelText('Ask a question'), { target: { value: 'How is it going?' } })
    fireEvent.click(screen.getByText('ASK'))

    expect(await screen.findByText('How is it going?')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('The project is on track.')).toBeTruthy())

    expect(global.fetch).toHaveBeenCalledWith(
      '/share/node/tok123/chat',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    )
  })

  it('shows a friendly message when the PIN session has expired mid-visit', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      body: null,
      json: async () => ({ detail: 'PIN verification required' }),
    })

    render(<ShareChatWidget token="tok123" open onOpenChange={() => {}} />)
    fireEvent.change(screen.getByLabelText('Ask a question'), { target: { value: 'Anything?' } })
    fireEvent.click(screen.getByText('ASK'))

    expect(await screen.findByText(/session expired/i)).toBeTruthy()
  })

  it('surfaces a provider error event without crashing', async () => {
    mockFetchStream([
      { type: 'error', message: 'No LLM provider is configured.' },
      { type: 'done' },
    ])

    render(<ShareChatWidget token="tok123" open onOpenChange={() => {}} />)
    fireEvent.change(screen.getByLabelText('Ask a question'), { target: { value: 'Hello?' } })
    fireEvent.click(screen.getByText('ASK'))

    expect(await screen.findByText('No LLM provider is configured.')).toBeTruthy()
  })
})
