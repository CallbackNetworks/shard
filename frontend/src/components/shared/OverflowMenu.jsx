import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { MoreHorizontal } from 'lucide-react'
import s from './OverflowMenu.module.css'

/**
 * The secondary half of an action row, behind one `⋯`.
 *
 * A decision card carried seven controls, of which two — accept and reject — had a
 * label and a border and five were 13px `--kt-faint` glyphs with neither. Five icons
 * side by side do not read as five actions; they read as decoration, which is why the
 * card looked like it had no actions at all beyond the two labelled ones. The fix is
 * not more colour on the glyphs: it is saying which actions are primary (they keep a
 * label) and putting the rest where a name can be spelled out.
 *
 * Items are `{ key, label, icon, onClick | href, danger }`. `href` renders a router
 * `Link` so navigation stays a real anchor — middle-click and copy-link keep working,
 * which a button-with-navigate quietly breaks.
 */
export default function OverflowMenu({ items = [], label }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState(null)
  const rootRef = useRef(null)
  const menuRef = useRef(null)
  const triggerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    // The menu is portalled out of `rootRef`, so it has to be asked separately whether
    // the click was inside it — testing the root alone closes the menu on `mousedown`
    // and the item's own `click` then lands on a node that is no longer there.
    const onDown = (e) => {
      const inside = rootRef.current?.contains(e.target) || menuRef.current?.contains(e.target)
      if (!inside) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Portalled to the body and positioned from the trigger's rect. Two ancestors make
  // any in-place popover wrong here: the column is an `overflow: hidden` panel, which
  // clipped an absolute menu to whatever fit below the card (one item of four), and the
  // card's own entrance animation leaves a `transform` behind, which makes it the
  // containing block for `position: fixed` — so even fixed coordinates landed 400px off.
  const place = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const below = window.innerHeight - rect.bottom
    setBox({
      right: Math.max(8, window.innerWidth - rect.right),
      ...(below < 180
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    })
  }

  const visible = items.filter(Boolean)
  if (visible.length === 0) return null

  return (
    <div ref={rootRef} className={s.root}>
      <button
        ref={triggerRef}
        type="button"
        className={s.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label || t('more')}
        title={label || t('more')}
        onClick={() => { if (!open) place(); setOpen(v => !v) }}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" className={s.menu} style={box || undefined}>
          {visible.map(item => {
            const cls = `${s.item} ${item.danger ? s.danger : ''}`
            const body = <>{item.icon}<span>{item.label}</span></>
            return item.href ? (
              <Link key={item.key} role="menuitem" to={item.href} className={cls} onClick={() => setOpen(false)}>
                {body}
              </Link>
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={cls}
                onClick={() => { setOpen(false); item.onClick?.() }}
              >
                {body}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
