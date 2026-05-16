import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getComments, createComment, deleteComment } from '../api/client'

export default function CommentsPanel({ projectId, taskId, depth }) {
  const { t } = useTranslation()
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(false)
  const [body, setBody] = useState('')
  const [author, setAuthor] = useState('')
  const qc = useQueryClient()

  useEffect(() => {
    setLoading(true)
    getComments(projectId, taskId)
      .then(setComments)
      .finally(() => setLoading(false))
  }, [projectId, taskId])

  const handleAdd = async () => {
    if (!body.trim()) return
    const c = await createComment(projectId, taskId, { author: author || null, body: body.trim() })
    setComments(prev => [...prev, c])
    setBody('')
    qc.invalidateQueries({ queryKey: ['project', projectId] })
  }

  const handleDelete = async (commentId) => {
    await deleteComment(projectId, taskId, commentId)
    setComments(prev => prev.filter(c => c.id !== commentId))
    qc.invalidateQueries({ queryKey: ['project', projectId] })
  }

  const padLeft = 16 + depth * 20 + 36

  return (
    <div style={{
      paddingLeft: padLeft, paddingRight: 16,
      paddingTop: 10, paddingBottom: 12,
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      background: 'rgba(255,255,255,0.02)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {t('comments.title')}
      </div>
      {loading ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>Loading{'\u2026'}</div>
      ) : (
        <>
          {comments.length === 0 && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', marginBottom: 8 }}>{t('comments.noComments')}</div>
          )}
          {comments.map(c => (
            <div key={c.id} style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#1ed760' }}>{c.author || t('comments.anonymous')}</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
                    {new Date(c.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <button onClick={() => handleDelete(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(248,113,113,0.5)', padding: 0, display: 'flex' }}>
                    <X size={10} />
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#b3b3b3', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.body}</div>
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={author}
                onChange={e => setAuthor(e.target.value)}
                placeholder={t('comments.yourName')}
                style={{ width: 140, padding: '5px 8px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, fontSize: 11, outline: 'none', background: 'rgba(255,255,255,0.05)', color: '#ffffff' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleAdd() }}
                placeholder={t('comments.addComment')}
                rows={2}
                style={{ flex: 1, padding: '5px 8px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, fontSize: 12, outline: 'none', background: 'rgba(255,255,255,0.05)', color: '#ffffff', resize: 'vertical', minHeight: 40 }}
              />
              <button onClick={handleAdd} disabled={!body.trim()} style={{ padding: '5px 14px', border: 'none', borderRadius: 9999, background: '#1ed760', color: '#000', fontSize: 11, cursor: 'pointer', fontWeight: 700, alignSelf: 'flex-end', opacity: body.trim() ? 1 : 0.4, textTransform: 'uppercase', letterSpacing: '1px' }}>{t('comments.post')}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
