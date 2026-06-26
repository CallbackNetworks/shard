import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, Zap, Key, Users, ChevronDown, ChevronRight, ExternalLink, Search, BarChart2, GitMerge, GitFork, FileText, ScrollText, Target, Activity, MessageCircle, Settings2, Sun, Moon } from 'lucide-react'
import { getProjects, getIdentities } from '../api/client'
import { BRAND, FONT } from '../constants/theme'
import { useTheme } from '../context/ThemeContext'

export default function Sidebar({ onOpenPalette }) {
  const { mode, toggle: toggleTheme } = useTheme()
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

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(path + '/')

  const navLinkStyle = (path) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 12px', borderRadius: 0, textDecoration: 'none',
    fontSize: 13, fontWeight: isActive(path) ? 700 : 400, margin: '1px 6px',
    letterSpacing: '0.04em', textTransform: 'uppercase',
    color: isActive(path) ? '#ffffff' : '#9ca3af',
    background: isActive(path) ? 'rgba(255,255,255,0.05)' : 'transparent',
    borderLeft: isActive(path) ? '2px solid #ef4444' : '2px solid transparent',
  })

  const projectLinkStyle = (id) => {
    const on = location.pathname === `/projects/${id}`
    return {
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 12px 4px 28px', borderRadius: 0, textDecoration: 'none',
      fontSize: 12, fontWeight: on ? 700 : 400, margin: '1px 6px', overflow: 'hidden',
      letterSpacing: '0.04em',
      color: on ? '#ffffff' : '#9ca3af',
      background: on ? 'rgba(255,255,255,0.05)' : 'transparent',
      borderLeft: on ? '2px solid #ef4444' : '2px solid transparent',
      transition: 'background 0.12s, color 0.12s',
    }
  }

  const sectionHeader = {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '3px 12px', width: '100%', background: 'none', border: 'none',
    cursor: 'pointer', color: '#4b5563', fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 2,
    borderBottom: '1px solid #1f2937', paddingBottom: 4,
  }

  return (
    <aside aria-label="Sidebar navigation" style={{
      width: 220, minWidth: 220, background: '#000000', height: '100vh',
      display: 'flex', flexDirection: 'column', borderRight: '1px solid #1f2937',
      overflow: 'hidden', userSelect: 'none',
    }}>
      {/* Brand */}
      <div style={{
        padding: '20px 16px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid #1f2937',
      }}>
        <div style={{
          width: 28, height: 28, flexShrink: 0,
          borderRadius: 0,
          background: '#ef4444',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 900, color: '#ffffff',
        }}>S</div>
        <span style={{
          color: '#ffffff', fontWeight: 700, fontSize: 18,
          letterSpacing: '0.2em', textTransform: 'uppercase',
          fontFamily: FONT.display,
        }}>
          Shard
        </span>
      </div>

      {/* Search button */}
      <button
        onClick={onOpenPalette}
        aria-label={t('search')}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          margin: '10px 12px', padding: '8px 14px', borderRadius: 0,
          background: 'transparent', border: '1px solid #1f2937',
          cursor: 'pointer', width: 'calc(100% - 24px)',
          color: '#9ca3af', fontSize: 12,
          letterSpacing: '0.04em', textTransform: 'uppercase',
          transition: 'background 0.12s, border-color 0.12s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = '#ffffff' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#1f2937' }}
      >
        <Search size={12} />
        <span style={{ flex: 1, textAlign: 'left' }}>{t('search')}</span>
        <kbd style={{
          padding: '1px 6px', borderRadius: 0, fontSize: 10,
          background: 'transparent', color: '#9ca3af',
          border: '1px solid #374151',
        }}>⌘K</kbd>
      </button>

      {/* Nav links */}
      <nav aria-label="Main navigation" style={{ padding: '8px 0', borderBottom: '1px solid #1f2937' }}>
        {[
          { to: '/', icon: <LayoutGrid size={13} />, labelKey: 'nav.myIssues' },
          { to: '/identities', icon: <Users size={13} />, labelKey: 'nav.identities' },
          { to: '/integrations', icon: <Zap size={13} />, labelKey: 'nav.integrations' },
          { to: '/api-keys', icon: <Key size={13} />, labelKey: 'nav.apiKeys' },
          { to: '/analytics', icon: <BarChart2 size={13} />, labelKey: 'nav.analytics' },
          { to: '/workflow-rules', icon: <GitMerge size={13} />, labelKey: 'nav.workflowRules' },
          { to: '/goals', icon: <Target size={13} />, labelKey: 'nav.goals' },
          { to: '/decisions', icon: <GitFork size={13} />, labelKey: 'nav.decisions' },
          { to: '/templates', icon: <FileText size={13} />, labelKey: 'nav.templates' },
          { to: '/webhook-logs', icon: <ScrollText size={13} />, labelKey: 'nav.webhookLogs' },
          { to: '/activity', icon: <Activity size={13} />, labelKey: 'nav.activity' },
          { to: '/assistant', icon: <MessageCircle size={13} />, labelKey: 'nav.assistant' },
          { to: '/settings', icon: <Settings2 size={13} />, labelKey: 'nav.settings' },
        ].map(({ to, icon, labelKey }) => (
          <Link key={to} to={to} className="sb-link" style={navLinkStyle(to)}
            aria-current={isActive(to) ? 'page' : undefined}>
            {icon}{t(labelKey)}
          </Link>
        ))}
        <a href="/" target="_blank" rel="noreferrer" className="sb-link"
          style={{ ...navLinkStyle('/status-noop'), color: '#9ca3af' }}>
          <ExternalLink size={13} />{t('nav.statusPage')}
        </a>
      </nav>

      {/* Project tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0', minHeight: 0 }}>
        {identities.length > 0 && (
          <>
            <button onClick={() => setIdentitiesOpen(v => !v)} style={sectionHeader} aria-expanded={identitiesOpen}>
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
                    color: ident.color, letterSpacing: '0.1em', textTransform: 'uppercase',
                    borderBottom: '1px solid #1f2937', marginBottom: 2, paddingBottom: 4,
                  }}>
                    <span style={{
                      width: 13, height: 13, borderRadius: 0, background: ident.color,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 7, color: '#fff', fontWeight: 900, flexShrink: 0,
                    }}>
                      {ident.avatar || ident.name.charAt(0).toUpperCase()}
                    </span>
                    {ident.name}
                  </div>
                  {group.projects.map(p => (
                    <Link key={p.id} to={`/projects/${p.id}`} className="sb-link" style={projectLinkStyle(p.id)}>
                      <div style={{
                        width: 5, height: 5, borderRadius: '50%', background: ident.color,
                        flexShrink: 0,
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

        <button onClick={() => setProjectsOpen(v => !v)} aria-expanded={projectsOpen} style={{
          ...sectionHeader, marginTop: identities.length > 0 ? 8 : 0,
        }}>
          {projectsOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          {identities.length > 0 ? t('nav.allProjects') : t('nav.projects')}
          <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 10 }}>{active.length}</span>
        </button>

        {projectsOpen && (
          <>
            {active.map(p => {
              const dotColor = p.identities?.[0]?.color || BRAND
              return (
              <Link key={p.id} to={`/projects/${p.id}`} className="sb-link" style={projectLinkStyle(p.id)}>
                <div style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: dotColor, flexShrink: 0,
                }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {p.name}
                </span>
                {p.total_tasks > 0 && (
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', flexShrink: 0 }}>{p.total_tasks}</span>
                )}
              </Link>
              )
            })}
            {archived.length > 0 && (
              <div style={{ padding: '6px 18px 2px', fontSize: 9, color: 'rgba(255,255,255,0.12)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {t('archived')}
              </div>
            )}
            {archived.map(p => (
              <Link key={p.id} to={`/projects/${p.id}`} className="sb-link"
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

      {/* Theme & Language */}
      <div style={{
        borderTop: '1px solid #1f2937',
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          aria-label={mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
          title={mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
          style={{
            padding: '4px 6px', borderRadius: 0, cursor: 'pointer',
            background: 'transparent', border: '1px solid #1f2937',
            color: '#ffffff', display: 'flex', alignItems: 'center',
            transition: 'all 0.15s',
          }}
        >
          {mode === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>
        <span style={{ fontSize: 10, color: '#4b5563', flex: 1, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {t('nav.language')}
        </span>
        {[{ code: 'en', label: 'EN' }, { code: 'zh-TW', label: '中文' }].map(({ code, label }) => (
          <button
            key={code}
            onClick={() => i18n.changeLanguage(code)}
            aria-pressed={i18n.language === code}
            style={{
              padding: '3px 9px', borderRadius: 0, cursor: 'pointer',
              fontSize: 10, fontWeight: i18n.language === code ? 700 : 400,
              background: i18n.language === code ? 'rgba(255,255,255,0.05)' : 'transparent',
              color: i18n.language === code ? '#ffffff' : '#4b5563',
              border: i18n.language === code
                ? '1px solid #374151'
                : '1px solid #1f2937',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </aside>
  )
}
