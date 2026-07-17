import {
  Activity, BarChart2, FileText, GitFork, GitMerge, Key, LayoutGrid,
  MessageCircle, Network, Settings2, Target, Users, Zap, ScrollText, Shapes, Boxes, Inbox,
} from 'lucide-react'

// Single source of truth for the sidebar rail modules. Consumed by the
// Sidebar for rendering and by the Settings page for show/hide + reorder.
// Each item's `to` path is its stable identity used in user preferences.
export const NAV_GROUPS = [
  {
    label: 'Operate',
    items: [
      { to: '/', icon: LayoutGrid, labelKey: 'nav.commandCenter', locked: true },
      { to: '/unfiled', icon: Inbox, labelKey: 'nav.unfiled' },
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
      { to: '/graph-types', icon: Shapes, labelKey: 'nav.graphTypes' },
      { to: '/explorer', icon: Boxes, labelKey: 'nav.nodeExplorer' },
      { to: '/settings', icon: Settings2, labelKey: 'nav.settings', locked: true },
    ],
  },
]

// Order a group's items by a saved list of `to` paths. Items absent from the
// saved order keep their natural relative position (stable sort).
export function orderGroupItems(items, order = []) {
  const rank = (to) => {
    const i = order.indexOf(to)
    return i === -1 ? Infinity : i
  }
  return [...items].sort((a, b) => rank(a.to) - rank(b.to))
}
