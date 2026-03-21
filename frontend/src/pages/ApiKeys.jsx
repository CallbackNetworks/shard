import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Check, Eye, EyeOff } from 'lucide-react'
import { getApiKeys, createApiKey, updateApiKey, deleteApiKey, getProjects } from '../api/client'

const SCOPES = ['read', 'write', 'admin']

export default function ApiKeys() {
  const qc = useQueryClient()
  const { data: apiKeys = [], isLoading } = useQuery({ queryKey: ['api-keys'], queryFn: getApiKeys })
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: getProjects })
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', project_id: '', scopes: ['read', 'write'] })
  const [copiedId, setCopiedId] = useState(null)
  const [visibleKeys, setVisibleKeys] = useState({})

  const invalidate = () => qc.invalidateQueries({ queryKey: ['api-keys'] })

  const createMut = useMutation({
    mutationFn: createApiKey,
    onSuccess: (data) => {
      invalidate()
      setShowCreate(false)
      setForm({ name: '', project_id: '', scopes: ['read', 'write'] })
      setVisibleKeys(v => ({ ...v, [data.id]: true }))
    }
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateApiKey(id, data),
    onSuccess: invalidate,
  })

  const deleteMut = useMutation({
    mutationFn: deleteApiKey,
    onSuccess: invalidate,
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

  const maskKey = (key) => key.slice(0, 8) + '••••••••••••••••' + key.slice(-4)

  const handleCreate = () => {
    createMut.mutate({
      ...form,
      project_id: form.project_id || null,
    })
  }

  if (isLoading) return <p style={{ color: '#6b7280', padding: 24 }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>API Keys</h1>
          <p style={{ color: '#6b7280', marginTop: 4 }}>Manage API keys for external service access</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 }}>
          + New API Key
        </button>
      </div>

      {showCreate && (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Create API Key</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Name *
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="My CI/CD Pipeline"
                style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14, boxSizing: 'border-box' }} />
            </label>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Project (leave blank for all projects)
              <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}
                style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}>
                <option value="">All projects</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Scopes
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {SCOPES.map(scope => (
                  <label key={scope} style={{
                    display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                    background: form.scopes.includes(scope) ? '#ede9fe' : '#f3f4f6',
                    borderRadius: 999, padding: '4px 12px', fontSize: 13,
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
              style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 600 }}>Create</button>
            <button onClick={() => setShowCreate(false)}
              style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {apiKeys.length === 0 && !showCreate ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <p style={{ fontSize: 18 }}>No API keys yet</p>
          <p style={{ marginTop: 8 }}>Create an API key to allow external services to access the TODO Platform API</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {apiKeys.map(ak => (
            <div key={ak.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{ak.name}</span>
                    <span style={{
                      background: ak.active ? '#d1fae5' : '#f3f4f6',
                      color: ak.active ? '#065f46' : '#6b7280',
                      borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600,
                    }}>{ak.active ? 'active' : 'inactive'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <code style={{
                      background: '#f3f4f6', padding: '4px 10px', borderRadius: 6, fontSize: 13,
                      fontFamily: 'monospace', color: '#374151',
                    }}>
                      {visibleKeys[ak.id] ? ak.key : maskKey(ak.key)}
                    </code>
                    <button onClick={() => setVisibleKeys(v => ({ ...v, [ak.id]: !v[ak.id] }))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 2 }}>
                      {visibleKeys[ak.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button onClick={() => copyKey(ak.id, ak.key)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: copiedId === ak.id ? '#22c55e' : '#6b7280', padding: 2 }}>
                      {copiedId === ak.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                    {ak.scopes.map(s => (
                      <span key={s} style={{ background: '#ede9fe', color: '#4f46e5', borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{s}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>
                    {ak.project_id
                      ? `Project: ${projects.find(p => p.id === ak.project_id)?.name || ak.project_id}`
                      : 'All projects'}
                    {ak.last_used_at && ` · Last used: ${new Date(ak.last_used_at).toLocaleString()}`}
                    {` · Created: ${new Date(ak.created_at).toLocaleString()}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => updateMut.mutate({ id: ak.id, data: { active: !ak.active } })}
                    style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>
                    {ak.active ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => { if (confirm('Delete this API key?')) deleteMut.mutate(ak.id) }}
                    style={{ background: 'none', border: '1px solid #fca5a5', color: '#ef4444', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 32, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 12 }}>API Usage</h3>
        <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
          Use the <code>X-API-Key</code> header to authenticate requests to <code>/api/v1/</code> endpoints.
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

        <h4 style={{ fontWeight: 600, marginTop: 20, marginBottom: 8 }}>Available Endpoints</h4>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Method</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Endpoint</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Scope</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Description</th>
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
              <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '6px 12px' }}>
                  <span style={{
                    background: method === 'GET' ? '#dbeafe' : method === 'POST' ? '#d1fae5' : method === 'PATCH' ? '#fef3c7' : '#fee2e2',
                    color: method === 'GET' ? '#1e40af' : method === 'POST' ? '#065f46' : method === 'PATCH' ? '#92400e' : '#991b1b',
                    padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
                  }}>{method}</span>
                </td>
                <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 12 }}>{path}</td>
                <td style={{ padding: '6px 12px' }}>
                  <span style={{ background: '#ede9fe', color: '#4f46e5', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{scope}</span>
                </td>
                <td style={{ padding: '6px 12px', color: '#6b7280' }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
