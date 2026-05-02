import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-react'
import { getIntegrations, createIntegration, updateIntegration, deleteIntegration, testIntegration, getDeliveries, retryDelivery } from '../api/client'
import { globalAddToast } from '../context/ToastContext'
import { BRAND, BTN_PRIMARY, BTN_GHOST, BTN_SM } from '../constants/theme'

const TYPE_ICONS = { jenkins: '⚙️', drone: '🚁', generic: '🔗', email: '📧', webhook: '🪝' }
const ALL_EVENTS = ['task.done', 'task.failed', 'task.in_progress', 'project.complete', 'task.due_soon', 'task.overdue']

const STATUS_COLORS = {
  success: { bg: 'rgba(52,211,153,0.1)',  color: '#1ed760', dot: '#22c55e' },
  failed:  { bg: 'rgba(248,113,113,0.1)', color: '#f87171', dot: '#ef4444' },
  dead:    { bg: 'rgba(248,113,113,0.1)', color: '#fca5a5', dot: '#b91c1c' },
  pending: { bg: 'rgba(251,191,36,0.1)',  color: '#fbbf24', dot: '#f59e0b' },
}

function DeliveryDetailModal({ delivery, onClose, onRetry }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: '#181818', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 24, width: '90vw', maxWidth: 560, maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontWeight: 700, color: '#ffffff', margin: 0 }}>Delivery Detail</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)' }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Row label="Event" value={delivery.event} />
          <Row label="Status" value={delivery.status} color={STATUS_COLORS[delivery.status]?.color} />
          <Row label="Status Code" value={delivery.status_code ?? '—'} />
          <Row label="Attempt" value={delivery.attempt} />
          <Row label="URL" value={delivery.request_url} mono />
          <Row label="Created" value={new Date(delivery.created_at).toLocaleString()} />
          {delivery.delivered_at && <Row label="Delivered" value={new Date(delivery.delivered_at).toLocaleString()} />}
          {delivery.next_retry_at && <Row label="Next Retry" value={new Date(delivery.next_retry_at).toLocaleString()} />}
          {delivery.error && (
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Error</div>
              <pre style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '8px 10px', color: '#fca5a5', fontSize: 11, whiteSpace: 'pre-wrap', margin: 0 }}>{delivery.error}</pre>
            </div>
          )}
          {delivery.response_body && (
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Response Body</div>
              <pre style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '8px 10px', color: '#b3b3b3', fontSize: 11, whiteSpace: 'pre-wrap', margin: 0, maxHeight: 120, overflow: 'auto' }}>{delivery.response_body}</pre>
            </div>
          )}
          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Payload</div>
            <pre style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '8px 10px', color: '#b3b3b3', fontSize: 11, whiteSpace: 'pre-wrap', margin: 0, maxHeight: 180, overflow: 'auto' }}>{JSON.stringify(delivery.payload, null, 2)}</pre>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {['failed', 'dead'].includes(delivery.status) && (
            <button onClick={() => onRetry(delivery.id)} style={BTN_PRIMARY}>
              Retry
            </button>
          )}
          <button onClick={onClose} style={BTN_GHOST}>Close</button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, mono, color }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', minWidth: 80, paddingTop: 1 }}>{label}</span>
      <span style={{ color: color || '#b3b3b3', fontFamily: mono ? 'monospace' : 'inherit', fontSize: 12, wordBreak: 'break-all' }}>{String(value)}</span>
    </div>
  )
}

