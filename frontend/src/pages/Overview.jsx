import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getProjects, getIdentities, getIdentityProjects, getIdentityHubStats } from '../api/client'
import {
  FONT, BG, LINE, DIM, HI,
  urgencyScore,
  Bar, TabBtn,
  ViewProgress, ViewHealth, ViewTasks, ViewCompare,
  getPinnedIds, togglePin,
} from '../components/OverviewViews'
import IdentityChartsView from '../components/IdentityChartsView'

const PARA_R = (px = 14) => `polygon(0 0, 100% 0, calc(100% - ${px}px) 100%, 0 100%)`
const PARA   = (px = 8)  => `polygon(${px}px 0, 100% 0, calc(100% - ${px}px) 100%, 0 100%)`

/* ── Identity filter button ──────────────────────────────────────── */
function IdentityBtn({ identity, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? `${identity.color}14` : 'transparent',
      border: 'none',
      borderTop: `2px solid ${active ? identity.color : 'transparent'}`,
      cursor: 'pointer',
      padding: '7px 16px',
      fontSize: 10, fontWeight: 800, letterSpacing: '0.14em',
      color: active ? identity.color : DIM,
      fontFamily: FONT,
      display: 'flex', alignItems: 'center', gap: 6,
      transform: 'skewX(-6deg)',
      transition: 'color 0.15s, background 0.15s, border-color 0.15s',
      outline: 'none',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, transform: 'skewX(6deg)' }}>
        <span style={{ width: 7, height: 7, background: active ? identity.color : DIM, clipPath: PARA(3) }} />
        {identity.name.toUpperCase()}
      </span>
    </button>
  )
}

