import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { BRAND, STATUS_MAP, DARK } from '../../constants/theme'
import s from '../../pages/Dashboard.module.css'

/* ── Shimmer progress bar ─────────────────────────────────────────── */
function GlowBar({ done, inProgress, failed, total }) {
  if (total === 0) return (
    <div className={s.glowBarEmpty} />
  )
  const pDone = (done / total) * 100
  const pProg = (inProgress / total) * 100
  const pFail = (failed / total) * 100
  return (
    <div className={s.glowBarTrack}>
      <div className={s.glowBarInner}>
        {pDone > 0 && (
          <div className={s.glowBarDone} style={{
            width: `${pDone}%`,
            background: STATUS_MAP.done.color,
          }}>
            <div className={s.glowBarShimmer} />
          </div>
        )}
        {pProg > 0 && <div className={s.glowBarProgress} style={{ width: `${pProg}%`, background: STATUS_MAP.in_progress.color }} />}
        {pFail > 0 && <div className={s.glowBarFailed} style={{ width: `${pFail}%`, background: STATUS_MAP.failed.color }} />}
      </div>
    </div>
  )
}

/* ── Project card ─────────────────────────────────────────────────── */
export default function ProjectCard({ project, onDelete, index }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(false)
  const tasks = project.tasks || []
  const inProgress = tasks.filter(t => t.status === 'in_progress').length
  const failed = tasks.filter(t => t.status === 'failed').length
  const pct = Math.round(project.progress || 0)
  const identColor = project.identities?.[0]?.color || BRAND

  return (
    <div
      className={`card-hover ${s.projectCard}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => navigate(`/projects/${project.id}`)}
      style={{ animationDelay: `${index * 0.055}s` }}
    >
      {/* Subtle gradient top accent */}
      <div className={s.projectCardAccent} style={{
        background: `linear-gradient(90deg, transparent, ${identColor}66, transparent)`,
      }} />

      {/* Card header */}
      <div className={s.cardHeader}>
        <div className={s.cardAvatar} style={{
          background: `linear-gradient(135deg, ${identColor}cc, ${identColor}66)`,
          boxShadow: `0 0 12px ${identColor}44`,
        }}>
          {project.name.charAt(0).toUpperCase()}
        </div>
        <div className={s.cardInfo}>
          <div className={s.cardTitle}>
            {project.name}
          </div>
          {project.description && (
            <div className={s.cardDescription}>
              {project.description}
            </div>
          )}
        </div>
        <span className={`${s.statusBadge} ${project.status === 'archived' ? s.statusBadgeArchived : s.statusBadgeActive}`}>
          {project.status === 'archived' ? t('archived') : t('active')}
        </span>
      </div>

      {/* Progress bar */}
      <GlowBar total={project.total_tasks} done={project.done_tasks} inProgress={inProgress} failed={failed} />

      {/* Stats row */}
      <div className={s.statsRow}>
        <div className={s.statsLeft}>
          <span className={s.statsDone}>
            ✓ {project.done_tasks}
          </span>
          <span className={s.statsRemaining}>
            ○ {project.total_tasks - project.done_tasks} {t('dashboard.left')}
          </span>
        </div>
        <span className={s.statsPercent} style={{
          color: pct === 100 ? DARK.success : DARK.textMid,
        }}>
          {pct}%
        </span>
        {hovered && (
          <button
            onClick={e => {
              e.stopPropagation()
              if (confirm(`Delete "${project.name}"?`)) onDelete(project.id)
            }}
            className={s.deleteBtn}
          >
            {t('delete')}
          </button>
        )}
      </div>
    </div>
  )
}
