import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getProjects, createProject, deleteProject } from '../api/client'
import ProjectCard from '../components/ProjectCard'

export default function Dashboard() {
  const qc = useQueryClient()
  const { data: projects = [], isLoading } = useQuery({ queryKey: ['projects'], queryFn: getProjects })
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [showForm, setShowForm] = useState(false)

  const createMut = useMutation({
    mutationFn: () => createProject({ name, description: desc || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setName(''); setDesc(''); setShowForm(false) }
  })

  const deleteMut = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] })
  })

  if (isLoading) return <p style={{ color: '#6b7280' }}>Loading...</p>

  const active = projects.filter(p => p.status === 'active')
  const archived = projects.filter(p => p.status === 'archived')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Projects</h1>
          <p style={{ color: '#6b7280', marginTop: 4 }}>{active.length} active · {archived.length} archived</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 }}
        >+ New Project</button>
      </div>

      {showForm && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <h3 style={{ marginBottom: 16, fontWeight: 600 }}>Create Project</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              placeholder="Project name *"
              value={name}
              onChange={e => setName(e.target.value)}
              style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}
            />
            <textarea
              placeholder="Description (optional)"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 14, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => createMut.mutate()}
                disabled={!name.trim() || createMut.isPending}
                style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 600 }}
              >{createMut.isPending ? 'Creating...' : 'Create'}</button>
              <button onClick={() => setShowForm(false)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <p style={{ fontSize: 18 }}>No projects yet</p>
          <p style={{ marginTop: 8 }}>Create your first project to get started</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginBottom: 32 }}>
              {active.map(p => <ProjectCard key={p.id} project={p} onDelete={id => deleteMut.mutate(id)} />)}
            </div>
          )}
          {archived.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#9ca3af', marginBottom: 12 }}>Archived</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                {archived.map(p => <ProjectCard key={p.id} project={p} onDelete={id => deleteMut.mutate(id)} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
