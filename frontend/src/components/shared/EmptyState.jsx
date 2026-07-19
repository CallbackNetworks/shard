/**
 * Standard empty-state block rendering the shared kt-empty look.
 *
 * `icon` is an optional node (e.g. <Target size={36} className="kt-empty-icon" />),
 * `action` an optional call-to-action rendered below the hint.
 */
export default function EmptyState({ icon, message, hint, action, className }) {
  return (
    <div className={className ? `kt-empty ${className}` : 'kt-empty'}>
      {icon}
      <div className="kt-empty-title">{message}</div>
      {hint && <div className="kt-empty-hint">{hint}</div>}
      {action}
    </div>
  )
}
