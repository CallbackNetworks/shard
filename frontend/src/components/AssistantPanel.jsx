import { useState, useEffect } from 'react'
import { useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { MessageCircle, X, Plus, Send, ChevronDown } from 'lucide-react'
import { BRAND, DARK } from '../constants/theme'
import useAssistantChat from './assistant/useAssistantChat'
import PromptChips from './assistant/PromptChips'
import { MessageBubble, StreamingMessage, ThinkingRow } from './assistant/ChatMessages'

/**
 * The floating assistant. Layout only — everything it does is
 * `useAssistantChat`, shared with the full page (ADR-0089).
 *
 * It hides itself on `/assistant`: two assistants on one screen, talking to the
 * same conversations, is not a second way to reach the feature — it is the same
 * feature drawn twice, and each redraw was a chance for them to disagree.
 */
export default function AssistantPanel() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [showConvList, setShowConvList] = useState(false)

  const onAssistantPage = pathname === '/assistant' || pathname.startsWith('/assistant/')
  const chat = useAssistantChat({ enabled: open && !onAssistantPage })

  // Opening the panel resumes the most recent conversation rather than landing
  // on an empty shell.
  useEffect(() => {
    if (open && !chat.convId && chat.conversations.length > 0) {
      chat.setConvId(chat.conversations[0].id)
    }
  }, [open, chat])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chat.send() }
  }

  if (onAssistantPage) return null

  if (!open) {
    return (
      <button
        className="kt-assistant-fab"
        onClick={() => setOpen(true)}
        title={t('assistant.title')}
        aria-label={t('assistant.title')}
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 290,
          width: 44, height: 44, background: BRAND,
          border: 'none', cursor: 'pointer', color: 'var(--kt-bg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '6px 6px 0 rgba(0,0,0,0.45)',
        }}
      >
        <MessageCircle size={20} />
      </button>
    )
  }

  return (
    <div className="kt-assistant-panel" style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 290,
      width: 380, maxWidth: 'calc(100vw - 32px)', height: 560, maxHeight: 'calc(100vh - 40px)',
      display: 'flex', flexDirection: 'column',
      background: DARK.surface, border: `1px solid ${DARK.border}`,
      boxShadow: '10px 10px 0 rgba(0,0,0,0.42)',
      animation: 'fadeUpIn 0.2s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${DARK.border}` }}>
        <div style={{ width: 28, height: 28, background: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <MessageCircle size={14} color="var(--kt-bg)" />
        </div>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: DARK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {chat.conversation?.title || t('assistant.title')}
        </span>
        <button onClick={() => setShowConvList(v => !v)} title={t('assistant.conversations')} className="kt-icon-btn">
          <ChevronDown size={14} />
        </button>
        <button onClick={chat.createConversation} title={t('assistant.newChat')} className="kt-icon-btn">
          <Plus size={14} />
        </button>
        <button onClick={() => setOpen(false)} aria-label={t('cancel')} className="kt-icon-btn">
          <X size={14} />
        </button>
      </div>

      {showConvList && (
        <div style={{
          position: 'absolute', top: 52, right: 0, width: '100%', background: DARK.elevated,
          border: `1px solid ${DARK.border}`, zIndex: 10, maxHeight: 240, overflowY: 'auto',
          boxShadow: '8px 8px 0 rgba(0,0,0,0.35)',
        }}>
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${DARK.border}`, position: 'sticky', top: 0, background: DARK.elevated }}>
            <input
              value={chat.search}
              onChange={e => chat.setSearch(e.target.value)}
              placeholder={t('assistant.searchConversations')}
              className="kt-input"
              style={{ fontSize: 11 }}
            />
          </div>
          {chat.conversations.length === 0 ? (
            <div style={{ padding: '12px 14px', fontSize: 12, color: DARK.textDim }}>
              {chat.search ? t('assistant.noMatches') : t('assistant.noConversations')}
            </div>
          ) : chat.conversations.map(c => (
            <div
              key={c.id}
              onClick={() => { chat.setConvId(c.id); setShowConvList(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', cursor: 'pointer',
                background: c.id === chat.convId ? DARK.infoBg : 'transparent',
              }}
            >
              <span style={{ flex: 1, fontSize: 12, color: DARK.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); chat.deleteConversation(c.id) }}
                aria-label={t('delete')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textDim, padding: 0, display: 'flex', flexShrink: 0 }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px' }}>
        {!chat.convId ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: DARK.textDim }}>
            <MessageCircle size={32} style={{ marginBottom: 10, opacity: 0.35 }} />
            <p style={{ fontSize: 13 }}>{t('assistant.noConversations')}</p>
            <button onClick={chat.createConversation} className="kt-btn kt-btn-primary" style={{ marginTop: 10 }}>
              {t('assistant.newChat')}
            </button>
          </div>
        ) : (
          <>
            {chat.messages.map(msg => <MessageBubble key={msg.id} msg={msg} maxWidth="85%" />)}
            {chat.showStreaming && <StreamingMessage events={chat.streamEvents} maxWidth="85%" />}
            {chat.streaming && chat.streamEvents.length === 0 && <ThinkingRow />}
          </>
        )}
        <div ref={chat.endRef} />
      </div>

      {chat.convId && chat.messages.length === 0 && !chat.streaming && (
        <div style={{ padding: '0 12px 6px' }}>
          <PromptChips size="sm" onPick={chat.setInput} />
        </div>
      )}

      <div style={{ padding: '8px 12px 14px', borderTop: `1px solid ${DARK.border}` }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={chat.input}
            onChange={e => chat.setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={chat.convId ? t('assistant.askAnything') : t('assistant.noConversations')}
            disabled={!chat.convId || chat.streaming}
            rows={2}
            className="kt-input"
            style={{ flex: 1, minHeight: 40, maxHeight: 120, resize: 'none' }}
          />
          <button
            onClick={() => chat.send()}
            disabled={!chat.input.trim() || chat.streaming || !chat.convId}
            aria-label={t('assistant.send')}
            className="kt-btn kt-btn-primary"
            style={{
              padding: '8px 12px', flexShrink: 0,
              opacity: (!chat.input.trim() || chat.streaming || !chat.convId) ? 0.4 : 1,
            }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
