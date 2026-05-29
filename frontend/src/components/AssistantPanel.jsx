import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MessageCircle, X, Plus, Send, ChevronDown, Wrench, Loader } from 'lucide-react'
import axios from 'axios'
import { INSET_SHADOW, SHADOW_LG } from '../constants/theme'

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
  { labelKey: 'assistant.promptPlanToday', prompt: "Based on my current tasks, suggest what I should focus on today. Prioritize overdue and high-priority items." },
]

const PANEL_BG   = '#181818'
const BORDER     = 'rgba(255,255,255,0.08)'
const ACCENT     = '#1ed760'
const inp = {
  background: '#1f1f1f', border: 'none',
  boxShadow: INSET_SHADOW,
  borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#ffffff',
  outline: 'none', width: '100%', resize: 'none',
}

function ToolBlock({ name, result }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ background: 'rgba(30,215,96,0.06)', border: `1px solid rgba(30,215,96,0.15)`, borderRadius: 8, marginBottom: 6, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', width: '100%', color: '#1ed760', fontSize: 11 }}
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
    <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      {msg.tool_calls && msg.tool_calls.length > 0 && (
        <div style={{ width: '100%', marginBottom: 4 }}>
          {msg.tool_calls.map((tc, i) => (
            <ToolBlock key={i} name={tc.name} result={tc.result} />
          ))}
        </div>
      )}
      {msg.content && (
        <div style={{
          maxWidth: '85%', padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.6,
          background: isUser ? `rgba(30,215,96,0.15)` : '#1f1f1f',
          border: `1px solid ${isUser ? 'rgba(30,215,96,0.3)' : BORDER}`,
          color: '#ffffff',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
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
    <div style={{ marginBottom: 14 }}>
      {toolStarts.map((ts, i) => {
        const result = toolResults.find(tr => tr.name === ts.name)
        return <ToolBlock key={i} name={ts.name} result={result?.result} />
      })}
      {text && (
        <div style={{
          maxWidth: '85%', padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.6,
          background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: '#ffffff',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {text}
          <span style={{ display: 'inline-block', width: 2, height: 14, background: ACCENT, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'pulseRing 1s infinite' }} />
        </div>
      )}
    </div>
  )
}

export default function AssistantPanel() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [convId, setConvId] = useState(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamEvents, setStreamEvents] = useState([])
  const [showConvList, setShowConvList] = useState(false)
  const [convSearch, setConvSearch] = useState('')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  const { data: conversations = [] } = useQuery({
    queryKey: ['assistant-conversations', convSearch],
    queryFn: () => getConversations(convSearch || undefined),
    enabled: open,
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
      setShowConvList(false)
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteConversation,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assistant-conversations'] })
      setConvId(null)
    },
  })

  useEffect(() => {
    if (open && conversations.length > 0 && !convId) {
      setConvId(conversations[0].id)
    }
  }, [open, conversations, convId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentConv?.messages, streamEvents])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming || !convId) return
    setInput('')
    setStreaming(true)
    setStreamEvents([])

    try {
      const token = localStorage.getItem('auth_token')
      const resp = await fetch(`/assistant/conversations/${convId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content: text }),
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
            } catch { /* ignore cleanup errors */ }
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const isDone = streamEvents.some(e => e.type === 'done')
  const messages = isDone ? (currentConv?.messages || []) : (currentConv?.messages || [])
  const showStreaming = streaming || (streamEvents.length > 0 && !isDone)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="AI Assistant"
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          width: 48, height: 48, borderRadius: '50%',
          background: '#1ed760',
          border: 'none', cursor: 'pointer', color: '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: SHADOW_LG,
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = 'rgba(0,0,0,0.7) 0px 12px 32px' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = SHADOW_LG }}
      >
        <MessageCircle size={20} />
      </button>
    )
  }

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
      width: 380, height: 560, display: 'flex', flexDirection: 'column',
      background: PANEL_BG, border: `1px solid ${BORDER}`,
      borderRadius: 12, boxShadow: SHADOW_LG,
      animation: 'fadeUpIn 0.2s ease',
      fontFamily: "'SpotifyMixUI', 'Helvetica Neue', helvetica, arial, sans-serif",
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1ed760', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <MessageCircle size={14} color="#000" />
        </div>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentConv?.title || t('assistant.title')}
        </span>
        <button onClick={() => setShowConvList(v => !v)} title={t('assistant.conversations')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: '2px 4px', display: 'flex' }}>
          <ChevronDown size={14} />
        </button>
        <button onClick={() => createMut.mutate()} title={t('assistant.newChat')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: '2px 4px', display: 'flex' }}>
          <Plus size={14} />
        </button>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: '2px 4px', display: 'flex' }}>
          <X size={14} />
        </button>
      </div>

      {/* Conversation list dropdown */}
      {showConvList && (
        <div style={{ position: 'absolute', top: 52, right: 0, width: '100%', background: '#1f1f1f', border: `1px solid ${BORDER}`, borderRadius: '0 0 8px 8px', zIndex: 10, maxHeight: 240, overflowY: 'auto', boxShadow: SHADOW_LG }}>
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${BORDER}`, position: 'sticky', top: 0, background: '#1f1f1f' }}>
            <input
              value={convSearch}
              onChange={e => setConvSearch(e.target.value)}
              placeholder={t('assistant.searchConversations')}
              style={{ width: '100%', padding: '5px 8px', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11, background: 'rgba(255,255,255,0.05)', color: '#fff', outline: 'none' }}
            />
          </div>
          {conversations.length === 0 ? (
            <div style={{ padding: '12px 14px', fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>{convSearch ? t('assistant.noMatches') : t('assistant.noConversations')}</div>
          ) : conversations.map(c => (
            <div
              key={c.id}
              onClick={() => { setConvId(c.id); setShowConvList(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', cursor: 'pointer', background: c.id === convId ? 'rgba(30,215,96,0.1)' : 'transparent' }}
            >
              <span style={{ flex: 1, fontSize: 12, color: '#b3b3b3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteMut.mutate(c.id) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(248,113,113,0.5)', padding: 0, display: 'flex', flexShrink: 0 }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px' }}>
        {!convId ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(255,255,255,0.2)' }}>
            <MessageCircle size={32} style={{ marginBottom: 10, opacity: 0.3 }} />
            <p style={{ fontSize: 13 }}>{t('assistant.noConversations')}</p>
            <button onClick={() => createMut.mutate()} style={{ marginTop: 10, padding: '8px 20px', background: '#1ed760', border: 'none', borderRadius: 9999, color: '#000', fontSize: 12, cursor: 'pointer', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.4px' }}>
              {t('assistant.newChat')}
            </button>
          </div>
        ) : (
          <>
            {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
            {showStreaming && <StreamingMessage events={streamEvents} />}
            {streaming && streamEvents.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>
                <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> {t('assistant.thinking')}
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompts */}
      {convId && messages.length === 0 && !streaming && (
        <div style={{ padding: '0 12px 6px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {PROMPT_TEMPLATES.map(tmpl => (
            <button
              key={tmpl.labelKey}
              onClick={() => { setInput(tmpl.prompt) }}
              style={{
                padding: '4px 10px', borderRadius: 9999,
                border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
                fontSize: 10, color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {t(tmpl.labelKey)}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '8px 12px 14px', borderTop: `1px solid ${BORDER}` }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={convId ? t('assistant.askAnything') : t('assistant.noConversations')}
            disabled={!convId || streaming}
            rows={2}
            style={{ ...inp, flex: 1, minHeight: 40, maxHeight: 120 }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming || !convId}
            style={{
              padding: '8px 12px', border: 'none', borderRadius: '50%',
              background: '#1ed760',
              color: '#000', cursor: 'pointer', display: 'flex', alignItems: 'center',
              opacity: (!input.trim() || streaming || !convId) ? 0.4 : 1,
              flexShrink: 0,
            }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
