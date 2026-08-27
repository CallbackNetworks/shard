import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import en from '../i18n/en.json'
import zh from '../i18n/zh-TW.json'

/**
 * Two guards for the same defect (ADR-0088): the rail, the settings page and
 * most of the app translated, while ProjectDetail — the page you spend the day
 * on — and the dashboard's main view were hardcoded English. Switching to
 * zh-TW translated the chrome and left the work in English, and nothing failed,
 * because a missing `useTranslation` is not an error and a `t()` call for a key
 * nobody added just renders the key.
 */

const SRC = resolve(__dirname, '..')

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      return name === '__tests__' ? [] : walk(full)
    }
    return full.endsWith('.jsx') ? [full] : []
  })
}

// Files that render no user-facing prose of their own: pure SVG chart
// primitives, layout wrappers, and components whose every string is a prop.
const NO_PROSE = new Set([
  'components/ProgressBar.jsx',
  'components/MarkdownPreview.jsx',
  'components/shared/Button.jsx',
  'components/shared/EmptyState.jsx',
  'components/shared/FormField.jsx',
  'components/shared/TabBar.jsx',
  'components/settings/primitives.jsx',
  'components/overview/PinButton.jsx',
  'components/dashboard/TaskRow.jsx',
  'components/dashboard/WidgetColumn.jsx',
  'components/TaskIcons.jsx',
  'App.jsx',
])

const isChartOrShare = (rel) =>
  rel.startsWith('components/charts/') ||
  // The public share page is rendered for a guest with no session and no
  // language preference; it has its own single-language copy on purpose.
  rel.startsWith('components/share/') ||
  rel === 'pages/ShareView.jsx'

describe('every page and component that shows prose is translatable', () => {
  const files = walk(SRC)
    .map(f => relative(SRC, f).replaceAll('\\', '/'))
    .filter(rel => rel.startsWith('pages/') || rel.startsWith('components/'))
    .filter(rel => !NO_PROSE.has(rel) && !isChartOrShare(rel))

  it('finds the app source', () => {
    expect(files.length).toBeGreaterThan(40)
  })

  it.each(files)('%s reads its strings from i18n', (rel) => {
    const source = readFileSync(join(SRC, rel), 'utf8')
    const translatable = /useTranslation|i18n\.t\(/.test(source)
    expect(translatable, `${rel} renders text but never calls the translator`).toBe(true)
  })
})

describe('the two locales describe the same app', () => {
  // i18next resolves `key` from `key_one` / `key_other` for languages that have
  // plurals; zh-TW has none, so a single form there is complete.
  const base = (key) => key.replace(/_(one|other|zero|few|many)$/, '')
  const enKeys = new Set(Object.keys(en).map(base))
  const zhKeys = new Set(Object.keys(zh).map(base))

  it('has no English-only strings', () => {
    expect([...enKeys].filter(k => !zhKeys.has(k))).toEqual([])
  })

  it('has no orphaned Chinese strings', () => {
    // `rules.*` names are derived from the engine's own key and translated only
    // where the derived name misleads (ADR-0058, utils/ruleTerms.js). English
    // resolves through `defaultValue`, so a zh-only entry there is the design,
    // not a gap — every other namespace must exist in both.
    const derivedNamespace = (k) => /^rules\.(field|op|action|triggerName|reason)\./.test(k)
    expect([...zhKeys].filter(k => !enKeys.has(k) && !derivedNamespace(k))).toEqual([])
  })

  it('leaves nothing untranslated by copy-paste', () => {
    // A zh-TW value identical to English is either a proper noun or a gap. The
    // known proper nouns are listed so a new one is a deliberate decision.
    const PROPER_NOUNS = new Set([
      'project.cicd', 'integrations.typeJenkins', 'integrations.typeDrone',
      'integrations.typeGithub', 'integrations.typeGitlab', 'integrations.typeBitbucket',
      'integrations.typeCircleci', 'integrations.typeEmail', 'integrations.webhookUrl',
      'integrations.webhookUrlPlaceholder', 'integrations.recipientsPlaceholder',
      'integrations.signingSecretPlaceholder', 'integrations.authBearer',
      'integrations.authBasic', 'integrations.authApiKey', 'integrations.taskCreated',
      'webhookLogs.httpCode', 'project.colId', 'overview.colPct',
      'project.repoUrlPlaceholder', 'settings.llmBaseUrl',
    ])
    const identical = Object.keys(en).filter(k => zh[k] === en[k] && !PROPER_NOUNS.has(k))
    expect(identical).toEqual([])
  })
})
