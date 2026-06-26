import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getShareData } from '../api/client'
import { FONT, BG, DIM, HI, Bar } from '../components/OverviewViews'

import ShareHero from '../components/share/ShareHero'
import ShareStats from '../components/share/ShareStats'
import ShareScrollNav, { SECTIONS } from '../components/share/ShareScrollNav'
import ShareProjectCard from '../components/share/ShareProjectCard'
import ShareActivityFeed from '../components/share/ShareActivityFeed'
import SharePinGate from '../components/share/SharePinGate'
import ShareFooter from '../components/share/ShareFooter'
import useBreakpoint from '../components/share/useBreakpoint'
import EmptyState from '../components/shared/EmptyState'

export default function ShareView() {
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
    queryKey: ['share', token],
    queryFn: () => getShareData(token),
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
  const color = identity?.color || '#ef4444'

  // Error state
  if (isError) {
    return (
      <div style={{
        minHeight: '100vh', background: BG, fontFamily: FONT,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          textAlign: 'center',
          animation: 'shareReveal 0.5s ease-out forwards',
        }}>
          <div style={{
            display: 'inline-block', padding: '20px 40px',
            background: 'rgba(255,255,255,0.02)',
            borderTop: '1px solid rgba(255,85,51,0.3)',
            clipPath: 'polygon(0 0, 100% 0, calc(100% - 16px) 100%, 0 100%)',
          }}>
            <div style={{
              fontSize: 13, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: DIM,
            }}>
              Share link not found
            </div>
            <div style={{
              fontSize: 11, marginTop: 8, color: 'rgba(255,255,255,0.1)',
            }}>
              This link may have been revoked, expired, or is invalid.
            </div>
          </div>
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
        onVerified={(verifiedData) => setPinData(verifiedData)}
      />
    )
  }

  // Loading state
  if (isLoading && !effectiveData) {
    return (
      <div style={{
        minHeight: '100vh', background: BG, fontFamily: FONT,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase',
          color: DIM, animation: 'shareReveal 0.5s ease-out forwards',
        }}>
          Loading...
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh', background: BG, fontFamily: FONT, color: HI,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 860,
        padding: bp === 'mobile' ? '32px 16px 48px' : '48px 32px 64px',
      }}>

        {/* Section: Overview */}
        <div id="share-section-overview">
          {/* Hero */}
          <ShareHero identity={identity} summary={summary} now={now} bp={bp} />

          {/* Global progress bar */}
          <div style={{
            marginBottom: 20,
            opacity: 0,
            animation: 'shareReveal 0.5s ease-out 0.1s forwards',
          }}>
            <Bar pct={Math.round(summary.overall_progress)} color={color} height={3} bg="rgba(255,255,255,0.04)" />
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
            <ShareProjectCard key={p.id} project={p} index={i} bp={bp} />
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
