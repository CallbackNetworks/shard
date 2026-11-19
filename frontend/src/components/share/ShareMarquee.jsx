import useTickerLoop from '../../hooks/useTickerLoop'
import { relativeTime } from './utils'

const PX_PER_SECOND = 48
const MAX_ITEMS = 10
const FALLBACK = [{ when: null, text: 'SHARED STATUS' }]

// The newest activity, scrolling across the top of the page. Every share state
// renders it (loading, error and the PIN gate included), and those have no
// activity to show, so they get the bar's old fixed text instead.
export default function ShareMarquee({ activity = [] }) {
  const entries = activity
    .filter(a => a.action !== 'share.viewed')
    .slice(0, MAX_ITEMS)
    .map(a => ({ when: relativeTime(a.created_at), text: a.detail || a.action.replaceAll('.', ' ') }))
  const items = entries.length > 0 ? entries : FALLBACK
  // The hook keys its measurement on string content, so each item is flattened once.
  const labels = items.map(i => `${i.when || ''}\u0000${i.text}`)
  const loop = useTickerLoop(labels, PX_PER_SECOND)

  return (
    <div className="kt-share-marquee" aria-label="Latest updates">
      <div className="kt-share-marquee-track" ref={loop.trackRef} style={loop.style}>
        {loop.loopItems.map((label, i) => {
          const [when, text] = label.split('\u0000')
          return (
            <span key={i} aria-hidden={i >= labels.length || undefined}>
              {when && <b>{when}</b>}
              {text}
            </span>
          )
        })}
      </div>
    </div>
  )
}
