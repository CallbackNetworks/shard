import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { BrowserRouter, useLocation, useNavigate, Routes, Route, Navigate } from 'react-router-dom'
import CommandPalette from './components/CommandPalette'
import AssistantPanel from './components/AssistantPanel'
import NotificationCenter from './components/NotificationCenter'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import OfflineIndicator from './components/OfflineIndicator'
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp'
import Sidebar from './components/Sidebar'
import { AuthProvider, useAuth } from './context/AuthContext'
import { BRAND, DARK } from './constants/theme'
import useRealtimeSync from './hooks/useRealtimeSync'
import useKeyboardShortcuts from './hooks/useKeyboardShortcuts'
import './styles/global.css'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
const Integrations = lazy(() => import('./pages/Integrations'))
const ApiKeys = lazy(() => import('./pages/ApiKeys'))
const Identities = lazy(() => import('./pages/Identities'))
const Analytics = lazy(() => import('./pages/Analytics'))
const WorkflowRules = lazy(() => import('./pages/WorkflowRules'))
const Templates = lazy(() => import('./pages/Templates'))
const WebhookLogs = lazy(() => import('./pages/WebhookLogs'))
const Decisions = lazy(() => import('./pages/Decisions'))
const Goals = lazy(() => import('./pages/Goals'))
const Activity = lazy(() => import('./pages/Activity'))
const Assistant = lazy(() => import('./pages/Assistant'))
const Settings = lazy(() => import('./pages/Settings'))
const Overview = lazy(() => import('./pages/Overview'))
const ShareView = lazy(() => import('./pages/ShareView'))
const Login = lazy(() => import('./pages/Login'))

function LoadingSpinner() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', width: '100%', color: DARK.textMid, fontSize: 13,
    }}>
      <div style={{
        width: 20, height: 20, border: `2px solid ${DARK.border}`,
        borderTopColor: BRAND, borderRadius: '50%',
        animation: 'spin 0.6s linear infinite',
      }} />
    </div>
  )
}

function Layout() {
  const { isAuthenticated, authRequired, isLoading } = useAuth()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)
  useRealtimeSync()

  const nav = useNavigate()
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])

  useKeyboardShortcuts({
    onSearch: openPalette,
    onShowHelp: () => setShortcutsHelpOpen(v => !v),
    navigate: nav,
  })

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
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="projects/:id" element={<ProjectDetail />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="api-keys" element={<ApiKeys />} />
            <Route path="identities" element={<Identities />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="workflow-rules" element={<WorkflowRules />} />
            <Route path="decisions" element={<Decisions />} />
            <Route path="goals" element={<Goals />} />
            <Route path="templates" element={<Templates />} />
            <Route path="webhook-logs" element={<WebhookLogs />} />
            <Route path="activity" element={<Activity />} />
            <Route path="assistant" element={<Assistant />} />
            <Route path="settings" element={<Settings />} />
          </Routes>
        </Suspense>
      </main>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <NotificationCenter />
      <AssistantPanel />
      <PWAInstallPrompt />
      <KeyboardShortcutsHelp open={shortcutsHelpOpen} onClose={() => setShortcutsHelpOpen(false)} />
      <OfflineIndicator />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/share/:token" element={<ShareView />} />
            <Route path="/login" element={<Login />} />
            <Route path="/app/*" element={<Layout />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
