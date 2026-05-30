import { useState, useEffect, useCallback } from 'react'
import { BrowserRouter, Link, useLocation, Routes, Route, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, Zap, Key, Users, ChevronDown, ChevronRight, ExternalLink, Search, BarChart2, GitMerge, GitFork, FileText, ScrollText } from 'lucide-react'
import { getProjects, getIdentities } from './api/client'
import CommandPalette from './components/CommandPalette'
import AssistantPanel from './components/AssistantPanel'
import NotificationCenter from './components/NotificationCenter'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import Dashboard from './pages/Dashboard'
import ProjectDetail from './pages/ProjectDetail'
import Integrations from './pages/Integrations'
import ApiKeys from './pages/ApiKeys'
import Identities from './pages/Identities'
import Analytics from './pages/Analytics'
import WorkflowRules from './pages/WorkflowRules'
import Templates from './pages/Templates'
import WebhookLogs from './pages/WebhookLogs'
import Decisions from './pages/Decisions'
import Overview from './pages/Overview'
import ShareView from './pages/ShareView'
import Login from './pages/Login'
import { AuthProvider, useAuth } from './context/AuthContext'
import { BRAND, INSET_SHADOW, DARK } from './constants/theme'
import useRealtimeSync from './hooks/useRealtimeSync'

