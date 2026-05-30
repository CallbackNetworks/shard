import { useNavigate } from 'react-router-dom'
import ProgressBar from './ProgressBar'
import { SHADOW_SM, SHADOW_LG, DARK } from '../constants/theme'

export default function ProjectCard({ project, onDelete }) {
  const navigate = useNavigate()
  return (
    <div
      onClick={() => navigate(`/app/projects/${project.id}`)}
      style={{
        background: DARK.surface, borderRadius: 8, padding: 20, cursor: 'pointer',
        boxShadow: SHADOW_SM,
        transition: 'background 0.15s, box-shadow 0.15s',
        display: 'flex', flexDirection: 'column', gap: 12
      }}
      onMouseEnter={e => { e.currentTarget.style.background = DARK.overlay; e.currentTarget.style.boxShadow = SHADOW_LG }}
      onMouseLeave={e => { e.currentTarget.style.background = DARK.surface; e.currentTarget.style.boxShadow = SHADOW_SM }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3 style={{ fontWeight: 700, fontSize: 16, color: DARK.text, margin: 0 }}>{project.name}</h3>
        <span style={{
          fontSize: 10, padding: '2px 9px', borderRadius: 9999, fontWeight: 600, flexShrink: 0,
          background: project.status === 'archived' ? 'rgba(255,255,255,0.06)' : 'rgba(30,215,96,0.1)',
          color: project.status === 'archived' ? DARK.textMid : DARK.success,
          border: `1px solid ${project.status === 'archived' ? DARK.border : 'rgba(30,215,96,0.3)'}`,
          textTransform: 'capitalize', letterSpacing: '0.05em',
        }}>{project.status}</span>
      </div>
      {project.description && <p style={{ color: DARK.textMid, fontSize: 14, margin: 0 }}>{project.description}</p>}
      <ProgressBar value={project.progress} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: DARK.textMid }}>
        <span>{project.done_tasks}/{project.total_tasks} tasks done</span>
        <span style={{ fontWeight: 700, color: project.progress === 100 ? DARK.success : DARK.textMid }}>{project.progress}%</span>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onDelete(project.id) }}
        style={{
          alignSelf: 'flex-end', background: 'none',
          border: '1px solid rgba(243,114,127,0.4)', color: DARK.danger,
          borderRadius: 9999, padding: '4px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '1px',
        }}
      >Delete</button>
    </div>
  )
}
