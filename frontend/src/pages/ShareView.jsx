import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getShareData } from '../api/client'

import ShareHero from '../components/share/ShareHero'
import ShareStats from '../components/share/ShareStats'
import ShareScrollNav, { SECTIONS } from '../components/share/ShareScrollNav'
import ShareProjectCard from '../components/share/ShareProjectCard'
import ShareActivityFeed from '../components/share/ShareActivityFeed'
import SharePinGate from '../components/share/SharePinGate'
import ShareFooter from '../components/share/ShareFooter'
import useBreakpoint from '../components/share/useBreakpoint'
import EmptyState from '../components/shared/EmptyState'

export default function ShareView({ scope = 'identity' }) {
  const { token } = useParams()
  const bp = useBreakpoint()
  const [now, setNow] = useState(new Date())
  const [activeSection, setActiveSection] = useState('overview')
  const [pinData, setPinData] = useState(null) // data from PIN verification

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['share', scope, token],
    queryFn: () => getShareData(token, scope),
    refetchInterval: pinData ? false : 30000,
    retry: false,
  })

  // Section tracking via IntersectionObserver
  useEffect(() => {
    const observers = []
    SECTIONS.forEach(s => {
      const el = document.getElementById(`share-section-${s.key}`)
      if (!el) return
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveSection(s.key)
        },
        { rootMargin: '-30% 0px -60% 0px' }
      )
      obs.observe(el)
      observers.push(obs)
    })
    return () => observers.forEach(o => o.disconnect())
  }, [])

  // Check if PIN required
  const requiresPin = data?.meta?.requires_pin === true && !pinData

  // Use pinData if available (from PIN verification), otherwise use fetched data
  const effectiveData = pinData || data

  const identity = effectiveData?.identity || null
  const projects = (effectiveData?.projects || []).filter(p => p.status === 'active')
  const summary = effectiveData?.summary || {
    total_projects: 0, total_tasks: 0, done_tasks: 0,
    overdue_tasks: 0, overall_progress: 0,
  }
  const recentActivity = effectiveData?.recent_activity || []
  const meta = effectiveData?.meta || {}
  const color = identity?.color || '#facc15'

  // Error state
  if (isError) {
    return (
      <div className="kt-share-page kt-share-center">
        <div className="kt-share-empty-block">
          <div className="kt-share-kicker">
              Share link not found
          </div>
          <div className="kt-share-muted">This link may have been revoked, expired, or is invalid.</div>
        </div>
      </div>
    )
  }

  // PIN gate
  if (requiresPin) {
    return (
      <SharePinGate
        identity={data?.identity}
        token={token}
        scope={scope}
        onVerified={(verifiedData) => setPinData(verifiedData)}
      />
    )
  }

  // Loading state
  if (isLoading && !effectiveData) {
    return (
      <div className="kt-share-page kt-share-center">
        <div className="kt-share-loading">Loading...</div>
      </div>
    )
  }

  return (
    <div className="kt-share-page" style={{ '--share-accent': color }}>
      <div className="kt-share-shell">

        {/* Section: Overview */}
        <div id="share-section-overview">
          {/* Hero */}
          <ShareHero identity={identity} summary={summary} now={now} bp={bp} />

          {/* Global progress bar */}
          <div className="kt-share-global-progress" aria-label={`Overall progress ${Math.round(summary.overall_progress)}%`}>
            <span style={{ width: `${Math.round(summary.overall_progress)}%` }} />
          </div>

          {/* Summary stats */}
          <ShareStats summary={summary} color={color} bp={bp} />
        </div>

        {/* Scroll navigation */}
        <ShareScrollNav activeSection={activeSection} color={color} />

        {/* Section: Projects */}
        <div id="share-section-projects" style={{ paddingTop: 8 }}>
          {projects.length === 0 && (
            <EmptyState message="No active projects" />
          )}
          {projects.map((p, i) => (
            <ShareProjectCard
              key={p.id}
              project={p}
              index={i}
              bp={bp}
              scope={scope}
              token={token}
              guestNotesEnabled={meta.guest_notes_enabled === true}
            />
          ))}
        </div>

        {/* Section: Activity */}
        <div id="share-section-activity" style={{ paddingTop: 24 }}>
          <ShareActivityFeed activity={recentActivity} bp={bp} />
        </div>

        {/* Footer */}
        <ShareFooter generatedAt={meta.generated_at} />
      </div>
    </div>
  )
}
