import { useEffect, useRef, useState } from 'react'
import { MessageSquare, X } from 'lucide-react'
import { streamShareChatMessage } from '../../api/client'
import s from './ShareChatWidget.module.css'

/**
 * Public read-only Q&A assistant (ADR-0098). Answers only from this share's own data —
 * the server injects exactly what `GET /share/node/{token}` already returns as context,
 * nothing more. Stateless per request: this widget is the only place a "conversation"
 * exists, sent back in full on every question (same shape the LLM APIs already need).
 * No i18n here, matching the rest of `components/share/` — a public page rendered for a
 * guest with no session (see i18nCoverage.test.js's exclusion for this directory).
 *
 * It is a dock, not a section (ADR-0157). Sat in the scroll flow it was one bare input
 * between two blocks of content, which reads as a comment box for whatever is above it;
 * and a question is asked *about* what you are looking at, so the control has to stay
 * reachable while you look. `open` is lifted so the page's section nav can raise it —
 * removing it from the flow must not remove it from the page's own table of contents.
 */
export default function ShareChatWidget({ token, open, onOpenChange }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, streamingText])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onOpenChange(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

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

  if (!open) {
    return (
      <button type="button" className={s.launcher} onClick={() => onOpenChange(true)} aria-label="Ask a question about this page">
        <MessageSquare size={14} />
        <span>ASK</span>
        {messages.length > 0 && <b>{messages.filter(m => m.role === 'user').length}</b>}
      </button>
    )
  }

  return (
    <div className={s.dock} role="dialog" aria-label="Ask a question about this page" onClick={e => e.stopPropagation()}>
      <div className={s.head}>
        <MessageSquare size={13} />
        <span>ASK A QUESTION</span>
        <button type="button" onClick={() => onOpenChange(false)} aria-label="Close"><X size={14} /></button>
      </div>

      {messages.length === 0 && !streamingText && (
        <div className={s.hint}>Answers come only from what this page already shows.</div>
      )}
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
          ref={inputRef}
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
