import '@testing-library/jest-dom'

// Initialise the real i18n singleton for the whole suite. Without it,
// `useTranslation()` falls back to an uninitialised instance whose `t` returns
// the key, so a test asserting on the text a user sees passes only for as long
// as the component is untranslated — which is exactly what let ProjectDetail
// stay hardcoded English (ADR-0088). Tests that mock react-i18next themselves
// are unaffected.
import '../i18n'
