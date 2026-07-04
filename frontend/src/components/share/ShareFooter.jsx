export default function ShareFooter({ generatedAt }) {
  const ts = generatedAt ? new Date(generatedAt).toLocaleString() : ''

  return (
    <div className="kt-share-footer">
      {/* Auto-refresh indicator */}
      <div className="kt-share-live">
        <span />
        <span>
          LIVE · UPDATES EVERY 30S
        </span>
      </div>

      {ts && (
        <span className="kt-share-footer-time">
          Last updated {ts}
        </span>
      )}
    </div>
  )
}
