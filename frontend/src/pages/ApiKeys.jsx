import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Check, AlertTriangle, X, Key } from 'lucide-react'
import { getApiKeys, createApiKey, updateApiKey, deleteApiKey, getProjects } from '../api/client'
import { useToast } from '../context/ToastContext'
import { BRAND } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'

const SCOPES = ['read', 'write', 'admin']

const inputStyle = {
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px',
  fontSize: 14, background: 'rgba(255,255,255,0.05)', color: '#ffffff',
  display: 'block', width: '100%', marginTop: 4, boxSizing: 'border-box',
}

const METHOD_STYLE = {
  GET:    { bg: 'rgba(96,165,250,0.15)',  color: '#60a5fa' },
  POST:   { bg: 'rgba(239,68,68,0.15)',   color: '#ef4444' },
  PATCH:  { bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24' },
  DELETE: { bg: 'rgba(239,68,68,0.15)',   color: '#ef4444' },
}

export default function ApiKeys() {
  const { t } = useTranslation()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const qc = useQueryClient()
  const { data: apiKeys = [], isLoading } = useQuery({ queryKey: ['api-keys'], queryFn: getApiKeys })
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: getProjects })
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', project_id: '', scopes: ['read', 'write'] })
  const [copiedId, setCopiedId] = useState(null)
  const [newKey, setNewKey] = useState(null)   // full key shown once after creation

  const { addToast } = useToast()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['api-keys'] })

  const createMut = useMutation({
    mutationFn: createApiKey,
    onSuccess: (data) => {
      invalidate()
      setShowCreate(false)
      setForm({ name: '', project_id: '', scopes: ['read', 'write'] })
      setNewKey(data.key)
      addToast(t('apiKeys.createdSuccess'), 'success')
    }
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateApiKey(id, data),
    onSuccess: () => { invalidate(); addToast(t('apiKeys.updatedSuccess'), 'success') },
  })

  const deleteMut = useMutation({
    mutationFn: deleteApiKey,
    onSuccess: () => { invalidate(); addToast(t('apiKeys.deletedSuccess'), 'success') },
  })

  const toggleScope = (scope) => {
    setForm(f => ({
      ...f,
      scopes: f.scopes.includes(scope) ? f.scopes.filter(s => s !== scope) : [...f.scopes, scope]
    }))
  }

  const copyKey = (id, key) => {
    navigator.clipboard.writeText(key)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleCreate = () => {
    createMut.mutate({
      ...form,
      project_id: form.project_id || null,
    })
  }

  if (isLoading) return <p style={{ color: 'rgba(255,255,255,0.35)', padding: 24 }}>{t('loading')}</p>

  return (
    <div className="page-content" style={{ padding: isMobile ? '20px 16px' : '32px 40px' }}>
      {/* Show-once modal for newly created key */}
      {newKey && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)',
        }}>
          <div style={{
            background: '#111827', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
            padding: 28, width: 520, maxWidth: '90vw',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{t('apiKeys.createdTitle')}</span>
              <button onClick={() => setNewKey(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 12, padding: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8 }}>
              <AlertTriangle size={14} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: '#fbbf24' }}>
                {t('apiKeys.copyWarning')}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <code style={{
                flex: 1, background: 'rgba(0,0,0,0.4)', padding: '8px 12px', borderRadius: 6, fontSize: 13,
                fontFamily: 'monospace', color: '#ef4444', wordBreak: 'break-all', border: '1px solid rgba(255,255,255,0.08)',
              }}>
                {newKey}
              </code>
              <button onClick={() => copyKey('new', newKey)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: copiedId === 'new' ? '#ef4444' : '#9ca3af', padding: 4, flexShrink: 0 }}>
                {copiedId === 'new' ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <button onClick={() => setNewKey(null)} className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
              {t('apiKeys.savedConfirm')}
            </button>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: 24, flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 18 : 24, fontWeight: 700, color: '#ffffff' }}>{t('apiKeys.title')}</h1>
          <p style={{ color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{t('apiKeys.subtitle')}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {t('apiKeys.new')}
        </button>
      </div>

      {showCreate && (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <h3 style={{ fontWeight: 600, marginBottom: 16, color: '#ffffff' }}>{t('create')} {t('apiKeys.title')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>{t('name')} *
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={t('apiKeys.namePlaceholder')}
                style={inputStyle} />
            </label>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>{t('apiKeys.projectScope')}
              <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}
                style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">{t('apiKeys.allProjects')}</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>{t('apiKeys.scopes')}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {SCOPES.map(scope => (
                  <label key={scope} style={{
                    display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                    background: form.scopes.includes(scope) ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.05)',
                    color: form.scopes.includes(scope) ? BRAND : 'rgba(255,255,255,0.4)',
                    borderRadius: 999, padding: '4px 12px', fontSize: 13,
                    border: form.scopes.includes(scope) ? `1px solid rgba(239,68,68,0.3)` : '1px solid rgba(255,255,255,0.08)',
                  }}>
                    <input type="checkbox" checked={form.scopes.includes(scope)} onChange={() => toggleScope(scope)} style={{ cursor: 'pointer' }} />
                    {scope}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={handleCreate} disabled={!form.name || form.scopes.length === 0}
              className="btn-primary" style={{ opacity: (!form.name || form.scopes.length === 0) ? 0.4 : 1 }}>{t('create')}</button>
            <button onClick={() => setShowCreate(false)} className="btn-ghost">{t('cancel')}</button>
          </div>
        </div>
      )}

      {apiKeys.length === 0 && !showCreate ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.2)', animation: 'fadeIn 0.4s ease' }}>
          <Key size={36} style={{ margin: '0 auto 14px', opacity: 0.3, display: 'block', color: BRAND }} />
          <p style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>{t('apiKeys.empty')}</p>
          <p style={{ marginTop: 6, fontSize: 13 }}>{t('apiKeys.emptyHint')}</p>
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary" style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {t('apiKeys.new')}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {apiKeys.map((ak, akIdx) => (
            <div key={ak.id} style={{
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12, padding: '16px 20px',
              animation: 'fadeUpIn 0.35s ease forwards',
              animationDelay: `${akIdx * 0.06}s`,
              opacity: 0,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 10 : 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: isMobile ? 13 : 15, color: '#ffffff' }}>{ak.name}</span>
                    <span style={{
                      background: ak.active ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.06)',
                      color: ak.active ? '#ef4444' : 'rgba(255,255,255,0.35)',
                      borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600,
                    }}>{ak.active ? 'active' : 'inactive'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <code style={{
                      background: 'rgba(255,255,255,0.06)', padding: '4px 10px', borderRadius: 6, fontSize: 13,
                      fontFamily: 'monospace', color: '#ef4444',
                    }}>
                      {ak.key_preview}
                    </code>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                    {ak.scopes.map(s => (
                      <span key={s} style={{ background: 'rgba(239,68,68,0.12)', color: BRAND, borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{s}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
                    {ak.project_id
                      ? `Project: ${projects.find(p => p.id === ak.project_id)?.name || ak.project_id}`
                      : 'All projects'}
                    {ak.last_used_at && ` · Last used: ${new Date(ak.last_used_at).toLocaleString()}`}
                    {` · Created: ${new Date(ak.created_at).toLocaleString()}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => updateMut.mutate({ id: ak.id, data: { active: !ak.active } })}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, color: '#ffffff' }}>
                    {ak.active ? t('apiKeys.disable') : t('apiKeys.enable')}
                  </button>
                  <button onClick={() => { if (confirm('Delete this API key?')) deleteMut.mutate(ak.id) }}
                    style={{ background: 'none', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>
                    {t('delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 32, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 12, color: '#ffffff' }}>{t('apiKeys.usage')}</h3>
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginBottom: 12 }}>
          Use the <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 3, color: '#ef4444' }}>X-API-Key</code> header to authenticate requests to <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 3, color: '#ef4444' }}>/api/v1/</code> endpoints.
        </p>
        <div style={{ background: '#1e1e2e', borderRadius: 8, padding: 16, overflow: 'auto' }}>
          <pre style={{ margin: 0, color: '#cdd6f4', fontSize: 13, lineHeight: 1.6 }}>{`# List projects
curl -H "X-API-Key: tdp_your_key_here" \\
  http://localhost:8000/api/v1/projects

# Create a task
curl -X POST -H "X-API-Key: tdp_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "Deploy v2", "priority": "high"}' \\
  http://localhost:8000/api/v1/projects/{project_id}/tasks

# Get project stats
curl -H "X-API-Key: tdp_your_key_here" \\
  http://localhost:8000/api/v1/projects/{project_id}/stats

# Bulk create tasks
curl -X POST -H "X-API-Key: tdp_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '[{"title": "Task 1"}, {"title": "Task 2"}]' \\
  http://localhost:8000/api/v1/projects/{project_id}/tasks/bulk

# Send email directly
curl -X POST -H "X-API-Key: tdp_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"to": ["user@example.com"], "subject": "Hello", "body": "Test"}' \\
  http://localhost:8000/api/v1/email/send`}</pre>
        </div>

        <h4 style={{ fontWeight: 600, marginTop: 20, marginBottom: 8, color: '#ffffff' }}>{t('apiKeys.availableEndpoints')}</h4>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>{t('method')}</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>{t('endpoint')}</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>{t('scope')}</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>{t('description')}</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['GET', '/api/v1/projects', 'read', 'List projects'],
              ['GET', '/api/v1/projects/:id', 'read', 'Get project with tasks'],
              ['POST', '/api/v1/projects', 'write', 'Create project'],
              ['PATCH', '/api/v1/projects/:id', 'write', 'Update project'],
              ['DELETE', '/api/v1/projects/:id', 'admin', 'Delete project'],
              ['GET', '/api/v1/projects/:id/tasks', 'read', 'List tasks (filter: status, priority)'],
              ['GET', '/api/v1/projects/:id/tasks/:tid', 'read', 'Get task'],
              ['POST', '/api/v1/projects/:id/tasks', 'write', 'Create task'],
              ['PATCH', '/api/v1/projects/:id/tasks/:tid', 'write', 'Update task (triggers notifications)'],
              ['DELETE', '/api/v1/projects/:id/tasks/:tid', 'write', 'Delete task'],
              ['POST', '/api/v1/projects/:id/tasks/bulk', 'write', 'Bulk create tasks'],
              ['POST', '/api/v1/projects/:id/tasks/bulk-update', 'write', 'Bulk update tasks'],
              ['GET', '/api/v1/projects/:id/stats', 'read', 'Project statistics'],
              ['GET', '/api/v1/email/status', 'read', 'SMTP config status'],
              ['POST', '/api/v1/email/send', 'write', 'Send email directly'],
            ].map(([method, path, scope, desc], i) => (
              <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '6px 12px' }}>
                  <span style={{
                    background: METHOD_STYLE[method]?.bg || 'rgba(255,255,255,0.06)',
                    color: METHOD_STYLE[method]?.color || '#ffffff',
                    padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
                  }}>{method}</span>
                </td>
                <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 12, color: '#ffffff' }}>{path}</td>
                <td style={{ padding: '6px 12px' }}>
                  <span style={{ background: 'rgba(239,68,68,0.12)', color: BRAND, padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{scope}</span>
                </td>
                <td style={{ padding: '6px 12px', color: 'rgba(255,255,255,0.35)' }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
