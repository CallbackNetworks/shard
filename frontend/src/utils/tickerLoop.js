// A marquee's keyframe translates the track by exactly one loop of its content,
// so two of its numbers have to come from measurement rather than from the
// stylesheet: how fast one loop passes, and how wide one loop has to be.

export const TICKER_MAX_REPEATS = 8

// Reserve a little more than the strip's own width: the fade masks sit over
// both edges and a track can carry padding of its own, so "exactly one
// viewport" still shows the seam arriving.
export const FILL_SAFETY_PX = 48

// Speed. A fixed animation-duration makes px/sec a function of how much
// content there is, so a busy feed reads faster than a quiet one. Deriving the
// duration from the measured loop width pins the pace instead. There is
// deliberately no upper clamp: a ceiling *is* a fixed duration again for every
// feed long enough to reach it, which is how a 200-row activity feed ended up
// scrolling several times faster than the pace it was supposed to hold.
export function loopDuration(loopWidth, pxPerSecond) {
  if (!(loopWidth > 0) || !(pxPerSecond > 0)) return null
  return loopWidth / pxPerSecond
}

// Fill. The track is `width: max-content`, so three short alerts are narrower
// than the strip they scroll in and every pass ends with a visible empty
// stretch. Repeat the items until one loop covers the strip; the pace does not
// change, because the duration is derived from the width.
export function loopRepeats(unitWidth, viewportWidth, current = 1) {
  if (!(unitWidth > 0) || !(viewportWidth > 0)) return current
  const needed = Math.ceil((viewportWidth + FILL_SAFETY_PX) / unitWidth)
  return Math.max(1, Math.min(TICKER_MAX_REPEATS, needed))
}

export function repeatItems(items, repeats) {
  const out = []
  for (let i = 0; i < Math.max(1, repeats); i++) out.push(...items)
  return out
}
