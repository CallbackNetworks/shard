import { WifiOff, RefreshCw } from 'lucide-react'
import { DARK } from '../constants/theme'
import useOfflineSync from '../hooks/useOfflineSync'

export default function OfflineIndicator() {
  const { isOnline, pendingCount, syncing, syncPending } = useOfflineSync()

  if (isOnline && pendingCount === 0) return null

  return (
    <div className="kt-offline-indicator" style={{
      position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 310,
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 16px', borderRadius: 0,
      background: isOnline ? DARK.elevated : 'rgba(250,204,21,0.15)',
      border: `1px solid ${isOnline ? 'rgba(255,255,255,0.1)' : 'rgba(250,204,21,0.32)'}`,
      color: isOnline ? DARK.text : DARK.success,
      fontSize: 12, fontWeight: 600,
      boxShadow: '6px 6px 0 rgba(0,0,0,0.35)',
    }}>
      {!isOnline && (
        <>
          <WifiOff size={14} />
          <span>Offline</span>
        </>
      )}
      {pendingCount > 0 && (
        <span style={{ color: DARK.warning }}>
          {pendingCount} pending {pendingCount === 1 ? 'change' : 'changes'}
        </span>
      )}
      {isOnline && pendingCount > 0 && (
        <button
          onClick={syncPending}
          disabled={syncing}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: DARK.info, display: 'flex', alignItems: 'center', gap: 3,
            fontSize: 11, padding: 0,
          }}
        >
          <RefreshCw size={12} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
          {syncing ? 'Syncing...' : 'Sync now'}
        </button>
      )}
    </div>
  )
}
