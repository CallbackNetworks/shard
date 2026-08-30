import { describe, it, expect } from 'vitest'
import { loopDuration, loopRepeats, repeatItems, TICKER_MAX_REPEATS } from '../tickerLoop'

const PX_PER_SECOND = 55

describe('marquee pace', () => {
  it('holds the same px/sec however long the feed is', () => {
    const quiet = loopDuration(1200, PX_PER_SECOND)
    const busy = loopDuration(60000, PX_PER_SECOND)
    // The regression this pins: a maximum duration is a fixed duration again
    // for every feed long enough to reach it, so a busy feed scrolled past
    // several times faster than a quiet one.
    expect(1200 / quiet).toBeCloseTo(PX_PER_SECOND)
    expect(60000 / busy).toBeCloseTo(PX_PER_SECOND)
  })

  it('reports no duration until the track has been measured', () => {
    expect(loopDuration(0, PX_PER_SECOND)).toBeNull()
    expect(loopDuration(1200, 0)).toBeNull()
  })
})

describe('marquee fill', () => {
  it('repeats a short feed until one loop covers the strip', () => {
    const unit = 300 // three alerts
    const viewport = 1400
    const repeats = loopRepeats(unit, viewport)
    expect(unit * repeats).toBeGreaterThanOrEqual(viewport)
  })

  it('leaves a feed that already fills the strip alone', () => {
    expect(loopRepeats(4000, 1400)).toBe(1)
  })

  it('settles: measuring again with the same widths asks for the same count', () => {
    const unit = 300
    const viewport = 1400
    const first = loopRepeats(unit, viewport)
    expect(loopRepeats((unit * first) / first, viewport)).toBe(first)
  })

  it('never repeats without bound, and keeps the current count while unmeasured', () => {
    expect(loopRepeats(1, 100000)).toBe(TICKER_MAX_REPEATS)
    expect(loopRepeats(0, 1400, 3)).toBe(3)
  })
})

describe('repeatItems', () => {
  it('lays the list out end to end', () => {
    expect(repeatItems(['a', 'b'], 3)).toEqual(['a', 'b', 'a', 'b', 'a', 'b'])
  })

  it('never collapses to nothing', () => {
    expect(repeatItems(['a'], 0)).toEqual(['a'])
  })
})
