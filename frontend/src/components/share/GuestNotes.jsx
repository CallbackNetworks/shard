import { useState } from 'react'
import { postShareProjectNote, postShareTaskNote } from '../../api/client'
import { relativeTime } from './utils'

const NAME_KEY = 'kt-share-guest-name'

/**
 * Guest note thread + submit form for the public share page.
 * Attaches to a task when taskId is given, otherwise to the project.
 */
export default function GuestNotes({ token, projectId, taskId, notes }) {
  const [extra, setExtra] = useState([])
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) || '')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const base = notes || []
  const baseIds = new Set(base.map(n => n.id))
  const list = [...base, ...extra.filter(n => !baseIds.has(n.id))]

  const submit = async (e) => {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedBody = body.trim()
    if (!trimmedName || !trimmedBody || busy) return
    setBusy(true)
    setError('')
    try {
      const payload = { guest_name: trimmedName, body: trimmedBody, project_id: projectId }
      const created = taskId
        ? await postShareTaskNote(token, taskId, payload)
        : await postShareProjectNote(token, payload)
      localStorage.setItem(NAME_KEY, trimmedName)
      setExtra(prev => [...prev, created])
      setBody('')
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not send note')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="kt-share-notes" onClick={e => e.stopPropagation()}>
      {list.map(n => (
        <div key={n.id} className={n.is_guest ? 'kt-share-note is-guest' : 'kt-share-note'}>
          <div className="kt-share-note-head">
            <b>{n.is_guest ? n.guest_name : (n.author || 'Owner')}</b>
            {n.is_guest && <em>GUEST</em>}
            <span>{relativeTime(n.created_at)}</span>
          </div>
          <div className="kt-share-note-body">{n.body}</div>
        </div>
      ))}
      <form onSubmit={submit} className="kt-share-note-form">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          maxLength={80}
          aria-label="Your name"
        />
        <input
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Leave a note..."
          maxLength={2000}
          aria-label="Note"
        />
        <button type="submit" disabled={busy || !name.trim() || !body.trim()}>
          {busy ? '...' : 'SEND'}
        </button>
      </form>
      {error && <div className="kt-share-note-error">{error}</div>}
    </div>
  )
}
