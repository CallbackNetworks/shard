import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MessageCircle, Plus, Send, Trash2, Wrench, ChevronDown, Loader, Search } from 'lucide-react'
import axios from 'axios'
import { BRAND, DARK } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'

const _api = axios.create({ baseURL: '' })
_api.interceptors.request.use(cfg => {
  const t = localStorage.getItem('auth_token')
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

const getConversations = (q) => _api.get('/assistant/conversations', { params: q ? { q } : {} }).then(r => r.data)
const getConversation = (id) => _api.get(`/assistant/conversations/${id}`).then(r => r.data)
const createConversation = () => _api.post('/assistant/conversations').then(r => r.data)
const deleteConversation = (id) => _api.delete(`/assistant/conversations/${id}`)

const PROMPT_TEMPLATES = [
  { labelKey: 'assistant.promptSummary',   prompt: 'Give me a summary of all my projects and tasks.' },
  { labelKey: 'assistant.promptOverdue',   prompt: 'What tasks are overdue? List them with their due dates.' },
  { labelKey: 'assistant.promptWorkload',  prompt: 'Analyze my current workload. Show breakdown by status, priority, and assignee.' },
  { labelKey: 'assistant.promptRecent',    prompt: 'What happened recently? Show the latest activity.' },
  { labelKey: 'assistant.promptPlanToday', prompt: "Based on my current tasks, suggest what I should focus on today." },
  { labelKey: 'assistant.promptDecisions', prompt: "Analyze my projects and identify key decisions that should be recorded." },
]

function ToolBlock({ name, result }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="kt-panel" style={{ background: 'rgba(250,204,21,0.07)', borderColor: 'rgba(250,204,21,0.18)', marginBottom: 6, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="kt-btn"
        style={{ width: '100%', justifyContent: 'flex-start', color: BRAND, fontSize: 11, padding: '6px 10px', background: 'transparent', border: 'none' }}
      >
        <Wrench size={10} />
        <span style={{ flex: 1, textAlign: 'left', fontWeight: 600 }}>{name}</span>
        <ChevronDown size={10} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && result && (
        <pre style={{ margin: 0, padding: '0 10px 8px', fontSize: 10, color: 'rgba(255,255,255,0.4)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto' }}>
          {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  )
}

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      {msg.tool_calls && msg.tool_calls.length > 0 && (
        <div style={{ width: '100%', maxWidth: 600, marginBottom: 4 }}>
          {msg.tool_calls.map((tc, i) => <ToolBlock key={i} name={tc.name} result={tc.result} />)}
        </div>
      )}
      {msg.content && (
        <div className={isUser ? 'kt-assistant-bubble kt-assistant-bubble-user' : 'kt-assistant-bubble'} style={{
          maxWidth: '70%', padding: '10px 14px', fontSize: 14, lineHeight: 1.6,
          background: isUser ? 'rgba(250,204,21,0.14)' : DARK.elevated,
          border: `1px solid ${isUser ? 'rgba(250,204,21,0.34)' : DARK.border}`,
          color: DARK.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {msg.content}
        </div>
      )}
    </div>
  )
}

function StreamingMessage({ events }) {
  const text = events.filter(e => e.type === 'text').map(e => e.text).join('')
  const toolStarts = events.filter(e => e.type === 'tool_start')
  const toolResults = events.filter(e => e.type === 'tool_result')
  return (
    <div style={{ marginBottom: 16 }}>
      {toolStarts.map((ts, i) => {
        const result = toolResults.find(tr => tr.name === ts.name)
        return <ToolBlock key={i} name={ts.name} result={result?.result} />
      })}
      {text && (
        <div className="kt-assistant-bubble" style={{
          maxWidth: '70%', padding: '10px 14px', fontSize: 14, lineHeight: 1.6,
          background: DARK.elevated, border: `1px solid ${DARK.border}`,
          color: DARK.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {text}
          <span style={{ display: 'inline-block', width: 2, height: 16, background: BRAND, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'kineticBlink 1s infinite' }} />
        </div>
      )}
    </div>
  )
}

export default function Assistant() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'

  const [convId, setConvId] = useState(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamEvents, setStreamEvents] = useState([])
  const [convSearch, setConvSearch] = useState('')
  const [showSidebar, setShowSidebar] = useState(!isMobile)
  const messagesEndRef = useRef(null)

  const { data: conversations = [] } = useQuery({
    queryKey: ['assistant-conversations', convSearch],
    queryFn: () => getConversations(convSearch || undefined),
    staleTime: 5000,
  })

  const { data: currentConv } = useQuery({
    queryKey: ['assistant-conv', convId],
    queryFn: () => getConversation(convId),
    enabled: !!convId,
    staleTime: 0,
  })

  const createMut = useMutation({
    mutationFn: createConversation,
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ['assistant-conversations'] })
      setConvId(conv.id)
      if (isMobile) setShowSidebar(false)
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['assistant-conversations'] })
      if (convId === id) setConvId(null)
    },
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentConv?.messages, streamEvents])

  const sendMessage = useCallback(async (text) => {
    const msg = (text || input).trim()
    if (!msg || streaming || !convId) return
    setInput('')
    setStreaming(true)
    setStreamEvents([])

    try {
      const token = localStorage.getItem('auth_token')
      const resp = await fetch(`/assistant/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ content: msg }),
      })
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6))
              setStreamEvents(prev => [...prev, event])
              if (event.type === 'done') {
                qc.invalidateQueries({ queryKey: ['assistant-conv', convId] })
                qc.invalidateQueries({ queryKey: ['assistant-conversations'] })
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch (err) {
      setStreamEvents(prev => [...prev, { type: 'error', message: String(err) }])
    } finally {
      setStreaming(false)
    }
  }, [input, streaming, convId, qc])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const isDone = streamEvents.some(e => e.type === 'done')
  const messages = currentConv?.messages || []
  const showStreaming = streaming || (streamEvents.length > 0 && !isDone)

  const sidebarWidth = 260

  return (
    <div className="kt-assistant-page" style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Conversation sidebar */}
      {showSidebar && (
        <div className="kt-assistant-rail" style={{
          width: isMobile ? '100%' : sidebarWidth, flexShrink: 0,
          borderRight: isMobile ? 'none' : `1px solid ${DARK.border}`,
          display: 'flex', flexDirection: 'column',
          background: DARK.bg,
          position: isMobile ? 'absolute' : 'relative',
          zIndex: isMobile ? 10 : 1,
          height: '100%',
        }}>
          <div className="kt-assistant-rail-header" style={{ padding: '16px 14px 10px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <MessageCircle size={16} color={BRAND} />
            <span style={{ flex: 1, fontSize: 22, fontWeight: 400, color: DARK.text, fontFamily: 'var(--kt-display)', textTransform: 'uppercase' }}>
              {t('assistant.title')}
            </span>
            <button
              onClick={() => createMut.mutate()}
              title={t('assistant.newChat')}
              className="kt-icon-btn kt-btn-primary"
              style={{ width: 28, height: 28 }}
            >
              <Plus size={14} />
            </button>
          </div>

          <div style={{ padding: '0 12px 8px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: 8, color: DARK.textDim }} />
              <input
                value={convSearch}
                onChange={e => setConvSearch(e.target.value)}
                placeholder={t('assistant.searchConversations')}
                className="kt-input"
                style={{ paddingLeft: 26, fontSize: 12 }}
              />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {conversations.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: DARK.textDim, fontSize: 12 }}>
                {t('assistant.noConversations')}
              </div>
            )}
            {conversations.map(c => (
              <div
                key={c.id}
                onClick={() => { setConvId(c.id); if (isMobile) setShowSidebar(false) }}
                className={c.id === convId ? 'kt-assistant-conversation is-active' : 'kt-assistant-conversation'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 12px', cursor: 'pointer',
                  background: c.id === convId ? 'rgba(250,204,21,0.1)' : 'transparent',
                  borderLeft: c.id === convId ? `2px solid ${BRAND}` : '2px solid transparent',
                  transition: 'background 0.15s',
                }}
              >
                <span style={{
                  flex: 1, fontSize: 12, color: c.id === convId ? DARK.text : DARK.textMid,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {c.title}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteMut.mutate(c.id) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textDim, padding: 2, display: 'flex', flexShrink: 0, opacity: 0.5 }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chat area */}
      <div className="kt-assistant-stage" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Chat header */}
        <div className="kt-page-header" style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 20px', borderBottom: `1px solid ${DARK.border}`, marginBottom: 0,
        }}>
          {isMobile && (
            <button
              onClick={() => setShowSidebar(v => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: 2 }}
            >
              <MessageCircle size={16} />
            </button>
          )}
          <span className="kt-page-title" style={{ flex: 1, fontSize: 38, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentConv?.title || t('assistant.selectConversation')}
          </span>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 12px' : '20px 24px' }}>
          {!convId ? (
            <div className="kt-empty" style={{ margin: '30px auto', maxWidth: 520 }}>
              <MessageCircle size={40} className="kt-empty-icon" />
              <p className="kt-empty-title">{t('assistant.selectOrCreate')}</p>
              <button
                onClick={() => createMut.mutate()}
                className="kt-btn kt-btn-primary"
              >
                {t('assistant.newChat')}
              </button>
            </div>
          ) : (
            <>
              {messages.length === 0 && !streaming && (
                <div style={{ padding: '40px 0' }}>
                  <div style={{ textAlign: 'center', color: DARK.textDim, marginBottom: 20, fontSize: 13 }}>
                    {t('assistant.startPrompt')}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {PROMPT_TEMPLATES.map(tmpl => (
                      <button
                        key={tmpl.labelKey}
                        onClick={() => sendMessage(tmpl.prompt)}
                        className="kt-chip"
                        style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}
                      >
                        {t(tmpl.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
              {showStreaming && <StreamingMessage events={streamEvents} />}
              {streaming && streamEvents.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: DARK.textDim, fontSize: 13, padding: '8px 0' }}>
                  <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> {t('assistant.thinking')}
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        {convId && (
          <div style={{ padding: isMobile ? '10px 12px 14px' : '12px 24px 16px', borderTop: `1px solid ${DARK.border}` }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('assistant.askAnything')}
                disabled={streaming}
                rows={2}
                className="kt-input"
                style={{
                  flex: 1, background: DARK.elevated,
                  padding: '10px 14px', fontSize: 14, color: DARK.text,
                  outline: 'none', resize: 'none', minHeight: 44, maxHeight: 160,
                  lineHeight: 1.5,
                }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || streaming}
                className="kt-btn kt-btn-primary"
                style={{ padding: 12, opacity: (!input.trim() || streaming) ? 0.4 : 1, flexShrink: 0 }}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
