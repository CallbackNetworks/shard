import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench, ChevronDown, Loader, AlertTriangle } from 'lucide-react'
import MarkdownPreview from '../MarkdownPreview'
import { DARK } from '../../constants/theme'
import { alpha } from '../../utils/color'

/** A tool the assistant called, collapsed until you ask what it returned. */
export function ToolBlock({ name, result }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{
      background: DARK.infoBg, border: `1px solid ${alpha(DARK.info, 22)}`,
      marginBottom: 6, overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '6px 10px', background: 'none', border: 'none',
          cursor: 'pointer', color: DARK.info, fontSize: 11,
        }}
      >
        <Wrench size={10} />
        <span style={{ flex: 1, textAlign: 'left', fontWeight: 600 }}>{name}</span>
        <ChevronDown size={10} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && result && (
        <pre style={{
          margin: 0, padding: '0 10px 8px', fontSize: 10, color: DARK.textDim,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto',
        }}>
          {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  )
}

/**
 * One turn. The assistant answers in Markdown, so it is rendered as Markdown
 * (ADR-0089) — both surfaces used to print `msg.content` as `pre-wrap` text, so
 * every heading, list, table and bold run arrived as raw `#`, `-`, `|` and `**`.
 * `MarkdownPreview` is the app's one renderer; the user's own turn stays plain
 * because it is what they typed, not something to reinterpret.
 */
export function MessageBubble({ msg, maxWidth = '70%' }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      {msg.tool_calls?.length > 0 && (
        <div style={{ width: '100%', marginBottom: 4 }}>
          {msg.tool_calls.map((tc, i) => <ToolBlock key={i} name={tc.name} result={tc.result} />)}
        </div>
      )}
      {msg.content && (
        <div style={{
          maxWidth, padding: '10px 14px', fontSize: 13, lineHeight: 1.6,
          background: isUser ? DARK.infoBg : DARK.elevated,
          border: `1px solid ${isUser ? alpha(DARK.info, 30) : DARK.border}`,
          color: DARK.text, wordBreak: 'break-word',
        }}>
          {isUser
            ? <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
            : <MarkdownPreview content={msg.content} />}
        </div>
      )}
    </div>
  )
}

/**
 * The reply as it arrives. Deliberately *not* Markdown: half-written syntax
 * renders as garbage, and re-parsing the whole answer on every chunk is work
 * thrown away. The finished message re-renders through MessageBubble.
 */
export function StreamingMessage({ events, maxWidth = '70%' }) {
  const text = events.filter(e => e.type === 'text').map(e => e.text).join('')
  const toolStarts = events.filter(e => e.type === 'tool_start')
  const toolResults = events.filter(e => e.type === 'tool_result')
  const error = events.find(e => e.type === 'error')
  // A tool result is never the last thing the assistant says (ADR-0104: it always
  // gets fed back for another round) — if it's the most recent event, the next
  // round is in flight and there's nothing else to show yet but this.
  const awaitingNextRound = events.length > 0 && events[events.length - 1].type === 'tool_result'
  return (
    <div style={{ marginBottom: 14 }}>
      {toolStarts.map((ts, i) => (
        <ToolBlock key={i} name={ts.name} result={toolResults.find(tr => tr.name === ts.name)?.result} />
      ))}
      {awaitingNextRound && <ThinkingRow />}
      {text && (
        <div style={{
          maxWidth, padding: '10px 14px', fontSize: 13, lineHeight: 1.6,
          background: DARK.elevated, border: `1px solid ${DARK.border}`,
          color: DARK.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {text}
          <span style={{
            display: 'inline-block', width: 2, height: 14, background: DARK.info,
            marginLeft: 2, verticalAlign: 'text-bottom', animation: 'kineticBlink 1s infinite',
          }} />
        </div>
      )}
      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, maxWidth,
          padding: '8px 12px', fontSize: 12, color: DARK.danger,
          background: DARK.dangerBg, border: `1px solid ${alpha(DARK.danger, 30)}`,
        }}>
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          {error.message}
        </div>
      )}
    </div>
  )
}

/** "Thinking…" — shown only before the first event of a reply. */
export function ThinkingRow() {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: DARK.textDim, fontSize: 12, padding: '8px 0' }}>
      <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> {t('assistant.thinking')}
    </div>
  )
}
