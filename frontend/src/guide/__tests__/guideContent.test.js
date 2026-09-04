import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { guideChapters, GUIDE_LOCALES } from '../index'

const PUBLIC = resolve(__dirname, '../../../public')

/**
 * The guide's pictures actually ship (ADR-0148).
 *
 * A chapter references `/guide/xx.png`, which is served from `frontend/public/` and
 * written by a capture script that is deliberately *not* part of CI. So the failure
 * mode is a renamed or not-yet-captured image producing a broken-image icon in the
 * middle of the tutorial — visible to every reader and to no test, which is the
 * same shape as the guide living in `docs/` and never reaching the app at all.
 *
 * This is the cheap half of the problem. It cannot tell that an image is *stale*;
 * that stays a human responsibility, which the ADR says out loud.
 */
describe('the guide ships what it references', () => {
  it('has chapters in both languages', () => {
    expect(GUIDE_LOCALES.sort()).toEqual(['en', 'zh-TW'])
  })

  // The two locales must describe the same product, for the reason en.json and
  // zh-TW.json must: a chapter that exists in one language is a section of the
  // manual that silently disappears when you switch.
  it('describes the same chapters in every language', () => {
    const slugs = (loc) => guideChapters(loc).map(c => c.slug).join(',')
    expect(slugs('zh-TW')).toBe(slugs('en'))
  })

  it.each(GUIDE_LOCALES)('%s chapters reference images that exist', (locale) => {
    const missing = []
    for (const chapter of guideChapters(locale)) {
      for (const [, src] of chapter.body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        if (!src.startsWith('/')) { missing.push(`${chapter.slug}: ${src} is not an absolute path`); continue }
        if (!existsSync(join(PUBLIC, src))) missing.push(`${chapter.slug}: ${src}`)
      }
    }
    expect(missing, `guide images referenced but not shipped:\n${missing.join('\n')}`).toEqual([])
  })

  it.each(GUIDE_LOCALES)('%s chapters each open with a heading', (locale) => {
    for (const chapter of guideChapters(locale)) {
      expect(chapter.body.startsWith('# '), `${locale}/${chapter.slug} has no title line`).toBe(true)
      expect(chapter.title).not.toBe(chapter.slug)
    }
  })

  it('falls back to English for a language it has no chapters in', () => {
    expect(guideChapters('de').length).toBe(guideChapters('en').length)
    // A regional variant resolves through its base language rather than falling all
    // the way to English.
    expect(guideChapters('zh-TW').length).toBeGreaterThan(0)
  })
})
