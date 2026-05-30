import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, Zap, Key, Users, ChevronDown, ChevronRight, ExternalLink, Search, BarChart2, GitMerge, GitFork, FileText, ScrollText } from 'lucide-react'
import { getProjects, getIdentities } from '../api/client'
import { BRAND, INSET_SHADOW, DARK } from '../constants/theme'

const SB_BG     = DARK.bgAlt
const SB_TEXT   = DARK.textMid
const SB_ACTIVE = DARK.elevated
const SB_BORDER = DARK.border

export default function Sidebar({ onOpenPalette }) {
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

      {/* Search button */}
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
