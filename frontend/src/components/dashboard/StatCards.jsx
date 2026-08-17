import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BRAND, DARK, STATUS_COLOR } from '../../constants/theme'
import s from '../../pages/Dashboard.module.css'
import { countOverdue } from '../../utils/overdue'

/* ── Sparkline SVG ────────────────────────────────────────────────── */
function computeSparkline(activities) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return d.toDateString()
  })
  return days.map(day =>
    activities.filter(a =>
      a.action === 'task.status_changed' &&
      a.detail?.includes('done') &&
      new Date(a.created_at).toDateString() === day
    ).length
  )
}

function Sparkline({ activities }) {
  const sparkData = computeSparkline(activities)
  const maxVal = Math.max(...sparkData, 1)
  const points = sparkData.map((v, i) =>
    `${(i / 6) * 76 + 2},${22 - (v / maxVal) * 20}`
  ).join(' ')
  return (
    <svg width={80} height={24} className={s.sparkline}>
      <polyline
        points={points}
        fill="none"
        stroke={BRAND}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CountUpValue({ value }) {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+%?$/.test(value)
    ? Number(value.replace('%', ''))
    : null
  const suffix = typeof value === 'string' && value.endsWith('%') ? '%' : ''
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (numeric == null) return
    let raf = 0
    const start = performance.now()
    const duration = 620
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(Math.round(numeric * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [numeric])

  return numeric == null ? value : `${shown}${suffix}`
}

/* ── Summary stat cards ───────────────────────────────────────────── */
export default function StatCards({ projects, activities }) {
  const { t } = useTranslation()

  const allTasks = projects.flatMap(p => p.tasks || [])
  const totalTasks = allTasks.length
  const doneTasks = allTasks.filter(task => task.status === 'done').length
  const overdueTasks = countOverdue(allTasks)
  const completionRate = totalTasks > 0 ? Math.round(doneTasks / totalTasks * 100) : 0

  const today = new Date().toDateString()
  const completedToday = activities.filter(a =>
    a.action === 'task.status_changed' &&
    a.detail?.includes('done') &&
    new Date(a.created_at).toDateString() === today
  ).length

  const cards = [
    {
      label: t('dashboard.totalTasks'),
      value: totalTasks,
      color: DARK.text,
      delay: 0,
    },
    {
      label: t('dashboard.completedToday'),
      value: completedToday,
      color: DARK.success,
      delay: 0.06,
    },
    {
      label: t('dashboard.overdueCount'),
      value: overdueTasks,
      color: overdueTasks > 0 ? STATUS_COLOR.failed : DARK.text,
      delay: 0.12,
    },
    {
      label: t('dashboard.completionRate'),
      value: `${completionRate}%`,
      color: completionRate === 100 ? BRAND : DARK.text,
      delay: 0.18,
      sparkline: true,
    },
  ]

  return (
    <div className={s.statCardsGrid}>
      {cards.map((card, idx) => (
        <div
          key={idx}
          className={s.statCard}
          style={{ animationDelay: `${card.delay}s` }}
        >
          <div className={s.statCardLabel}>{card.label}</div>
          <div className={s.statCardValue} style={{ color: card.color }}>
            <CountUpValue value={card.value} />
          </div>
          {card.sparkline && <Sparkline activities={activities} />}
        </div>
      ))}
    </div>
  )
}
