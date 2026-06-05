import { useEffect, useRef } from 'react'

/**
 * Traps focus within a modal/dialog element.
 * Returns a ref to attach to the container element.
 * Pressing Escape calls onClose. Focus is restored on unmount.
 */
export default function useFocusTrap(onClose) {
  const ref = useRef(null)
  const previousFocus = useRef(null)

  useEffect(() => {
    previousFocus.current = document.activeElement
    const el = ref.current
    if (!el) return

    // Focus the first focusable element
    const focusable = el.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (focusable.length > 0) focusable[0].focus()

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
        return
      }
      if (e.key !== 'Tab') return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first) return

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    el.addEventListener('keydown', handleKeyDown)
    return () => {
      el.removeEventListener('keydown', handleKeyDown)
      previousFocus.current?.focus?.()
    }
  }, [onClose])

  return ref
}
