import { useEffect, useRef, useState } from 'react'
import { loopDuration, loopRepeats, repeatItems } from '../utils/tickerLoop'

// Both strips duplicate their content so the loop is seamless, and both need
// the same two measurements: the exact width of one loop (which sets the
// keyframe's shift and, at a pinned px/sec, its duration) and how many times
// the item list has to repeat before one loop is wider than the strip.
export default function useTickerLoop(items, pxPerSecond) {
  const trackRef = useRef(null)
  const [repeats, setRepeats] = useState(1)
  const [loopWidth, setLoopWidth] = useState(0)
  const contentKey = items.join('|')

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const strip = el.parentElement
    const perLoop = el.children.length / 2
    const measure = () => {
      const first = el.children[0]
      const mid = el.children[perLoop]
      if (!first || !mid) return
      // Measured from the second copy's first item, not as scrollWidth / 2:
      // that splits the track's own padding and one gap across the seam, so
      // the loop lands a few px off and the marquee jumps once per pass.
      const width = mid.offsetLeft - first.offsetLeft
      if (!width) return
      const next = loopRepeats(width / repeats, strip?.clientWidth || 0)
      if (next !== repeats) {
        setRepeats(next)
        return
      }
      setLoopWidth(width)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (strip) ro.observe(strip)
    return () => ro.disconnect()
  }, [contentKey, repeats])

  const unit = repeatItems(items, repeats)
  const duration = loopDuration(loopWidth, pxPerSecond)
  const style = {}
  if (duration) style.animationDuration = `${duration}s`
  if (loopWidth) style['--kt-ticker-shift'] = `${-loopWidth}px`

  return { trackRef, style, loopItems: [...unit, ...unit] }
}
