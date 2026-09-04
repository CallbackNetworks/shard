/**
 * The guide's chapters (ADR-0148).
 *
 * Markdown lives here, under `src/`, and not in `docs/` — which is where the rest
 * of this project's prose lives and would have been the obvious home. It cannot:
 * `frontend/Dockerfile.prod`'s build context is `./frontend`, so nothing under
 * `docs/` exists at build time and a page importing it builds locally and fails in
 * the image. The pictures have the same constraint, which is why the capture writes
 * `frontend/public/guide/` and `docs/screenshots/` as two copies of one run.
 *
 * Eager and raw: the chapters are a handful of KB, they are the page's entire
 * content, and lazy-loading them would trade a real render for a spinner. `import`
 * rather than `fetch` also means a chapter that stops existing is a build error
 * instead of a 404 at the moment somebody clicks it.
 */
const FILES = import.meta.glob('./*/*.md', { query: '?raw', import: 'default', eager: true })

// './en/01-getting-around.md' -> { locale: 'en', slug: 'getting-around', order: 1 }
function parsePath(path) {
  const [, locale, file] = path.split('/')
  const match = /^(\d+)-(.+)\.md$/.exec(file)
  if (!match) return null
  return { locale, order: Number(match[1]), slug: match[2] }
}

// The first `# ` line is the chapter's name, so a chapter is never titled in one
// place and written in another — the two would drift and only the title is visible
// in the sidebar, which is the half that would be wrong.
function firstHeading(markdown) {
  const line = markdown.split('\n').find(l => l.startsWith('# '))
  return line ? line.slice(2).trim() : null
}

const BY_LOCALE = {}
for (const [path, body] of Object.entries(FILES)) {
  const meta = parsePath(path)
  if (!meta) continue
  const list = (BY_LOCALE[meta.locale] ||= [])
  list.push({ ...meta, body, title: firstHeading(body) || meta.slug })
}
for (const list of Object.values(BY_LOCALE)) list.sort((a, b) => a.order - b.order)

export const GUIDE_LOCALES = Object.keys(BY_LOCALE)

/**
 * The chapters for a language, falling back to English.
 *
 * A missing translation must not produce an empty guide: the fallback is the whole
 * point of having one, and "the help is blank in your language" is a worse failure
 * than "the help is in English".
 */
export function guideChapters(language) {
  return BY_LOCALE[language] || BY_LOCALE[String(language || '').split('-')[0]] || BY_LOCALE.en || []
}

export function guideChapter(language, slug) {
  const chapters = guideChapters(language)
  return chapters.find(c => c.slug === slug) || chapters[0] || null
}
