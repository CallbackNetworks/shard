import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Search, Sun, Moon, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { NAV_GROUPS, orderGroupItems } from '../constants/nav'
import { useUiPrefs, setUiPref } from '../utils/uiPrefs'
import FocusSwitcher from './FocusSwitcher'

export default function Sidebar({ onOpenPalette }) {
  const { mode, toggle: toggleTheme } = useTheme()
  const location = useLocation()
  const { t, i18n } = useTranslation()
  const prefs = useUiPrefs()
  const [focusOpen, setFocusOpen] = useState(false)

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
    <aside
      className={focusOpen ? 'kt-sidebar kt-mini-rail is-menu-open' : 'kt-sidebar kt-mini-rail'}
      aria-label="Sidebar navigation"
      data-tour="rail"
    >
      <div className="kt-mini-brand" title="Shard">
        <span className="kt-rail-logo">S</span>
        <b className="kt-rail-word">SHARD</b>
      </div>

      <button
        onClick={onOpenPalette}
        aria-label={t('search')}
        data-tour="search"
        className="kt-mini-search"
        title={`${t('search')} / ⌘K`}
      >
        <span className="kt-rail-ico"><Search size={16} /></span>
        <span className="kt-rail-label">{t('search')}</span>
        <kbd className="kt-rail-kbd">⌘K</kbd>
      </button>

      {/* Its own grid row, above the scrolling nav: the focus control must
          stay reachable no matter how far the module list runs. */}
      <div className="kt-mini-focus-slot" data-tour="focus">
        <FocusSwitcher open={focusOpen} onOpenChange={setFocusOpen} />
      </div>

      <nav className="kt-mini-nav" aria-label="Rail module groups">
        {groups.map(group => (
          <div key={group.labelKey} className="kt-mini-group">
            <div className="kt-rail-grouplabel" aria-hidden="true">{t(group.labelKey)}</div>
            {group.items.map(({ to, icon: Icon, labelKey, tour }) => (
              <Link
                key={to}
                to={to}
                className={isActive(to) ? 'kt-mini-nav-button is-active' : 'kt-mini-nav-button'}
                aria-label={t(labelKey)}
                title={t(labelKey)}
                data-tour={tour}
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
        {/* Collapsing is a deliberate, remembered choice. It used to happen on
            hover, which both hid every label by default and put the expanded
            rail on top of the page it was navigating (ADR-0088). */}
        <button
          onClick={() => setUiPref('railExpanded', !prefs.railExpanded)}
          aria-label={prefs.railExpanded ? t('nav.collapseRail') : t('nav.expandRail')}
          title={prefs.railExpanded ? t('nav.collapseRail') : t('nav.expandRail')}
          aria-expanded={!!prefs.railExpanded}
          className="kt-mini-action"
        >
          <span className="kt-rail-ico">
            {prefs.railExpanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </span>
          <span className="kt-rail-label">{t('nav.collapseRail')}</span>
        </button>
      </div>
    </aside>
  )
}
