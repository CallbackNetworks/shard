import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getIntegrations, createIntegration, updateIntegration, deleteIntegration, testIntegration } from '../api/client'
import { globalAddToast } from '../context/ToastContext'

const TYPE_ICONS = { jenkins: '⚙️', drone: '🚁', generic: '🔗', email: '📧' }
const ALL_EVENTS = ['task.done', 'task.failed', 'task.in_progress', 'project.complete']

function IntegrationModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial || {
    name: '', type: 'generic', url: '', secret: '', project_id: '', events: ['task.done', 'task.failed', 'project.complete'], active: true,
    email_to: '', email_subject_prefix: '[TODO Platform]',
  })

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const toggleEvent = (ev) => set('events', form.events.includes(ev) ? form.events.filter(e => e !== ev) : [...form.events, ev])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontWeight: 700, marginBottom: 20 }}>{initial ? 'Edit' : 'New'} Integration</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Name
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="My Jenkins"
              style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14 }} />
          </label>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Type
            <select value={form.type} onChange={e => set('type', e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}>
              <option value="jenkins">Jenkins</option>
              <option value="drone">Drone</option>
              <option value="generic">Generic Webhook</option>
              <option value="email">Email</option>
            </select>
          </label>
          {form.type === 'email' ? (
            <>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Recipients (comma-separated) *
                <input value={form.email_to} onChange={e => set('email_to', e.target.value)} placeholder="user@example.com, admin@example.com"
                  style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14 }} />
              </label>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Subject prefix
                <input value={form.email_subject_prefix} onChange={e => set('email_subject_prefix', e.target.value)} placeholder="[TODO Platform]"
                  style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14 }} />
              </label>
            </>
          ) : (
            <>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Webhook URL *
                <input value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://your-server/notify"
                  style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14 }} />
              </label>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Secret (Bearer token, optional)
                <input value={form.secret} onChange={e => set('secret', e.target.value)} placeholder="token..."
                  style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14 }} />
              </label>
            </>
          )}
          <label style={{ fontSize: 13, fontWeight: 600 }}>Project ID (leave blank for global)
            <input value={form.project_id} onChange={e => set('project_id', e.target.value)} placeholder="(all projects)"
              style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14 }} />
          </label>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Events
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {ALL_EVENTS.map(ev => (
                <label key={ev} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', background: form.events.includes(ev) ? '#ede9fe' : '#f3f4f6', borderRadius: 999, padding: '4px 12px', fontSize: 13 }}>
                  <input type="checkbox" checked={form.events.includes(ev)} onChange={() => toggleEvent(ev)} style={{ cursor: 'pointer' }} />
                  {ev}
                </label>
              ))}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
            Active
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={() => onSave(form)} disabled={!form.name || (form.type !== 'email' && !form.url) || (form.type === 'email' && !form.email_to)}
            style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 600 }}>Save</button>
          <button onClick={onClose} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function Integrations() {
  const qc = useQueryClient()
  const { data: integrations = [], isLoading } = useQuery({ queryKey: ['integrations'], queryFn: getIntegrations })
  const [modal, setModal] = useState(null) // null | { mode: 'create' | 'edit', data?: ... }
  const [testResults, setTestResults] = useState({})

  const invalidate = () => qc.invalidateQueries({ queryKey: ['integrations'] })

  const _checkSmtpWarning = (data) => {
    if (data?.smtp_warning) globalAddToast(data.smtp_warning, 'warning')
  }

  const createMut = useMutation({
    mutationFn: createIntegration,
    onSuccess: (data) => { invalidate(); setModal(null); _checkSmtpWarning(data) }
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateIntegration(id, data),
    onSuccess: (data) => { invalidate(); setModal(null); _checkSmtpWarning(data) }
  })

  const deleteMut = useMutation({
    mutationFn: deleteIntegration,
    onSuccess: invalidate
  })

  const testMut = useMutation({
    mutationFn: testIntegration,
    onSuccess: (data, id) => setTestResults(r => ({ ...r, [id]: data }))
  })

  const handleSave = (form) => {
    const data = {
      ...form,
      project_id: form.project_id || null,
      secret: form.secret || null,
      email_to: form.email_to || null,
      email_subject_prefix: form.email_subject_prefix || '[TODO Platform]',
    }
    if (form.type === 'email' && !data.url) data.url = ''
    if (modal.mode === 'edit') updateMut.mutate({ id: modal.data.id, data })
    else createMut.mutate(data)
  }

  if (isLoading) return <p style={{ color: '#6b7280' }}>Loading...</p>

  return (
    <div>
      {modal && <IntegrationModal initial={modal.data} onSave={handleSave} onClose={() => setModal(null)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Integrations</h1>
          <p style={{ color: '#6b7280', marginTop: 4 }}>Configure outbound CI/CD notifications</p>
        </div>
        <button onClick={() => setModal({ mode: 'create' })}
          style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 }}>+ New Integration</button>
      </div>

      {integrations.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <p style={{ fontSize: 18 }}>No integrations yet</p>
          <p style={{ marginTop: 8 }}>Add a Jenkins, Drone, generic webhook, or email integration to get notified on task updates</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {integrations.map(intg => (
            <div key={intg.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{TYPE_ICONS[intg.type]}</span>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{intg.name}</span>
                    <span style={{
                      background: intg.active ? '#d1fae5' : '#f3f4f6', color: intg.active ? '#065f46' : '#6b7280',
                      borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600
                    }}>{intg.active ? 'active' : 'inactive'}</span>
                    <span style={{ background: '#ede9fe', color: '#4f46e5', borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{intg.type}</span>
                  </div>
                  {intg.type === 'email'
                    ? <p style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>To: {intg.email_to}</p>
                    : <p style={{ color: '#6b7280', fontSize: 13, marginTop: 4, fontFamily: 'monospace' }}>{intg.url}</p>
                  }
                  {intg.project_id && <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>Project: {intg.project_id}</p>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {intg.events.map(ev => (
                      <span key={ev} style={{ background: '#f0fdf4', color: '#166534', borderRadius: 999, padding: '2px 8px', fontSize: 12 }}>{ev}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => testMut.mutate(intg.id)}
                    style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>
                    {testMut.isPending ? 'Testing...' : 'Test'}
                  </button>
                  <button onClick={() => setModal({ mode: 'edit', data: { ...intg, secret: intg.secret || '', project_id: intg.project_id || '', email_to: intg.email_to || '', email_subject_prefix: intg.email_subject_prefix || '[TODO Platform]' } })}
                    style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>Edit</button>
                  <button onClick={() => deleteMut.mutate(intg.id)}
                    style={{ background: 'none', border: '1px solid #fca5a5', color: '#ef4444', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>Delete</button>
                </div>
              </div>
              {testResults[intg.id] && (
                <div style={{ marginTop: 10, background: testResults[intg.id].success ? '#f0fdf4' : '#fef2f2', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: testResults[intg.id].success ? '#166534' : '#991b1b' }}>
                  {testResults[intg.id].success
                    ? `✓ Test sent (HTTP ${testResults[intg.id].status_code})`
                    : `✗ Failed: ${testResults[intg.id].error}`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
