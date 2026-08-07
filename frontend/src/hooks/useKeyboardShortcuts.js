import { useEffect, useRef, useCallback } from 'react'

/**
 * Global keyboard shortcuts hook.
 *
 * Registers window-level keydown listeners that are suppressed when an
 * input / textarea / select / contenteditable element is focused.
 *
 * Supports single-key shortcuts and two-key chord shortcuts (e.g. g then h).
 * Chord sequences expire after 500 ms.
 *
 * @param {object} config
 * @param {function} [config.onCreateTask]    — fired on `c`
 * @param {function} [config.onCreateProject] — fired on `n`
 * @param {function} [config.onSearch]        — fired on `/`
 * @param {function} [config.onShowHelp]      — fired on `?`
 * @param {function} [config.onSwitchProject] — fired on the `g` `p` chord
 * @param {function} [config.navigate]        — react-router navigate()
 */
export default function useKeyboardShortcuts(config = {}) {
  const configRef = useRef(config)
  configRef.current = config

  const pendingRef = useRef(null)
  const timerRef = useRef(null)

  const clearPending = useCallback(() => {
    pendingRef.current = null
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(() => {
    function handler(e) {
      // Ignore when the user is typing in an interactive element
      const tag = e.target.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        e.target.isContentEditable
      ) {
        return
      }

      // Ignore when any modifier key is held (except Shift for `?`)
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const { onCreateTask, onCreateProject, onSearch, onShowHelp, onSwitchProject, navigate } =
        configRef.current
      const key = e.key

      // ── Chord: second key after `g` ──
      if (pendingRef.current === 'g') {
        clearPending()

        // `g p` opens the project switcher rather than navigating: which
        // project you want is a choice, not a fixed destination (ADR-0067).
        if (key === 'p' && onSwitchProject) {
          e.preventDefault()
          onSwitchProject()
          return
        }

        const chords = {
          h: '/',
          a: '/analytics',
          i: '/identities',
          g: '/goals',
        }

        if (chords[key] && navigate) {
          e.preventDefault()
          navigate(chords[key])
        }
        return
      }

      // ── Start chord ──
      if (key === 'g') {
        pendingRef.current = 'g'
        timerRef.current = setTimeout(clearPending, 500)
        return
      }

      // ── Single-key shortcuts ──
      switch (key) {
        case 'c':
          e.preventDefault()
          onCreateTask?.()
          break
        case 'n':
          e.preventDefault()
          onCreateProject?.()
          break
        case '/':
          e.preventDefault()
          onSearch?.()
          break
        case '?':
          e.preventDefault()
          onShowHelp?.()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      clearTimeout(timerRef.current)
    }
  }, [clearPending])
}
