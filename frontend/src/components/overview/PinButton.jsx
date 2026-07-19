import s from './PinButton.module.css'

/** Star toggle pinning a project to the top of the overview lists. */
export default function PinButton({ projectId, pinned, onToggle }) {
  const isPinned = pinned.includes(projectId)
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(projectId) }}
      title={isPinned ? 'Unpin' : 'Pin to top'}
      className={isPinned ? `${s.btn} ${s.btnPinned}` : s.btn}
    >
      {isPinned ? '★' : '☆'}
    </button>
  )
}
