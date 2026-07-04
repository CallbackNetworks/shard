import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Activity, BarChart2, ExternalLink, FileText, GitFork, GitMerge, Key, LayoutGrid, MessageCircle, Network, Search, Settings2, Sun, Moon, Target, Users, Zap, ScrollText } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

const NAV_GROUPS = [
  {
    label: 'Operate',
    items: [
      { to: '/', icon: LayoutGrid, labelKey: 'nav.commandCenter' },
      { to: '/structure', icon: Network, labelKey: 'nav.structureMap' },
      { to: '/activity', icon: Activity, labelKey: 'nav.activity' },
      { to: '/analytics', icon: BarChart2, labelKey: 'nav.analytics' },
    ],
  },
  {
    label: 'Think',
    items: [
      { to: '/goals', icon: Target, labelKey: 'nav.goals' },
      { to: '/decisions', icon: GitFork, labelKey: 'nav.decisions' },
      { to: '/templates', icon: FileText, labelKey: 'nav.templates' },
      { to: '/assistant', icon: MessageCircle, labelKey: 'nav.assistant' },
    ],
  },
  {
    label: 'Build',
    items: [
      { to: '/integrations', icon: Zap, labelKey: 'nav.integrations' },
      { to: '/workflow-rules', icon: GitMerge, labelKey: 'nav.workflowRules' },
      { to: '/webhook-logs', icon: ScrollText, labelKey: 'nav.webhookLogs' },
      { to: '/api-keys', icon: Key, labelKey: 'nav.apiKeys' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/identities', icon: Users, labelKey: 'nav.identities' },
      { to: '/settings', icon: Settings2, labelKey: 'nav.settings' },
    ],
  },
]

export default function Sidebar({ onOpenPalette }) {
  const { mode, toggle: toggleTheme } = useTheme()
  const location = useLocation()
  const { t, i18n } = useTranslation()

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(path + '/')

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
        {NAV_GROUPS.map(group => (
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
