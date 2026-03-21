import { useState } from 'react'
import { BrowserRouter, Link, useLocation, Routes, Route, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, Zap, Key, Users, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { getProjects, getIdentities } from './api/client'
import Dashboard from './pages/Dashboard'
import ProjectDetail from './pages/ProjectDetail'
import Integrations from './pages/Integrations'
import ApiKeys from './pages/ApiKeys'
import Identities from './pages/Identities'
import Overview from './pages/Overview'
import Login from './pages/Login'
import { AuthProvider, useAuth } from './context/AuthContext'
import { BRAND } from './constants/theme'
const SB_BG = '#161618'
const SB_TEXT = '#8b8b9a'
const SB_ACTIVE = '#252531'
const SB_BORDER = '#2a2a35'

function Sidebar() {
  const location = useLocation()
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

  // Group projects by identity
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

  const navLinkStyle = (path) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 10px', borderRadius: 6, textDecoration: 'none',
    fontSize: 13, fontWeight: 500,
    color: location.pathname === path || location.pathname.startsWith(path + '/') ? '#fff' : SB_TEXT,
    background: location.pathname === path || location.pathname.startsWith(path + '/') ? SB_ACTIVE : 'transparent',
    margin: '1px 6px', transition: 'background 0.1s, color 0.1s',
  })

  const projectLinkStyle = (id) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '4px 10px 4px 32px', borderRadius: 6, textDecoration: 'none',
    fontSize: 13,
    color: location.pathname === `/app/projects/${id}` ? '#fff' : SB_TEXT,
    background: location.pathname === `/app/projects/${id}` ? SB_ACTIVE : 'transparent',
    margin: '1px 6px', overflow: 'hidden', transition: 'background 0.1s',
  })

  const projectDot = (color) => (
    <div style={{
      width: 6, height: 6, borderRadius: '50%', background: color || BRAND, flexShrink: 0,
    }} />
  )

  return (
    <div style={{
      width: 220, minWidth: 220, background: SB_BG, height: '100vh',
      display: 'flex', flexDirection: 'column', borderRight: `1px solid ${SB_BORDER}`,
      overflow: 'hidden', userSelect: 'none',
    }}>
      <div style={{
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: `1px solid ${SB_BORDER}`,
      }}>
        <div style={{
          width: 26, height: 26, background: BRAND, borderRadius: 7,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 800, color: '#fff',
        }}>T</div>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>TODO Platform</span>
      </div>

      <div style={{ padding: '8px 0', borderBottom: `1px solid ${SB_BORDER}` }}>
        <Link to="/app" style={navLinkStyle('/app')}>
          <LayoutGrid size={14} />
          My Issues
        </Link>
        <Link to="/app/identities" style={navLinkStyle('/app/identities')}>
          <Users size={14} />
          Identities
        </Link>
        <Link to="/app/integrations" style={navLinkStyle('/app/integrations')}>
          <Zap size={14} />
          Integrations
        </Link>
        <Link to="/app/api-keys" style={navLinkStyle('/app/api-keys')}>
          <Key size={14} />
          API Keys
        </Link>
        <a href="/" target="_blank" rel="noreferrer" style={{ ...navLinkStyle('/'), gap: 8 }}>
          <ExternalLink size={14} />
          Status Page
        </a>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {/* Identity-grouped projects */}
        {identities.length > 0 && (
          <>
            <button
              onClick={() => setIdentitiesOpen(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 12px', width: '100%', background: 'none', border: 'none',
                cursor: 'pointer', color: '#555566', fontSize: 11, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2,
              }}
            >
              {identitiesOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              By Identity
            </button>

            {identitiesOpen && identities.map(ident => {
              const group = projectsByIdentity[ident.id]
              if (!group || group.projects.length === 0) return null
              return (
                <div key={ident.id}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 18px 2px', fontSize: 11, fontWeight: 600,
                    color: ident.color,
                  }}>
                    <span style={{
                      width: 14, height: 14, borderRadius: 4, background: ident.color,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 8, color: '#fff', fontWeight: 700, flexShrink: 0,
                    }}>
                      {ident.avatar || ident.name.charAt(0).toUpperCase()}
                    </span>
                    {ident.name}
                  </div>
                  {group.projects.map(p => (
                    <Link key={p.id} to={`/app/projects/${p.id}`} style={projectLinkStyle(p.id)}>
                      {projectDot(ident.color)}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {p.name}
                      </span>
                      {p.total_tasks > 0 && (
                        <span style={{ fontSize: 10, color: '#555566', flexShrink: 0 }}>{p.total_tasks}</span>
                      )}
                    </Link>
                  ))}
                </div>
              )
            })}
          </>
        )}

        {/* All projects section */}
        <button
          onClick={() => setProjectsOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 12px', width: '100%', background: 'none', border: 'none',
            cursor: 'pointer', color: '#555566', fontSize: 11, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2,
            marginTop: identities.length > 0 ? 8 : 0,
          }}
        >
          {projectsOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {identities.length > 0 ? 'All Projects' : 'Projects'}
          <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 10 }}>{active.length}</span>
        </button>

        {projectsOpen && (
          <>
            {active.map(p => (
              <Link key={p.id} to={`/app/projects/${p.id}`} style={projectLinkStyle(p.id)}>
                {projectDot(p.identities?.[0]?.color)}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {p.name}
                </span>
                {p.total_tasks > 0 && (
                  <span style={{ fontSize: 10, color: '#555566', flexShrink: 0 }}>{p.total_tasks}</span>
                )}
              </Link>
            ))}
            {archived.length > 0 && (
              <div style={{ padding: '6px 18px 2px', fontSize: 10, color: '#444455', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Archived
              </div>
            )}
            {archived.map(p => (
              <Link key={p.id} to={`/app/projects/${p.id}`} style={{ ...projectLinkStyle(p.id), opacity: 0.6 }}>
                {projectDot(p.identities?.[0]?.color)}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {p.name}
                </span>
              </Link>
            ))}
            {projects.length === 0 && (
              <div style={{ padding: '4px 24px', fontSize: 12, color: '#444455' }}>No projects yet</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Layout() {
  const { isAuthenticated, authRequired, isLoading } = useAuth()

  if (isLoading) return null

  if (authRequired && !isAuthenticated) {
    const next = encodeURIComponent(window.location.pathname + window.location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", sans-serif', fontSize: 14 }}>
      <Sidebar />
      <main style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="api-keys" element={<ApiKeys />} />
          <Route path="identities" element={<Identities />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/login" element={<Login />} />
          <Route path="/app/*" element={<Layout />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
