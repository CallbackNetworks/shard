import { Link, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Search, Sun, Moon, CircleSlash, Boxes } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { useIdentityFocus } from '../context/IdentityFocusContext'
import { NAV_GROUPS, orderGroupItems } from '../constants/nav'
import { useUiPrefs } from '../utils/uiPrefs'
import { getNodeTypes } from '../api/client'
import { hasNodeRole } from '../constants/nodeRoles'

// Registry-driven nav group (ADR-0037): one entry per user-defined container
// type, landing on its node listing. Individual nodes never enter the rail.
function ContainerTypesRail({ isActive }) {
  const { t } = useTranslation()
  const { data: nodeTypes = [] } = useQuery({ queryKey: ['node-types'], queryFn: getNodeTypes, staleTime: 300000 })
  const containerTypes = nodeTypes.filter(nt => hasNodeRole(nt, 'container') && !nt.is_builtin)
  if (containerTypes.length === 0) return null

  return (
    <div className="kt-mini-group">
      <div className="kt-rail-grouplabel" aria-hidden="true">{t('nav.containers')}</div>
      {containerTypes.map(nt => {
        const to = `/t/${nt.key}`
        return (
          <Link
            key={nt.key}
            to={to}
            className={isActive(to) ? 'kt-mini-nav-button is-active' : 'kt-mini-nav-button'}
            aria-label={nt.label}
            title={nt.label}
          >
            <span className="kt-rail-ico"><Boxes size={16} color={nt.color || undefined} /></span>
            <span className="kt-rail-label">{nt.label}</span>
          </Link>
        )
      })}
    </div>
  )
}

function FocusRail() {
  const { t } = useTranslation()
  const { identities, focusId, toggleFocus, clearFocus } = useIdentityFocus()
  if (identities.length === 0) return null

  return (
    <div className="kt-mini-group kt-focus-group">
      <div className="kt-rail-grouplabel" aria-hidden="true">{t('focus.title')}</div>
      {identities.map(identity => {
        const focused = focusId === identity.id
        return (
          <button
            key={identity.id}
            type="button"
            onClick={() => toggleFocus(identity.id)}
            className={focused ? 'kt-mini-nav-button kt-focus-btn is-focused' : 'kt-mini-nav-button kt-focus-btn'}
            style={{ '--focus-color': identity.color }}
            aria-pressed={focused}
            aria-label={focused ? t('focus.clear') : t('focus.focusOn', { name: identity.name })}
            title={focused ? t('focus.clear') : t('focus.focusOn', { name: identity.name })}
          >
            <span className="kt-rail-ico">
              <span className="kt-focus-avatar">{identity.avatar || identity.name.charAt(0)}</span>
            </span>
            <span className="kt-rail-label">{identity.name}</span>
          </button>
        )
      })}
      {focusId && (
        <button
          type="button"
          onClick={clearFocus}
          className="kt-mini-nav-button kt-focus-btn"
          aria-label={t('focus.clear')}
          title={t('focus.clear')}
        >
          <span className="kt-rail-ico"><CircleSlash size={16} /></span>
          <span className="kt-rail-label">{t('focus.clear')}</span>
        </button>
      )}
    </div>
  )
}

export default function Sidebar({ onOpenPalette }) {
  const { mode, toggle: toggleTheme } = useTheme()
  const location = useLocation()
  const { t, i18n } = useTranslation()
  const prefs = useUiPrefs()

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(path + '/')

  const hidden = new Set(prefs.sidebarHidden)
  const groups = NAV_GROUPS
    .map(g => ({
      ...g,
      items: orderGroupItems(g.items, prefs.sidebarOrder).filter(it => it.locked || !hidden.has(it.to)),
    }))
    .filter(g => g.items.length > 0)

  return (
    <aside className="kt-sidebar kt-mini-rail" aria-label="Sidebar navigation">
      <div className="kt-mini-brand" title="Shard">
        <span className="kt-rail-logo">S</span>
        <b className="kt-rail-word">SHARD</b>
      </div>

      <button
        onClick={onOpenPalette}
        aria-label={t('search')}
        className="kt-mini-search"
        title={`${t('search')} / ⌘K`}
      >
        <span className="kt-rail-ico"><Search size={16} /></span>
        <span className="kt-rail-label">{t('search')}</span>
        <kbd className="kt-rail-kbd">⌘K</kbd>
      </button>

      <nav className="kt-mini-nav" aria-label="Rail module groups">
        <FocusRail />
        <ContainerTypesRail isActive={isActive} />
        {groups.map(group => (
          <div key={group.label} className="kt-mini-group">
            <div className="kt-rail-grouplabel" aria-hidden="true">{group.label}</div>
            {group.items.map(({ to, icon: Icon, labelKey }) => (
              <Link
                key={to}
                to={to}
                className={isActive(to) ? 'kt-mini-nav-button is-active' : 'kt-mini-nav-button'}
                aria-label={t(labelKey)}
                title={t(labelKey)}
              >
                <span className="kt-rail-ico"><Icon size={16} /></span>
                <span className="kt-rail-label">{t(labelKey)}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="kt-mini-actions">
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          aria-label={t('nav.statusPage')}
          title={t('nav.statusPage')}
          className="kt-mini-action"
        >
          <span className="kt-rail-ico"><ExternalLink size={16} /></span>
          <span className="kt-rail-label">{t('nav.statusPage')}</span>
        </a>
        <button
          onClick={toggleTheme}
          aria-label={mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
          title={mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
          className="kt-mini-action"
        >
          <span className="kt-rail-ico">{mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</span>
          <span className="kt-rail-label">{mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}</span>
        </button>
        <button
          onClick={() => i18n.changeLanguage(i18n.language === 'en' ? 'zh-TW' : 'en')}
          aria-label={t('nav.language')}
          className="kt-mini-action"
        >
          <span className="kt-rail-ico">{i18n.language === 'en' ? 'EN' : '中'}</span>
          <span className="kt-rail-label">{t('nav.language')}</span>
        </button>
      </div>
    </aside>
  )
}
