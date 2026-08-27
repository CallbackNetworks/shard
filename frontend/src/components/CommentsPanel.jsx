import { useState, useRef } from 'react'
import Button from './shared/Button'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getComments, createComment, deleteComment, getIdentities } from '../api/client'
import { qk } from '../api/queryKeys'
import { DARK } from '../constants/theme'

function renderMentions(text) {
  const parts = text.split(/(@\w+)/g)
  return parts.map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} style={{ color: DARK.info, fontWeight: 600, cursor: 'default' }}>{part}</span>
    ) : part
  )
}

export default function CommentsPanel({ projectId, taskId, depth }) {
  const { t } = useTranslation()
  const [body, setBody] = useState('')
  const [author, setAuthor] = useState('')
  const [showMentions, setShowMentions] = useState(false)
  const textareaRef = useRef(null)
  const qc = useQueryClient()

  const { data: comments = [], isLoading: loading } = useQuery({
    queryKey: qk.comments(projectId, taskId),
    queryFn: () => getComments(projectId, taskId),
  })

  const { data: identities = [] } = useQuery({
    queryKey: qk.identities(),
    queryFn: getIdentities,
    staleTime: 30000,
  })

  const addMut = useMutation({
    mutationFn: (data) => createComment(projectId, taskId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.comments(projectId, taskId) })
      qc.invalidateQueries({ queryKey: qk.project(projectId) })
      setBody('')
    },
  })

  const deleteMut = useMutation({
    mutationFn: (commentId) => deleteComment(projectId, taskId, commentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.comments(projectId, taskId) })
      qc.invalidateQueries({ queryKey: qk.project(projectId) })
    },
  })

  const handleAdd = () => {
    if (!body.trim()) return
    addMut.mutate({ author: author || null, body: body.trim() })
  }

  const handleDelete = (commentId) => {
    deleteMut.mutate(commentId)
  }

  const padLeft = 16 + depth * 20 + 36

  return (
    <div style={{
      paddingLeft: padLeft, paddingRight: 16,
      paddingTop: 10, paddingBottom: 12,
      borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.07)',
      background: 'rgba(var(--kt-ink-rgb), 0.02)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(var(--kt-ink-rgb), 0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {t('comments.title')}
      </div>
      {loading ? (
        <div style={{ fontSize: 12, color: 'rgba(var(--kt-ink-rgb), 0.25)' }}>Loading{'\u2026'}</div>
      ) : (
        <>
          {comments.length === 0 && (
            <div style={{ fontSize: 12, color: 'rgba(var(--kt-ink-rgb), 0.2)', marginBottom: 8 }}>{t('comments.noComments')}</div>
          )}
          {comments.map(c => (
            <div key={c.id} style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(var(--kt-ink-rgb), 0.04)', border: '1px solid rgba(var(--kt-ink-rgb), 0.07)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: DARK.success }}>{c.author || t('comments.anonymous')}</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'rgba(var(--kt-ink-rgb), 0.2)' }}>
                    {new Date(c.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <button onClick={() => handleDelete(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(250,204,21,0.5)', padding: 0, display: 'flex' }}>
                    <X size={10} />
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: DARK.textMid, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{renderMentions(c.body)}</div>
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={author}
                onChange={e => setAuthor(e.target.value)}
                placeholder={t('comments.yourName')}
                style={{ width: 140, padding: '5px 8px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 5, fontSize: 11, outline: 'none', background: 'rgba(var(--kt-ink-rgb), 0.05)', color: DARK.text }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <textarea
                  ref={textareaRef}
                  value={body}
                  onChange={e => {
                    setBody(e.target.value)
                    const val = e.target.value
                    const pos = e.target.selectionStart
                    const before = val.slice(0, pos)
                    const match = before.match(/@(\w*)$/)
                    setShowMentions(!!match)
                  }}
                  onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleAdd() }}
                  placeholder={t('comments.addComment')}
                  rows={2}
                  style={{ width: '100%', padding: '5px 8px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 5, fontSize: 12, outline: 'none', background: 'rgba(var(--kt-ink-rgb), 0.05)', color: DARK.text, resize: 'vertical', minHeight: 40 }}
                />
                {showMentions && identities.length > 0 && (
                  <div style={{
                    position: 'absolute', bottom: '100%', left: 0, background: DARK.elevated,
                    border: '1px solid rgba(var(--kt-ink-rgb), 0.15)', borderRadius: 6, padding: 4,
                    zIndex: 10, minWidth: 140, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                  }}>
                    {identities.map(ident => (
                      <button
                        key={ident.id}
                        onClick={() => {
                          const ta = textareaRef.current
                          if (!ta) return
                          const pos = ta.selectionStart
                          const before = body.slice(0, pos)
                          const after = body.slice(pos)
                          const replaced = before.replace(/@(\w*)$/, `@${ident.name.replace(/\s+/g, '_')} `)
                          setBody(replaced + after)
                          setShowMentions(false)
                          ta.focus()
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                          padding: '4px 8px', border: 'none', background: 'transparent',
                          color: DARK.text, fontSize: 11, cursor: 'pointer', borderRadius: 4,
                          textAlign: 'left',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(var(--kt-ink-rgb), 0.06)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <span style={{
                          width: 16, height: 16, borderRadius: 4, background: ident.color,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 8, color: '#fff', fontWeight: 900, flexShrink: 0,
                        }}>
                          {ident.avatar || ident.name.charAt(0).toUpperCase()}
                        </span>
                        {ident.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button onClick={handleAdd} disabled={!body.trim()} style={{ alignSelf: 'flex-end' }}>{t('comments.post')}</Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
