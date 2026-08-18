import { useEffect, useRef, useState } from 'react'
import { streamShareChatMessage } from '../../api/client'
import useScrollReveal from './useScrollReveal'

/**
 * Public read-only Q&A assistant (ADR-0098). Answers only from this share's own data —
 * the server injects exactly what `GET /share/node/{token}` already returns as context,
 * nothing more. Stateless per request: this widget is the only place a "conversation"
 * exists, sent back in full on every question (same shape the LLM APIs already need).
 * No i18n here, matching the rest of `components/share/` — a public page rendered for a
 * guest with no session (see i18nCoverage.test.js's exclusion for this directory).
 */
export default function ShareChatWidget({ token }) {
  const [ref, visible] = useScrollReveal(0.1)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef(null)

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, streamingText])

  const send = async (e) => {
    e.preventDefault()
    const content = input.trim()
    if (!content || busy) return
    const nextMessages = [...messages, { role: 'user', content }]
    setMessages(nextMessages)
    setInput('')
    setBusy(true)
    setError('')
    let acc = ''
    try {
      await streamShareChatMessage(token, nextMessages, (event) => {
        if (event.type === 'text') {
          acc += event.text
          setStreamingText(acc)
        } else if (event.type === 'error') {
          setError(event.message)
        }
      })
      if (acc) setMessages(prev => [...prev, { role: 'assistant', content: acc }])
    } catch (err) {
      const msg = err.message || 'Could not reach the assistant'
      setError(msg === 'PIN verification required' ? 'Your session expired — please refresh the page.' : msg)
    } finally {
      setStreamingText('')
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className={visible ? 'kt-share-chat is-visible' : 'kt-share-chat'} onClick={e => e.stopPropagation()}>
      <div className="kt-share-section-label">ASK A QUESTION</div>
      {(messages.length > 0 || streamingText) && (
        <div className="kt-share-chat-list" ref={listRef}>
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'kt-share-chat-msg is-user' : 'kt-share-chat-msg'}>
              {m.content}
            </div>
          ))}
          {busy && <div className="kt-share-chat-msg is-pending">{streamingText || '…'}</div>}
        </div>
      )}
      {error && <div className="kt-share-note-error">{error}</div>}
      <form onSubmit={send} className="kt-share-chat-form">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about this project..."
          maxLength={4000}
          aria-label="Ask a question"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          {busy ? '...' : 'ASK'}
        </button>
      </form>
    </div>
  )
}
