import { useNavigate } from 'react-router-dom'
import ProgressBar from './ProgressBar'

const statusColor = { active: '#10b981', archived: '#9ca3af' }
const priorityBadge = (s) => ({
  background: s === 'archived' ? '#f3f4f6' : '#ede9fe', color: s === 'archived' ? '#6b7280' : '#4f46e5',
  borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600
})

export default function ProjectCard({ project, onDelete }) {
  const navigate = useNavigate()
  return (
    <div
      onClick={() => navigate(`/app/projects/${project.id}`)}
      style={{
        background: '#fff', borderRadius: 12, padding: 20, cursor: 'pointer',
        border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        transition: 'box-shadow .15s', display: 'flex', flexDirection: 'column', gap: 12
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.1)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.06)'}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3 style={{ fontWeight: 600, fontSize: 16, color: '#111' }}>{project.name}</h3>
        <span style={priorityBadge(project.status)}>{project.status}</span>
      </div>
      {project.description && <p style={{ color: '#6b7280', fontSize: 14 }}>{project.description}</p>}
      <ProgressBar value={project.progress} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6b7280' }}>
        <span>{project.done_tasks}/{project.total_tasks} tasks done</span>
        <span style={{ fontWeight: 600, color: project.progress === 100 ? '#10b981' : '#4f46e5' }}>{project.progress}%</span>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onDelete(project.id) }}
        style={{ alignSelf: 'flex-end', background: 'none', border: '1px solid #fca5a5', color: '#ef4444', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 13 }}
      >Delete</button>
    </div>
  )
}
