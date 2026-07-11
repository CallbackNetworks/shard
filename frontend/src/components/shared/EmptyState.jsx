export default function EmptyState({ message, hint, icon }) {
  return (
    <div style={{
      textAlign: 'center',
      padding: '48px 24px',
      color: 'rgba(var(--kt-ink-rgb), 0.3)',
    }}>
      {icon && <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>{icon}</div>}
      <div style={{ fontSize: 13, marginBottom: hint ? 6 : 0 }}>{message}</div>
      {hint && <div style={{ fontSize: 11, color: 'rgba(var(--kt-ink-rgb), 0.2)' }}>{hint}</div>}
    </div>
  )
}
