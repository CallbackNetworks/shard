import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit3, Trash2, Link2, Unlink, ExternalLink } from 'lucide-react'
import {
  getIdentities, createIdentity, updateIdentity, deleteIdentity,
  getProjects, linkProjectIdentity, unlinkProjectIdentity,
} from '../api/client'

const COLORS = [
  '#5e6ad2', '#22c55e', '#ef4444', '#f59e0b', '#3b82f6',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316',
  '#14b8a6', '#a855f7', '#e11d48', '#0ea5e9',
]

function IdentityForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || { name: '', color: '#5e6ad2', description: '', avatar: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 13, fontWeight: 600, flex: '0 0 auto' }}>
          Avatar
          <input value={form.avatar} onChange={e => set('avatar', e.target.value)}
            placeholder="e.g. R"
            maxLength={2}
            style={{ display: 'block', width: 48, marginTop: 4, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontSize: 16, textAlign: 'center' }} />
        </label>
        <label style={{ fontSize: 13, fontWeight: 600, flex: '1 1 160px' }}>
          Name *
          <input value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="e.g. Researcher"
            style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14, boxSizing: 'border-box' }} />
        </label>
        <label style={{ fontSize: 13, fontWeight: 600, flex: '2 1 200px' }}>
          Description
          <input value={form.description} onChange={e => set('description', e.target.value)}
            placeholder="e.g. CGCG computational physics group"
            style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14, boxSizing: 'border-box' }} />
        </label>
      </div>
      <div style={{ marginTop: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Color</span>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => set('color', c)} style={{
              width: 24, height: 24, borderRadius: 6, background: c, border: form.color === c ? '2px solid #0f172a' : '2px solid transparent',
              cursor: 'pointer', transition: 'border 0.1s',
            }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={() => onSave(form)} disabled={!form.name}
          style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 600, opacity: form.name ? 1 : 0.5 }}>
          Save
        </button>
        <button onClick={onCancel}
          style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function Identities() {
  const qc = useQueryClient()
  const { data: identities = [], isLoading } = useQuery({ queryKey: ['identities'], queryFn: getIdentities })
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: getProjects })
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [linkingId, setLinkingId] = useState(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['identities'] })
    qc.invalidateQueries({ queryKey: ['projects'] })
  }

  const createMut = useMutation({
    mutationFn: createIdentity,
    onSuccess: () => { invalidate(); setShowCreate(false) },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateIdentity(id, data),
    onSuccess: () => { invalidate(); setEditingId(null) },
  })
  const deleteMut = useMutation({ mutationFn: deleteIdentity, onSuccess: invalidate })
  const linkMut = useMutation({
    mutationFn: ({ identityId, projectId }) => linkProjectIdentity(identityId, projectId),
    onSuccess: invalidate,
  })
  const unlinkMut = useMutation({
    mutationFn: ({ identityId, projectId }) => unlinkProjectIdentity(identityId, projectId),
    onSuccess: invalidate,
  })

  // Find which projects are linked to a given identity
  const linkedProjectIds = (identityId) => {
    const linked = new Set()
    for (const p of projects) {
      if (p.identities?.some(i => i.id === identityId)) linked.add(p.id)
    }
    return linked
  }

  if (isLoading) return <p style={{ color: '#6b7280', padding: 24 }}>Loading...</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Identities</h1>
          <p style={{ color: '#6b7280', marginTop: 4 }}>Manage your roles and identities across projects</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 }}>
          <Plus size={14} style={{ verticalAlign: -2, marginRight: 6 }} />New Identity
        </button>
      </div>

      {showCreate && (
        <IdentityForm
          onSave={data => createMut.mutate(data)}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {identities.length === 0 && !showCreate ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <p style={{ fontSize: 18 }}>No identities yet</p>
          <p style={{ marginTop: 8 }}>Create identities to represent different roles you play (researcher, developer, maintainer...)</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {identities.map(identity => {
            const linked = linkedProjectIds(identity.id)
            const isEditing = editingId === identity.id
            const isLinking = linkingId === identity.id

            if (isEditing) {
              return (
                <IdentityForm
                  key={identity.id}
                  initial={{ name: identity.name, color: identity.color, description: identity.description || '', avatar: identity.avatar || '' }}
                  onSave={data => updateMut.mutate({ id: identity.id, data })}
                  onCancel={() => setEditingId(null)}
                />
              )
            }

            return (
              <div key={identity.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, background: identity.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: identity.avatar?.length > 1 ? 16 : 18,
                    flexShrink: 0,
                  }}>
                    {identity.avatar || identity.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{identity.name}</div>
                    {identity.description && (
                      <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{identity.description}</div>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 4 }}>
                    {identity.project_count} project{identity.project_count !== 1 ? 's' : ''}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <a href={`/?identity=${identity.id}`} target="_blank" rel="noreferrer"
                      style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none', color: '#374151' }}>
                      <ExternalLink size={13} /> Overview
                    </a>
                    <button onClick={() => setLinkingId(isLinking ? null : identity.id)}
                      style={{ background: isLinking ? '#ede9fe' : '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Link2 size={13} /> Projects
                    </button>
                    <button onClick={() => setEditingId(identity.id)}
                      style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                      <Edit3 size={13} />
                    </button>
                    <button onClick={() => { if (confirm(`Delete identity "${identity.name}"?`)) deleteMut.mutate(identity.id) }}
                      style={{ background: 'none', border: '1px solid #fca5a5', color: '#ef4444', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Linked projects */}
                {linked.size > 0 && !isLinking && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                    {projects.filter(p => linked.has(p.id)).map(p => (
                      <span key={p.id} style={{
                        fontSize: 12, padding: '3px 10px', borderRadius: 6,
                        background: identity.color + '18', color: identity.color,
                        border: `1px solid ${identity.color}33`, fontWeight: 500,
                      }}>
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Project linking panel */}
                {isLinking && (
                  <div style={{ marginTop: 12, padding: '12px 16px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Link / Unlink Projects</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {projects.map(p => {
                        const isLinked = linked.has(p.id)
                        return (
                          <button key={p.id}
                            onClick={() => isLinked
                              ? unlinkMut.mutate({ identityId: identity.id, projectId: p.id })
                              : linkMut.mutate({ identityId: identity.id, projectId: p.id })
                            }
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                              background: isLinked ? identity.color + '18' : '#fff',
                              color: isLinked ? identity.color : '#6b7280',
                              border: isLinked ? `1px solid ${identity.color}55` : '1px solid #d1d5db',
                              fontWeight: isLinked ? 600 : 400,
                            }}
                          >
                            {isLinked ? <Unlink size={11} /> : <Link2 size={11} />}
                            {p.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
