import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { BrowserRouter, useLocation, useNavigate, Routes, Route, Navigate } from 'react-router'
import CommandPalette from './components/CommandPalette'
import AssistantPanel from './components/AssistantPanel'
import NotificationCenter from './components/NotificationCenter'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import OfflineIndicator from './components/OfflineIndicator'
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp'
import Sidebar from './components/Sidebar'
import GlobalActivityTicker from './components/GlobalActivityTicker'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import { IdentityFocusProvider } from './context/IdentityFocusContext'
import { TourProvider } from './components/tour/TourContext'
import TourOverlay from './components/tour/TourOverlay'
import PageTourLauncher from './components/tour/PageTourLauncher'
import { BRAND, DARK, FONT } from './constants/theme'
import useRealtimeSync from './hooks/useRealtimeSync'
import useKeyboardShortcuts from './hooks/useKeyboardShortcuts'
import './styles/global.css'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Guide = lazy(() => import('./pages/Guide'))
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
  const [paletteMode, setPaletteMode] = useState('all')
  const [paletteIntent, setPaletteIntent] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)
  useRealtimeSync()

  const nav = useNavigate()
  const openPalette = useCallback(() => { setPaletteMode('all'); setPaletteIntent(null); setPaletteOpen(true) }, [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  // Project switching lives here rather than in the rail (ADR-0067).
  const openProjectSwitcher = useCallback(() => { setPaletteMode('projects'); setPaletteIntent(null); setPaletteOpen(true) }, [])

  // `c` creates a task. On a project page that means "here"; anywhere else the
  // question "in which project?" has no default, so it opens the switcher
  // carrying the intent (ADR-0067: which project you want is a choice).
  const createTaskHere = useCallback(() => {
    if (/^\/projects\/[^/]+/.test(window.location.pathname)) {
      nav(`${window.location.pathname}?new=task`)
      return
    }
    setPaletteMode('projects')
    setPaletteIntent('new-task')
    setPaletteOpen(true)
  }, [nav])
  const createProject = useCallback(() => nav('/?new=project'), [nav])

  useKeyboardShortcuts({
    onSearch: openPalette,
    onShowHelp: () => setShortcutsHelpOpen(v => !v),
    onSwitchProject: openProjectSwitcher,
    onCreateTask: createTaskHere,
    onCreateProject: createProject,
    navigate: nav,
  })

  useEffect(() => {
    const handleKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteMode('all')
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
        onFocus={e => Object.assign(e.target.style, { left: 8, top: 8, width: 'auto', height: 'auto', padding: '8px 16px', background: BRAND, color: 'var(--kt-on-fill)', borderRadius: 6, fontWeight: 700, fontSize: 13 })}
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
              {/* Both pages were folded into the two that remain (ADR-0150): unfiled is
                  a filter on the data page, and the container-type list was a weaker copy
                  of the type registry's own. The paths stay so a bookmark still lands
                  somewhere true — a retired page must not become a 404. */}
              <Route path="unfiled" element={<Navigate to="/explorer?loose=1" replace />} />
              <Route path="containers" element={<Navigate to="/graph-types" replace />} />
              {/* The chapter is in the URL: a guide is a thing people link each
                  other to, and "read the section on decisions" has to be a link
                  rather than directions (ADR-0148). */}
              <Route path="guide" element={<Guide />} />
              <Route path="guide/:chapter" element={<Guide />} />
            </Routes>
          </Suspense>
        </div>
      </main>
      <CommandPalette open={paletteOpen} onClose={closePalette} mode={paletteMode} intent={paletteIntent} />
      <NotificationCenter />
      <AssistantPanel />
      <PWAInstallPrompt />
      <KeyboardShortcutsHelp open={shortcutsHelpOpen} onClose={() => setShortcutsHelpOpen(false)} />
      <OfflineIndicator />
      <PageTourLauncher />
      <TourOverlay />
    </div>
  )
}

// ErrorBoundary and ToastProvider are mounted once, in main.jsx — they wrap the
// QueryClientProvider whose MutationCache.onError pushes through globalAddToast.
// Mounting a second ToastProvider here gave the app two toast stacks and let the
// inner one silently take over the global bridge.
export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Suspense fallback={<LoadingSpinner />}>
            <Routes>
              <Route path="/share/n/:token" element={<ShareView />} />
              <Route path="/login" element={<Login />} />
              <Route path="/*" element={<IdentityFocusProvider><TourProvider><Layout /></TourProvider></IdentityFocusProvider>} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
