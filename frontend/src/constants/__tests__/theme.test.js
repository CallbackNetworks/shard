import { describe, it, expect } from 'vitest'
import {
  DARK, BRAND, STATUS_COLS, STATUS_MAP, PRIORITY, LABEL_PALETTE, STATUS_COLOR,
  GOAL_STATUS_COLORS, DECISION_STATUS_COLORS, DELIVERY_STATUS_COLORS, DELIVERY_STATUS_TEXT,
} from '../theme'

describe('theme constants', () => {
  it('DARK has all required color tokens', () => {
    const required = ['bg', 'bgAlt', 'surface', 'elevated', 'text', 'textMid', 'border', 'danger', 'success', 'info']
    for (const key of required) {
      expect(DARK[key]).toBeTruthy()
    }
  })

  it('BRAND is a theme-aware CSS var with a hex fallback', () => {
    expect(BRAND).toMatch(/^var\(--kt-hit, #[0-9a-f]{6}\)$/i)
  })

  it('STATUS_COLS has 4 statuses', () => {
    expect(STATUS_COLS).toHaveLength(4)
    const keys = STATUS_COLS.map(s => s.key)
    expect(keys).toContain('todo')
    expect(keys).toContain('in_progress')
    expect(keys).toContain('done')
    expect(keys).toContain('failed')
  })

  it('STATUS_MAP maps keys correctly', () => {
    expect(STATUS_MAP.done.color).toBe(STATUS_COLOR.done)
    expect(STATUS_MAP.failed.color).toBe(STATUS_COLOR.failed)
    expect(STATUS_MAP.todo.label).toBe('Todo')
  })

  it('PRIORITY has high, medium, low', () => {
    expect(PRIORITY.high.color).toBeTruthy()
    expect(PRIORITY.medium.color).toBeTruthy()
    expect(PRIORITY.low.color).toBeTruthy()
    expect(PRIORITY.high.icon).toBe('▲')
  })

  it('LABEL_PALETTE has 10 colors', () => {
    expect(LABEL_PALETTE).toHaveLength(10)
    for (const c of LABEL_PALETTE) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
  it('GOAL_STATUS_COLORS covers every goal status', () => {
    for (const key of ['active', 'completed', 'cancelled']) {
      expect(GOAL_STATUS_COLORS[key].bg).toBeTruthy()
      expect(GOAL_STATUS_COLORS[key].color).toBeTruthy()
    }
  })

  it('DECISION_STATUS_COLORS covers every decision status', () => {
    for (const key of ['proposed', 'accepted', 'deprecated', 'superseded']) {
      expect(DECISION_STATUS_COLORS[key].border).toBeTruthy()
    }
  })

  it('DELIVERY_STATUS maps cover every delivery status', () => {
    for (const key of ['success', 'failed', 'dead', 'pending']) {
      expect(DELIVERY_STATUS_COLORS[key].dot).toBeTruthy()
      expect(DELIVERY_STATUS_TEXT[key]).toBeTruthy()
    }
    // WebhookLogs renders dead deliveries muted, not failure-red.
    expect(DELIVERY_STATUS_TEXT.dead).toBe('#6b7280')
  })
})
