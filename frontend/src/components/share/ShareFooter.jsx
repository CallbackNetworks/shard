import { DIM } from '../OverviewViews'

export default function ShareFooter({ generatedAt }) {
  const ts = generatedAt ? new Date(generatedAt).toLocaleString() : ''

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: '32px 0 48px',
      flexWrap: 'wrap',
    }}>
      {/* Auto-refresh indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#1ed760',
          animation: 'refreshPulse 3s ease-in-out infinite',
        }} />
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', letterSpacing: '0.1em' }}>
          LIVE · UPDATES EVERY 30S
        </span>
      </div>

      {ts && (
        <span style={{
          fontSize: 10, color: 'rgba(255,255,255,0.1)',
          letterSpacing: '0.06em',
        }}>
          Last updated {ts}
        </span>
      )}
    </div>
  )
}