const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: #121212; font-family: 'SpotifyMixUI', 'Helvetica Neue', helvetica, arial, sans-serif; }
  ::selection { background: rgba(30,215,96,0.3); color: #ffffff; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
  input, select, button, textarea { font-family: inherit; }

  @keyframes fadeUpIn {
    from { opacity: 0; transform: translateY(14px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0)   scale(1); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes shimmerSlide {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(500%); }
  }
  @keyframes auroraFloat1 {
    0%,100% { transform: translate(0,0) scale(1); }
    33%     { transform: translate(40px,-25px) scale(1.06); }
    66%     { transform: translate(-20px,12px) scale(0.96); }
  }
  @keyframes auroraFloat2 {
    0%,100% { transform: translate(0,0) scale(1); }
    40%     { transform: translate(-30px,20px) scale(1.08); }
    70%     { transform: translate(18px,-12px) scale(0.94); }
  }
  @keyframes auroraFloat3 {
    0%,100% { transform: translate(-50%,-50%) scale(1); }
    50%     { transform: translate(-50%,-50%) scale(1.18); }
  }
  @keyframes pulseRing {
    0%   { box-shadow: 0 0 0 0 rgba(243,114,127,0.4); }
    70%  { box-shadow: 0 0 0 8px rgba(243,114,127,0); }
    100% { box-shadow: 0 0 0 0 rgba(243,114,127,0); }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Share page animations */
  @keyframes shareReveal {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes statPulse {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.08); }
  }
  @keyframes barShimmer {
    0%   { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  @keyframes slideInLeft {
    from { opacity: 0; transform: translateX(-16px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes refreshPulse {
    0%, 100% { opacity: 0.3; transform: scale(1); }
    50%      { opacity: 1; transform: scale(1.4); }
  }

  .card-hover {
    transition: transform 0.22s ease, box-shadow 0.22s ease, background 0.22s ease;
  }
  .card-hover:hover {
    transform: translateY(-2px);
    box-shadow: rgba(0,0,0,0.5) 0px 8px 24px;
    background: #252525 !important;
  }
  .sb-link {
    transition: background 0.12s, color 0.12s;
  }
  .sb-link:hover {
    background: rgba(255,255,255,0.08) !important;
    color: #ffffff !important;
  }

  /* Mobile responsive */
  @media (max-width: 768px) {
    .layout-sidebar {
      position: fixed !important;
      left: -240px;
      top: 0;
      bottom: 0;
      z-index: 200;
      transition: left 0.25s ease;
      box-shadow: none;
    }
    .layout-sidebar.open {
      left: 0 !important;
      box-shadow: 4px 0 24px rgba(0,0,0,0.6);
    }
    .layout-main {
      margin-left: 0 !important;
    }
    .mobile-overlay {
      display: block !important;
    }
    .mobile-menu-btn {
      display: flex !important;
    }
    .page-content {
      padding: 16px 12px !important;
    }
  }
  @media (min-width: 769px) {
    .mobile-overlay { display: none !important; }
    .mobile-menu-btn { display: none !important; }
  }
`

const SB_BG     = DARK.bgAlt
const SB_TEXT   = DARK.textMid
const SB_ACTIVE = DARK.elevated
const SB_BORDER = DARK.border

function Sidebar({ onOpenPalette }) {
  const location = useLocation()
  const { t, i18n } = useTranslation()
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [identitiesOpen, setIdentitiesOpen] = useState(true)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    staleTime: 10000,
  })

  const { data: identities = [] } = useQuery({
    queryKey: ['identities'],
    queryFn: getIdentities,
    staleTime: 10000,
  })

  const active = projects.filter(p => p.status === 'active')
  const archived = projects.filter(p => p.status === 'archived')

  const projectsByIdentity = {}
  const projectsWithIdentity = new Set()
  for (const p of projects) {
    for (const ident of (p.identities || [])) {
      if (!projectsByIdentity[ident.id]) projectsByIdentity[ident.id] = { identity: ident, projects: [] }
      projectsByIdentity[ident.id].projects.push(p)
      projectsWithIdentity.add(p.id)
    }
  }
  const untaggedProjects = active.filter(p => !projectsWithIdentity.has(p.id))

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(path + '/')

  const navLinkStyle = (path) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 12px', borderRadius: 4, textDecoration: 'none',
    fontSize: 14, fontWeight: isActive(path) ? 700 : 400, margin: '1px 6px',
    color: isActive(path) ? DARK.text : SB_TEXT,
    background: isActive(path) ? SB_ACTIVE : 'transparent',
  })

  const projectLinkStyle = (id) => {
    const on = location.pathname === `/app/projects/${id}`
    return {
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 12px 4px 28px', borderRadius: 4, textDecoration: 'none',
      fontSize: 14, fontWeight: on ? 700 : 400, margin: '1px 6px', overflow: 'hidden',
      color: on ? DARK.text : SB_TEXT,
      background: on ? SB_ACTIVE : 'transparent',
      transition: 'background 0.12s, color 0.12s',
    }
  }

  const sectionHeader = {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '3px 12px', width: '100%', background: 'none', border: 'none',
    cursor: 'pointer', color: 'rgba(255,255,255,0.25)', fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2,
  }

  return (
    <div style={{
      width: 220, minWidth: 220, background: SB_BG, height: '100vh',
      display: 'flex', flexDirection: 'column', borderRight: `1px solid ${SB_BORDER}`,
      overflow: 'hidden', userSelect: 'none',
    }}>
      {/* Brand */}
      <div style={{
        padding: '20px 16px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: `1px solid ${SB_BORDER}`,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: BRAND,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 900, color: '#000',
          boxShadow: `0 0 16px rgba(30,215,96,0.4)`,
        }}>T</div>
        <span style={{ color: DARK.text, fontWeight: 700, fontSize: 14, letterSpacing: '0.01em' }}>
          TODO Platform
        </span>
      </div>

      {/* ⌘K search button */}
      <button
        onClick={onOpenPalette}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          margin: '10px 12px', padding: '8px 14px', borderRadius: 9999,
          background: DARK.elevated, border: 'none',
          cursor: 'pointer', width: 'calc(100% - 24px)',
          color: DARK.textMid, fontSize: 13,
          transition: 'background 0.12s',
          boxShadow: INSET_SHADOW,
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#282828'}
        onMouseLeave={e => e.currentTarget.style.background = DARK.elevated}
      >
        <Search size={12} />
        <span style={{ flex: 1, textAlign: 'left' }}>{t('search')}</span>
        <kbd style={{
          padding: '1px 6px', borderRadius: 3, fontSize: 10,
          background: 'rgba(255,255,255,0.1)', color: DARK.textMid,
        }}>⌘K</kbd>
      </button>

      {/* Nav links */}
      <div style={{ padding: '8px 0', borderBottom: `1px solid ${SB_BORDER}` }}>
        {[
          { to: '/app', icon: <LayoutGrid size={13} />, labelKey: 'nav.myIssues' },
          { to: '/app/identities', icon: <Users size={13} />, labelKey: 'nav.identities' },
          { to: '/app/integrations', icon: <Zap size={13} />, labelKey: 'nav.integrations' },
          { to: '/app/api-keys', icon: <Key size={13} />, labelKey: 'nav.apiKeys' },
          { to: '/app/analytics', icon: <BarChart2 size={13} />, labelKey: 'nav.analytics' },
          { to: '/app/workflow-rules', icon: <GitMerge size={13} />, labelKey: 'nav.workflowRules' },
          { to: '/app/decisions', icon: <GitFork size={13} />, labelKey: 'nav.decisions' },
          { to: '/app/templates', icon: <FileText size={13} />, labelKey: 'nav.templates' },
          { to: '/app/webhook-logs', icon: <ScrollText size={13} />, labelKey: 'nav.webhookLogs' },
        ].map(({ to, icon, labelKey }) => (
          <Link key={to} to={to} className="sb-link" style={navLinkStyle(to)}>
            {icon}{t(labelKey)}
          </Link>
        ))}
        <a href="/" target="_blank" rel="noreferrer" className="sb-link"
          style={{ ...navLinkStyle('/status-noop'), color: SB_TEXT, borderLeft: '2px solid transparent' }}>
          <ExternalLink size={13} />{t('nav.statusPage')}
        </a>
      </div>

      {/* Project tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0', minHeight: 0 }}>
        {identities.length > 0 && (
          <>
            <button onClick={() => setIdentitiesOpen(v => !v)} style={sectionHeader}>
              {identitiesOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              {t('nav.byIdentity')}
            </button>
            {identitiesOpen && identities.map(ident => {
              const group = projectsByIdentity[ident.id]
              if (!group || group.projects.length === 0) return null
              return (
                <div key={ident.id}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 18px 2px', fontSize: 10, fontWeight: 700,
                    color: ident.color, letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>
                    <span style={{
                      width: 13, height: 13, borderRadius: 4, background: ident.color,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 7, color: '#fff', fontWeight: 900, flexShrink: 0,
                      boxShadow: `0 0 8px ${ident.color}66`,
                    }}>
                      {ident.avatar || ident.name.charAt(0).toUpperCase()}
                    </span>
                    {ident.name}
                  </div>
                  {group.projects.map(p => (
                    <Link key={p.id} to={`/app/projects/${p.id}`} className="sb-link" style={projectLinkStyle(p.id)}>
                      <div style={{
                        width: 5, height: 5, borderRadius: '50%', background: ident.color,
                        flexShrink: 0, boxShadow: `0 0 5px ${ident.color}88`,
                      }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {p.name}
                      </span>
                      {p.total_tasks > 0 && (
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', flexShrink: 0 }}>
                          {p.total_tasks}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              )
            })}
          </>
        )}

        <button onClick={() => setProjectsOpen(v => !v)} style={{
          ...sectionHeader, marginTop: identities.length > 0 ? 8 : 0,
        }}>
          {projectsOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          {identities.length > 0 ? t('nav.allProjects') : t('nav.projects')}
          <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 10 }}>{active.length}</span>
        </button>

        {projectsOpen && (
          <>
            {active.map(p => (
              <Link key={p.id} to={`/app/projects/${p.id}`} className="sb-link" style={projectLinkStyle(p.id)}>
                <div style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: p.identities?.[0]?.color || BRAND, flexShrink: 0,
                }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {p.name}
                </span>
                {p.total_tasks > 0 && (
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', flexShrink: 0 }}>{p.total_tasks}</span>
                )}
              </Link>
            ))}
            {archived.length > 0 && (
              <div style={{ padding: '6px 18px 2px', fontSize: 9, color: 'rgba(255,255,255,0.12)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {t('archived')}
              </div>
            )}
            {archived.map(p => (
              <Link key={p.id} to={`/app/projects/${p.id}`} className="sb-link"
                style={{ ...projectLinkStyle(p.id), opacity: 0.45 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.name}</span>
              </Link>
            ))}
            {projects.length === 0 && (
              <div style={{ padding: '4px 24px', fontSize: 12, color: 'rgba(255,255,255,0.12)' }}>{t('nav.noProjectsYet')}</div>
            )}
          </>
        )}
      </div>

      {/* Language switcher */}
      <div style={{
        borderTop: `1px solid ${SB_BORDER}`,
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', flex: 1, letterSpacing: '0.04em' }}>
          {t('nav.language')}
        </span>
        {[{ code: 'en', label: 'EN' }, { code: 'zh-TW', label: '中文' }].map(({ code, label }) => (
          <button
            key={code}
            onClick={() => i18n.changeLanguage(code)}
            style={{
              padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
              fontSize: 11, fontWeight: i18n.language === code ? 700 : 400,
              background: i18n.language === code ? SB_ACTIVE : 'transparent',
              color: i18n.language === code ? DARK.text : 'rgba(255,255,255,0.3)',
              border: i18n.language === code
                ? `1px solid rgba(255,255,255,0.18)`
                : '1px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Layout() {
  const { isAuthenticated, authRequired, isLoading } = useAuth()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  useRealtimeSync()

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])

  useEffect(() => {
    const handleKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen(v => !v)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // Close sidebar on route change (mobile)
  const location = useLocation()
  useEffect(() => { setSidebarOpen(false) }, [location.pathname])

  if (isLoading) return null

  if (authRequired && !isAuthenticated) {
    const next = encodeURIComponent(window.location.pathname + window.location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  return (
    <div style={{
      display: 'flex', height: '100vh',
      fontFamily: "'SpotifyMixUI', 'Helvetica Neue', helvetica, arial, sans-serif",
      fontSize: 14, background: DARK.bgAlt,
    }}>
      {/* Mobile hamburger */}
      <button
        className="mobile-menu-btn"
        onClick={() => setSidebarOpen(v => !v)}
        style={{
          display: 'none', position: 'fixed', top: 10, left: 10, zIndex: 210,
          width: 36, height: 36, borderRadius: 8, border: 'none',
          background: 'rgba(255,255,255,0.1)', color: DARK.text, cursor: 'pointer',
          alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}
      >
        {sidebarOpen ? '\u2715' : '\u2630'}
      </button>
      {/* Mobile overlay */}
      <div
        className="mobile-overlay"
        onClick={() => setSidebarOpen(false)}
        style={{
          display: 'none', position: 'fixed', inset: 0, zIndex: 190,
          background: sidebarOpen ? 'rgba(0,0,0,0.5)' : 'transparent',
          pointerEvents: sidebarOpen ? 'auto' : 'none',
          transition: 'background 0.25s',
        }}
      />
      <div className={`layout-sidebar${sidebarOpen ? ' open' : ''}`}>
        <Sidebar onOpenPalette={openPalette} />
      </div>
      <main className="layout-main" style={{ flex: 1, overflow: 'auto', background: DARK.bgAlt }}>
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="api-keys" element={<ApiKeys />} />
          <Route path="identities" element={<Identities />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="workflow-rules" element={<WorkflowRules />} />
          <Route path="decisions" element={<Decisions />} />
          <Route path="templates" element={<Templates />} />
          <Route path="webhook-logs" element={<WebhookLogs />} />
        </Routes>
      </main>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <NotificationCenter />
      <AssistantPanel />
      <PWAInstallPrompt />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <style>{GLOBAL_CSS}</style>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/share/:token" element={<ShareView />} />
          <Route path="/login" element={<Login />} />
          <Route path="/app/*" element={<Layout />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
