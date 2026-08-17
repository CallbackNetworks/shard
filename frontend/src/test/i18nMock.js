import en from '../i18n/en.json'

/**
 * A `react-i18next` mock that resolves real English (ADR-0088, ADR-0089).
 *
 * The usual `t: (k) => k` mock makes a test assert on the key, which is exactly
 * how a page can stop being translated without anything failing — the assertion
 * describes the catalogue, not what a user sees. This resolves the same strings
 * the app ships, including the `_one` / `_other` plural forms and `{{...}}`
 * interpolation, so an assertion stays about the rendered text.
 *
 * Use it from a `vi.mock` factory, which is hoisted and so cannot close over an
 * import of its own:
 *
 *   vi.mock('react-i18next', async () => (await import('<path>/test/i18nMock')).reactI18nextMock())
 */
export function translate(key, opts = {}) {
  const plural = opts.count === 1 ? `${key}_one` : `${key}_other`
  let out = en[plural] ?? en[key] ?? key
  for (const [name, value] of Object.entries(opts)) {
    out = out.replaceAll(`{{${name}}}`, value)
  }
  return out
}

export function reactI18nextMock() {
  return {
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', changeLanguage: () => {} },
    }),
    Trans: ({ i18nKey }) => translate(i18nKey),
  }
}