/* ── Main ────────────────────────────────────────────────────────── */
export default function Overview() {
  const [view, setView] = useState('progress')
  const [now, setNow]   = useState(new Date())
  const [copied, setCopied] = useState(false)

  const [identityId, setIdentityId] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('identity') || null
  })

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  const selectIdentity = (id) => {
    window.history.pushState({}, '', id ? `${window.location.pathname}?identity=${id}` : window.location.pathname)
    setIdentityId(id)
  }

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const { data: identities = [] } = useQuery({
    queryKey: ['identities'],
    queryFn: getIdentities,
    refetchInterval: 30000,
  })

  const { data: allProjects = [], isLoading: loadingAll } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    refetchInterval: 30000,
    enabled: !identityId,
  })
  const { data: identityProjects = [], isLoading: loadingIdentity } = useQuery({
    queryKey: ['identity-projects', identityId],
    queryFn: () => getIdentityProjects(identityId),
    refetchInterval: 30000,
    enabled: !!identityId,
  })

  const { data: hubStats } = useQuery({
    queryKey: ['identity-hub-stats'],
    queryFn: getIdentityHubStats,
    refetchInterval: 30000,
  })

  const [pinned, setPinned] = useState(() => getPinnedIds())

  const handleTogglePin = useCallback((projectId) => {
    const next = togglePin(projectId)
    setPinned(next)
  }, [])

  const isLoading = identityId ? loadingIdentity : loadingAll
  const rawProjects = identityId ? identityProjects : allProjects
  const activeUnsorted = rawProjects.filter(p => p.status === 'active')
  // Pinned projects float to top
  const active = [...activeUnsorted].sort((a, b) => {
    const aPin = pinned.includes(a.id) ? 0 : 1
    const bPin = pinned.includes(b.id) ? 0 : 1
    return aPin - bPin
  })

  const currentIdentity = identities.find(i => i.id === identityId) || null

  const totalTasks  = active.reduce((s, p) => s + (p.total_tasks || 0), 0)
  const doneTasks   = active.reduce((s, p) => s + (p.done_tasks  || 0), 0)
  const overallPct  = totalTasks > 0 ? Math.round(doneTasks / totalTasks * 100) : 0
  const urgentCount = active.filter(p => urgencyScore(p) > 0.55).length
  const timeStr     = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr     = now.toLocaleDateString([], { month: 'short', day: 'numeric' })

  const VIEWS = [
    { key: 'progress', label: 'PROGRESS' },
    { key: 'health',   label: 'HEALTH'   },
    { key: 'tasks',    label: 'TASKS'    },
    { key: 'compare',  label: 'COMPARE'  },
    { key: 'charts',   label: 'CHARTS'   },
  ]

  return (
    <div style={{
      minHeight: '100vh', background: BG, fontFamily: FONT, color: HI,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: active.length === 0 && !isLoading ? 'center' : 'flex-start',
    }}>
      <div style={{ width: '100%', maxWidth: 800, padding: '48px 32px 64px' }}>

        {/* ── Hero header ─────────────────────────────────── */}
        <div style={{
          position: 'relative',
          padding: '20px 28px',
          marginBottom: 32,
          background: 'rgba(255,255,255,0.018)',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          clipPath: PARA_R(24),
          overflow: 'hidden',
        }}>
          {/* Accent bar */}
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
            background: currentIdentity?.color || '#1ed760',
          }} />
          {/* Subtle diagonal glow */}
          <div style={{
            position: 'absolute', right: -40, top: -40, width: 160, height: 160,
            background: `radial-gradient(circle, ${(currentIdentity?.color || '#1ed760')}18 0%, transparent 70%)`,
            pointerEvents: 'none',
          }} />

          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              {currentIdentity ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 8, height: 8, background: currentIdentity.color, clipPath: PARA(3) }} />
                  <span style={{ fontSize: 11, fontWeight: 800, color: currentIdentity.color, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                    {currentIdentity.name}
                  </span>
                  <span style={{ fontSize: 10, color: DIM, letterSpacing: '0.1em' }}>· PROJECT STATUS</span>
                </div>
              ) : (
                <div style={{ fontSize: 10, fontWeight: 800, color: DIM, letterSpacing: '0.24em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Project Status
                </div>
              )}
              <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: DIM }}>
                  <span style={{ color: HI, fontWeight: 800 }}>{active.length}</span> projects
                </span>
                <span style={{ fontSize: 11, color: DIM }}>
                  <span style={{ color: HI, fontWeight: 800 }}>{totalTasks}</span> tasks
                </span>
                <span style={{ fontSize: 11, color: DIM }}>
                  <span style={{ color: '#1ed760', fontWeight: 800 }}>{overallPct}%</span> overall
                </span>
                {urgentCount > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#ff5533', letterSpacing: '0.04em' }}>⚠ {urgentCount} urgent</span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
              {identityId && (
                <button onClick={copyLink} style={{
                  background: copied ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${copied ? '#1ed760' : 'rgba(255,255,255,0.1)'}`,
                  cursor: 'pointer', padding: '5px 14px',
                  fontSize: 10, fontWeight: 800, letterSpacing: '0.12em',
                  color: copied ? '#1ed760' : DIM, fontFamily: FONT,
                  transform: 'skewX(-5deg)',
                  transition: 'color 0.2s, border-color 0.2s, background 0.2s',
                  outline: 'none',
                }}>
                  <span style={{ display: 'inline-block', transform: 'skewX(5deg)' }}>
                    {copied ? '✓ COPIED' : '⎘ COPY LINK'}
                  </span>
                </button>
              )}
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', letterSpacing: '0.08em', fontVariantNumeric: 'tabular-nums' }}>
                {dateStr} {timeStr}
              </span>
            </div>
          </div>
        </div>

        {/* ── Global progress bar ── */}
        <div style={{ marginBottom: 4 }}>
          <Bar pct={overallPct} color={currentIdentity?.color || '#1ed760'} height={3} bg="rgba(255,255,255,0.04)" />
        </div>

        {/* ── Identity switcher ── */}
        {identities.length > 0 && (
          <div style={{ display: 'flex', gap: 2, marginBottom: 0, borderBottom: `1px solid ${LINE}`, flexWrap: 'wrap' }}>
            <button onClick={() => selectIdentity(null)} style={{
              background: !identityId ? 'rgba(30,215,96,0.1)' : 'transparent',
              border: 'none',
              borderTop: `2px solid ${!identityId ? '#1ed760' : 'transparent'}`,
              cursor: 'pointer',
              padding: '7px 18px',
              fontSize: 10, fontWeight: 800, letterSpacing: '0.14em',
              color: !identityId ? HI : DIM,
              fontFamily: FONT,
              transform: 'skewX(-6deg)',
              transition: 'color 0.15s, background 0.15s',
              outline: 'none',
            }}>
              <span style={{ display: 'inline-block', transform: 'skewX(6deg)' }}>ALL</span>
            </button>
            {identities.map(ident => (
              <IdentityBtn
                key={ident.id}
                identity={ident}
                active={identityId === ident.id}
                onClick={() => selectIdentity(ident.id)}
              />
            ))}
          </div>
        )}

        {/* ── View tabs ── */}
        <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${LINE}`, marginBottom: 0 }}>
          {VIEWS.map(v => (
            <TabBtn key={v.key} label={v.label} active={view === v.key} onClick={() => setView(v.key)} />
          ))}
        </div>

        {/* ── Content ── */}
        <div>
          {isLoading && (
            <div style={{ padding: '48px 0', textAlign: 'center', color: DIM, fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
              Loading…
            </div>
          )}
          {!isLoading && active.length === 0 && (
            <div style={{ padding: '48px 0', textAlign: 'center', color: DIM, fontSize: 11, letterSpacing: '0.14em' }}>
              {identityId ? 'No active projects for this identity' : 'No active projects'}
            </div>
          )}
          {!isLoading && active.length > 0 && view === 'progress' && <ViewProgress projects={active} pinned={pinned} onTogglePin={handleTogglePin} />}
          {!isLoading && active.length > 0 && view === 'health'   && <ViewHealth   projects={active} pinned={pinned} onTogglePin={handleTogglePin} />}
          {!isLoading && active.length > 0 && view === 'tasks'    && <ViewTasks    projects={active} />}
          {!isLoading && active.length > 0 && view === 'compare'  && <ViewCompare  projects={active} />}
          {!isLoading && view === 'charts' && (
            <IdentityChartsView
              data={hubStats}
              selectedIdentityId={identityId}
              onSelectIdentity={selectIdentity}
            />
          )}
        </div>

      </div>
    </div>
  )
}
