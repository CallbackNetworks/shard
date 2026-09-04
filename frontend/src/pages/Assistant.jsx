import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircle, Plus, Send, Trash2, Search } from 'lucide-react'
import { BRAND, DARK } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'
import useAssistantChat from '../components/assistant/useAssistantChat'
import PromptChips from '../components/assistant/PromptChips'
import { MessageBubble, StreamingMessage, ThinkingRow } from '../components/assistant/ChatMessages'
import { alpha } from '../utils/color'

/**
 * The full-page assistant. Layout only — the conversation, the streaming and the
 * prompts are `useAssistantChat` / `PromptChips` / `ChatMessages`, shared with
 * the floating panel (ADR-0089).
 */
export default function Assistant() {
  const { t } = useTranslation()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const [showSidebar, setShowSidebar] = useState(!isMobile)

  const chat = useAssistantChat()

  const pick = (conversationId) => {
    chat.setConvId(conversationId)
    if (isMobile) setShowSidebar(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chat.send() }
  }

  return (
    <div className="kt-assistant-page" style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {showSidebar && (
        <div className="kt-assistant-rail" data-tour="assistant-rail" style={{
          width: isMobile ? '100%' : 260, flexShrink: 0,
          borderRight: isMobile ? 'none' : `1px solid ${DARK.border}`,
          display: 'flex', flexDirection: 'column', background: DARK.bg,
          position: isMobile ? 'absolute' : 'relative',
          zIndex: isMobile ? 10 : 1, height: '100%',
        }}>
          <div className="kt-assistant-rail-header" style={{ padding: '16px 14px 10px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <MessageCircle size={16} color={BRAND} />
            <span style={{ flex: 1, fontSize: 22, fontWeight: 400, color: DARK.text, fontFamily: 'var(--kt-display)', textTransform: 'uppercase' }}>
              {t('assistant.title')}
            </span>
            <button
              onClick={chat.createConversation}
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
                value={chat.search}
                onChange={e => chat.setSearch(e.target.value)}
                placeholder={t('assistant.searchConversations')}
                className="kt-input"
                style={{ paddingLeft: 26, fontSize: 12 }}
              />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {chat.conversations.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: DARK.textDim, fontSize: 12 }}>
                {chat.search ? t('assistant.noMatches') : t('assistant.noConversations')}
              </div>
            )}
            {chat.conversations.map(c => (
              <div
                key={c.id}
                onClick={() => pick(c.id)}
                className={c.id === chat.convId ? 'kt-assistant-conversation is-active' : 'kt-assistant-conversation'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 12px', cursor: 'pointer',
                  background: c.id === chat.convId ? DARK.infoBg : 'transparent',
                  borderLeft: c.id === chat.convId ? `2px solid ${DARK.info}` : '2px solid transparent',
                  transition: 'background 0.15s',
                }}
              >
                <span style={{
                  flex: 1, fontSize: 12, color: c.id === chat.convId ? DARK.text : DARK.textMid,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {c.title}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); chat.deleteConversation(c.id) }}
                  aria-label={t('delete')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textDim, padding: 2, display: 'flex', flexShrink: 0 }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="kt-assistant-stage" data-tour="assistant-stage" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="kt-page-header" style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '22px 24px 16px', borderBottom: `1px solid ${DARK.border}`, marginBottom: 0,
        }}>
          {isMobile && (
            <button
              onClick={() => setShowSidebar(v => !v)}
              aria-label={t('assistant.conversations')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: 2 }}
            >
              <MessageCircle size={16} />
            </button>
          )}
          {/* The heading names the thing on screen; when nothing is open the
              title is the section, not an instruction shouted in display type. */}
          <span className="kt-page-title" style={{ flex: 1, fontSize: 38, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {chat.conversation?.title || t('assistant.title')}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 12px' : '20px 24px' }}>
          {!chat.convId ? (
            <div className="kt-empty" style={{ margin: '48px auto 0', maxWidth: 680, textAlign: 'center' }}>
              <MessageCircle size={44} className="kt-empty-icon" />
              <p className="kt-empty-title">{t('assistant.welcomeTitle')}</p>
              <p style={{ color: DARK.textMid, fontSize: 13, lineHeight: 1.6, maxWidth: 460, margin: '4px auto 22px' }}>
                {t('assistant.welcomeSubtitle')}
              </p>
              <div style={{ maxWidth: 620, margin: '0 auto 22px' }}>
                <PromptChips onPick={chat.startWith} />
              </div>
              <button onClick={chat.createConversation} className="kt-btn kt-btn-primary">
                {t('assistant.newChat')}
              </button>
            </div>
          ) : (
            <>
              {chat.messages.length === 0 && !chat.streaming && (
                <div style={{ padding: '40px 0' }}>
                  <div style={{ textAlign: 'center', color: DARK.textDim, marginBottom: 20, fontSize: 13 }}>
                    {t('assistant.startPrompt')}
                  </div>
                  <PromptChips onPick={(text) => chat.send(text)} />
                </div>
              )}
              {chat.messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
              {chat.showStreaming && <StreamingMessage events={chat.streamEvents} />}
              {chat.streaming && chat.streamEvents.length === 0 && <ThinkingRow />}
            </>
          )}
          <div ref={chat.endRef} />
        </div>

        {chat.convId && (
          <div style={{ padding: isMobile ? '10px 12px 14px' : '12px 24px 16px', borderTop: `1px solid ${DARK.border}` }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <textarea
                value={chat.input}
                onChange={e => chat.setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('assistant.askAnything')}
                disabled={chat.streaming}
                rows={2}
                className="kt-input"
                style={{
                  flex: 1, background: DARK.elevated, padding: '10px 14px',
                  fontSize: 14, color: DARK.text, outline: 'none', resize: 'none',
                  minHeight: 44, maxHeight: 160, lineHeight: 1.5,
                }}
              />
              <button
                onClick={() => chat.send()}
                disabled={!chat.input.trim() || chat.streaming}
                aria-label={t('assistant.send')}
                className="kt-btn kt-btn-primary"
                style={{ padding: 12, opacity: (!chat.input.trim() || chat.streaming) ? 0.4 : 1, flexShrink: 0, border: `1px solid ${alpha(BRAND, 40)}` }}
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
