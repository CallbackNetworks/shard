import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { BrowserRouter, useLocation, useNavigate, Routes, Route, Navigate } from 'react-router-dom'
import CommandPalette from './components/CommandPalette'
import AssistantPanel from './components/AssistantPanel'
import NotificationCenter from './components/NotificationCenter'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import OfflineIndicator from './components/OfflineIndicator'
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp'
import Sidebar from './components/Sidebar'
import GlobalActivityTicker from './components/GlobalActivityTicker'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import { IdentityFocusProvider } from './context/IdentityFocusContext'
import ErrorBoundary from './components/ErrorBoundary'
import { BRAND, DARK, FONT } from './constants/theme'
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
const StructureMap = lazy(() => import('./pages/StructureMap'))
const Assistant = lazy(() => import('./pages/Assistant'))
const Settings = lazy(() => import('./pages/Settings'))
const GraphTypes = lazy(() => import('./pages/GraphTypes'))
const NodeExplorer = lazy(() => import('./pages/NodeExplorer'))
const NodePage = lazy(() => import('./pages/NodePage'))
const ContainerView = lazy(() => import('./pages/ContainerView'))
const TypeNodesPage = lazy(() => import('./pages/TypeNodesPage'))
const Unfiled = lazy(() => import('./pages/Unfiled'))
const ShareView = lazy(() => import('./pages/ShareView'))
const Login = lazy(() => import('./pages/Login'))

function LoadingSpinner() {
  return (
    <div className="kt-loading" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', width: '100%', color: DARK.textMid,
    }}>
      <span>LOADING</span>
      <span>SYNC</span>
      <span>FETCH</span>
    </div>
  )
}

function Layout() {
  const { isAuthenticated, authRequired, isLoading } = useAuth()
  const { theme } = useTheme()
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
  useEffect(() => {
    document.documentElement.dataset.motion = 'full'
  }, [])

  if (isLoading) return null

  if (authRequired && !isAuthenticated) {
    const next = encodeURIComponent(window.location.pathname + window.location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  return (
    <div style={{
      display: 'flex', height: '100vh',
      fontFamily: FONT.family,
      fontSize: 14, background: theme.bgAlt,
      color: theme.text,
    }}>
      {/* Skip to content link */}
      <a
        href="#main-content"
        className="skip-to-content"
        style={{
          position: 'absolute', left: -9999, top: 'auto', width: 1, height: 1,
          overflow: 'hidden', zIndex: 9999,
        }}
        onFocus={e => Object.assign(e.target.style, { left: 8, top: 8, width: 'auto', height: 'auto', padding: '8px 16px', background: BRAND, color: '#000', borderRadius: 6, fontWeight: 700, fontSize: 13 })}
        onBlur={e => Object.assign(e.target.style, { left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' })}
      >
        Skip to content
      </a>
      {/* Mobile hamburger */}
      <button
        className="mobile-menu-btn"
        onClick={() => setSidebarOpen(v => !v)}
        aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={sidebarOpen}
        style={{
          display: 'none', position: 'fixed', top: 10, left: 10, zIndex: 210,
          width: 36, height: 36, borderRadius: 8, border: 'none',
          background: theme.hover, color: theme.text, cursor: 'pointer',
          alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}
      >
        {sidebarOpen ? '\u2715' : '\u2630'}
      </button>
      {/* Mobile overlay */}
      <div
        className="mobile-overlay"
        onClick={() => setSidebarOpen(false)}
        role="presentation"
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
      <main id="main-content" className="layout-main" role="main" style={{ flex: 1, overflow: 'auto', background: theme.bgAlt }}>
        <GlobalActivityTicker />
        <div key={location.pathname} className="kt-route-shell">
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
              <Route path="structure" element={<StructureMap />} />
              <Route path="assistant" element={<Assistant />} />
              <Route path="settings" element={<Settings />} />
              <Route path="graph-types" element={<GraphTypes />} />
              <Route path="explorer" element={<NodeExplorer />} />
              <Route path="n/:id" element={<NodePage />} />
              <Route path="c/:id" element={<ContainerView />} />
              <Route path="t/:typeKey" element={<TypeNodesPage />} />
              <Route path="unfiled" element={<Unfiled />} />
            </Routes>
          </Suspense>
        </div>
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
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <Suspense fallback={<LoadingSpinner />}>
                <Routes>
                  <Route path="/share/:token" element={<ShareView scope="identity" />} />
                  <Route path="/share/p/:token" element={<ShareView scope="project" />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/*" element={<IdentityFocusProvider><Layout /></IdentityFocusProvider>} />
                </Routes>
              </Suspense>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
