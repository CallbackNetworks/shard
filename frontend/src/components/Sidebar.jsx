import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Search, Sun, Moon } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { NAV_GROUPS, orderGroupItems } from '../constants/nav'
import { useUiPrefs } from '../utils/uiPrefs'

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
        <span>S</span>
        <b className="kt-sr-only">Shard</b>
      </div>

      <button
        onClick={onOpenPalette}
        aria-label={t('search')}
        className="kt-mini-search"
        title={`${t('search')} / ⌘K`}
      >
        <Search size={16} />
        <span className="kt-sr-only">{t('search')}</span>
      </button>

      <nav className="kt-mini-nav" aria-label="Rail module groups">
        {groups.map(group => (
          <div key={group.label} className="kt-mini-group">
            {group.items.map(({ to, icon: Icon, labelKey }) => (
              <Link
                key={to}
                to={to}
                className={isActive(to) ? 'kt-mini-nav-button is-active' : 'kt-mini-nav-button'}
                aria-label={t(labelKey)}
                title={t(labelKey)}
              >
                <Icon size={16} />
                <span className="kt-sr-only">{t(labelKey)}</span>
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
          <ExternalLink size={14} />
          <span className="kt-sr-only">{t('nav.statusPage')}</span>
        </a>
        <button
          onClick={toggleTheme}
          aria-label={mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
          title={mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
          className="kt-mini-action"
        >
          {mode === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button
          onClick={() => i18n.changeLanguage(i18n.language === 'en' ? 'zh-TW' : 'en')}
          aria-label={t('nav.language')}
          className="kt-mini-action"
        >
          <span className="kt-sr-only">{t('nav.language')}</span>
          {i18n.language === 'en' ? 'EN' : '中'}
        </button>
      </div>
    </aside>
  )
}