function DeliveryLog({ integrationId }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState(null)

  const { data: deliveries = [], refetch } = useQuery({
    queryKey: ['deliveries', integrationId],
    queryFn: () => getDeliveries(integrationId),
    enabled: expanded,
    staleTime: 10000,
  })

  const retryMut = useMutation({
    mutationFn: retryDelivery,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deliveries', integrationId] }); setSelected(null) },
  })

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', fontSize: 12, padding: 0 }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Recent Deliveries
        <button
          onClick={(e) => { e.stopPropagation(); refetch() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)', padding: '0 2px', display: 'flex' }}
          title="Refresh"
        >
          <RefreshCw size={10} />
        </button>
      </button>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {deliveries.length === 0 ? (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', padding: '4px 0' }}>No deliveries yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {deliveries.slice(0, 10).map(d => {
                const sc = STATUS_COLORS[d.status] || STATUS_COLORS.pending
                return (
                  <div
                    key={d.id}
                    onClick={() => setSelected(d)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: sc.dot, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', flex: 1 }}>{d.event}</span>
                    <span style={{ fontSize: 10, color: sc.color, fontWeight: 600 }}>{d.status_code ?? d.status}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
                      {new Date(d.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {['failed', 'dead'].includes(d.status) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); retryMut.mutate(d.id) }}
                        style={{ fontSize: 10, padding: '1px 6px', border: '1px solid rgba(79,70,229,0.4)', borderRadius: 4, background: 'rgba(79,70,229,0.1)', color: '#1ed760', cursor: 'pointer' }}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {selected && (
        <DeliveryDetailModal
          delivery={selected}
          onClose={() => setSelected(null)}
          onRetry={(id) => retryMut.mutate(id)}
        />
      )}
    </div>
  )
}

function IntegrationModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial || {
    name: '', type: 'generic', url: '', secret: '', project_id: '', events: ['task.done', 'task.failed', 'project.complete'], active: true,
    email_to: '', email_subject_prefix: '[TODO Platform]',
  })

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const toggleEvent = (ev) => set('events', form.events.includes(ev) ? form.events.filter(e => e !== ev) : [...form.events, ev])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: '#181818', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 28, width: '90vw', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontWeight: 700, marginBottom: 20, color: '#ffffff' }}>{initial ? 'Edit' : 'New'} Integration</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>Name
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="My Jenkins"
              style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 14, background: 'rgba(255,255,255,0.05)', color: '#ffffff' }} />
          </label>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>Type
            <select value={form.type} onChange={e => set('type', e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 14, background: '#181818', color: '#ffffff' }}>
              <option value="jenkins">Jenkins</option>
              <option value="drone">Drone</option>
              <option value="generic">Generic Webhook</option>
              <option value="webhook">Webhook (HMAC signed)</option>
              <option value="email">Email</option>
            </select>
          </label>
          {form.type === 'email' ? (
            <>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>Recipients (comma-separated) *
                <input value={form.email_to} onChange={e => set('email_to', e.target.value)} placeholder="user@example.com, admin@example.com"
                  style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 14, background: 'rgba(255,255,255,0.05)', color: '#ffffff' }} />
              </label>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>Subject prefix
                <input value={form.email_subject_prefix} onChange={e => set('email_subject_prefix', e.target.value)} placeholder="[TODO Platform]"
                  style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 14, background: 'rgba(255,255,255,0.05)', color: '#ffffff' }} />
              </label>
            </>
          ) : (
            <>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>Webhook URL *
                <input value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://your-server/notify"
                  style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 14, background: 'rgba(255,255,255,0.05)', color: '#ffffff' }} />
              </label>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                {form.type === 'webhook' ? 'Signing Secret (HMAC-SHA256)' : 'Secret (Bearer token, optional)'}
                <input value={form.secret} onChange={e => set('secret', e.target.value)}
                  placeholder={form.type === 'webhook' ? 'your-secret-key' : 'token...'}
                  style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 14, background: 'rgba(255,255,255,0.05)', color: '#ffffff' }} />
              </label>
              {form.type === 'webhook' && (
                <div style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#60a5fa' }}>
                  Requests will include <code>X-Signature: sha256=...</code> and <code>X-Hub-Signature-256</code> headers for verification (GitHub-compatible format).
                </div>
              )}
            </>
          )}
          <label style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>Project ID (leave blank for global)
            <input value={form.project_id} onChange={e => set('project_id', e.target.value)} placeholder="(all projects)"
              style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 14, background: 'rgba(255,255,255,0.05)', color: '#ffffff' }} />
          </label>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>Events
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {ALL_EVENTS.map(ev => (
                <label key={ev} style={{
                  display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                  background: form.events.includes(ev) ? 'rgba(30,215,96,0.12)' : 'rgba(255,255,255,0.05)',
                  color: form.events.includes(ev) ? '#1ed760' : 'rgba(255,255,255,0.4)',
                  borderRadius: 999, padding: '4px 12px', fontSize: 13,
                  border: form.events.includes(ev) ? '1px solid rgba(30,215,96,0.3)' : '1px solid rgba(255,255,255,0.08)',
                }}>
                  <input type="checkbox" checked={form.events.includes(ev)} onChange={() => toggleEvent(ev)} style={{ cursor: 'pointer' }} />
                  {ev}
                </label>
              ))}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#ffffff' }}>
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
            Active
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={() => onSave(form)} disabled={!form.name || (form.type !== 'email' && !form.url) || (form.type === 'email' && !form.email_to)}
            style={BTN_PRIMARY}>Save</button>
          <button onClick={onClose} style={BTN_GHOST}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function Integrations() {
  const qc = useQueryClient()
  const { data: integrations = [], isLoading } = useQuery({ queryKey: ['integrations'], queryFn: getIntegrations })
  const [modal, setModal] = useState(null)
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

  if (isLoading) return <p style={{ color: 'rgba(255,255,255,0.35)' }}>Loading...</p>

  return (
    <div style={{ padding: '32px 40px' }}>
      {modal && <IntegrationModal initial={modal.data} onSave={handleSave} onClose={() => setModal(null)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#ffffff' }}>Integrations</h1>
          <p style={{ color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>Configure outbound CI/CD notifications</p>
        </div>
        <button onClick={() => setModal({ mode: 'create' })} style={BTN_PRIMARY}>+ New Integration</button>
      </div>

      {integrations.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.25)' }}>
          <p style={{ fontSize: 18 }}>No integrations yet</p>
          <p style={{ marginTop: 8 }}>Add a Jenkins, Drone, generic webhook, or email integration to get notified on task updates</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {integrations.map(intg => (
            <div key={intg.id} style={{ background: '#181818', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{TYPE_ICONS[intg.type]}</span>
                    <span style={{ fontWeight: 600, fontSize: 15, color: '#ffffff' }}>{intg.name}</span>
                    <span style={{
                      background: intg.active ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.07)',
                      color: intg.active ? '#1ed760' : '#6b7280',
                      borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600
                    }}>{intg.active ? 'active' : 'inactive'}</span>
                    <span style={{ background: 'rgba(30,215,96,0.12)', color: '#1ed760', borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{intg.type}</span>
                  </div>
                  {intg.type === 'email'
                    ? <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 4 }}>To: {intg.email_to}</p>
                    : <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 4, fontFamily: 'monospace' }}>{intg.url}</p>
                  }
                  {intg.project_id && <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, marginTop: 2 }}>Project: {intg.project_id}</p>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {intg.events.map(ev => (
                      <span key={ev} style={{ background: 'rgba(52,211,153,0.1)', color: '#1ed760', borderRadius: 999, padding: '2px 8px', fontSize: 12 }}>{ev}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => testMut.mutate(intg.id)}
                    style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', color: '#1ed760', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>
                    {testMut.isPending ? 'Testing...' : 'Test'}
                  </button>
                  <button onClick={() => setModal({ mode: 'edit', data: { ...intg, secret: intg.secret || '', project_id: intg.project_id || '', email_to: intg.email_to || '', email_subject_prefix: intg.email_subject_prefix || '[TODO Platform]' } })}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#b3b3b3', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>Edit</button>
                  <button onClick={() => deleteMut.mutate(intg.id)}
                    style={{ background: 'none', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>Delete</button>
                </div>
              </div>
              {testResults[intg.id] && (
                <div style={{ marginTop: 10, background: testResults[intg.id].success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: testResults[intg.id].success ? '#1ed760' : '#f87171' }}>
                  {testResults[intg.id].success
                    ? `✓ Test sent (HTTP ${testResults[intg.id].status_code})`
                    : `✗ Failed: ${testResults[intg.id].error}`}
                </div>
              )}
              {/* Only show delivery log for webhook-type integrations */}
              {intg.type !== 'email' && <DeliveryLog integrationId={intg.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
