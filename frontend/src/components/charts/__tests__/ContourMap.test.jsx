import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ContourMap, { axes, buildTile, camera, foldFoothills, footprint, HOME_PLAN, liveliness, HOME_CAMERA, MAX_MOUNTAINS, placeMountains, RECENCY_DAYS } from '../ContourMap'

const task = (id, status) => ({ id, title: id, status })
const W = 720, H = 420

describe('axes', () => {
  const ax = axes(W, H)

  it('puts today at the right and the edge of the window at the left', () => {
    expect(ax.x(0)).toBe(ax.x1)
    expect(ax.x(RECENCY_DAYS)).toBe(ax.x0)
    expect(ax.x(RECENCY_DAYS * 4)).toBe(ax.x0)
    expect(ax.x(null)).toBe(ax.x0)
  })

  it('puts nothing done at the back and everything done at the front', () => {
    expect(ax.y(0)).toBe(ax.y0)
    expect(ax.y(1)).toBe(ax.y1)
  })
})

describe('footprint', () => {
  it('grows with the absolute number of tasks, not with a share of the largest', () => {
    expect(footprint(44)).toBeGreaterThan(footprint(11))
    // Area per task stays the same, so four times the tasks is twice the spread above the floor.
    expect(footprint(44) - footprint(0)).toBeCloseTo(2 * (footprint(11) - footprint(0)), 6)
  })
})

describe('liveliness', () => {
  const now = Date.parse('2026-11-19T12:00:00Z')
  const day = d => new Date(now - d * 86400000).toISOString()

  it('is high for a task that keeps changing and nothing for one never touched', () => {
    expect(liveliness({ recent_updates: 6, updated_at: day(20) }, now)).toBe(1)
    expect(liveliness({ recent_updates: 0, updated_at: null }, now)).toBe(0)
  })

  it('fades with the time since the last change', () => {
    const today = liveliness({ updated_at: day(0) }, now)
    const week = liveliness({ updated_at: day(7) }, now)
    const month = liveliness({ updated_at: day(30) }, now)
    expect(today).toBeGreaterThan(week)
    expect(week).toBeGreaterThan(month)
    expect(month).toBeLessThan(0.08)
  })
})

describe('buildTile', () => {
  // A smooth hilly surface with no project on it.
  const map = { top: 1, surface: (x, y) => [0.5 + 0.4 * Math.sin(x / 70) * Math.cos(y / 55), 0, 0] }
  const edgePoints = (levels, x) => levels.flatMap(lv => lv.strokes.flatMap(st => st.segs.flatMap(([ax, ay, bx, by]) => [[ax, ay], [bx, by]])))
    .filter(([px]) => Math.abs(px - x) < 1e-6).map(([, py]) => py.toFixed(4)).sort()

  it('traces every contour level of the map', () => {
    expect(buildTile(map, 0, 0)).toHaveLength(20)
  })

  it('meets its neighbour at the seam, so contours run across unbroken', () => {
    const left = edgePoints(buildTile(map, 0, 0), 300)
    const right = new Set(edgePoints(buildTile(map, 1, 0), 300))
    expect(left.length).toBeGreaterThan(10)
    // Not every one: the wear drops or slips a few pieces of line on purpose, and a
    // piece lost on one side of the seam has no partner on the other. A broken seam
    // would match almost none.
    const matched = left.filter(y => right.has(y)).length
    expect(matched / left.length).toBeGreaterThan(0.9)
  })
})

describe('camera', () => {
  const ax = axes(W, H)
  const mid = [(ax.x0 + ax.x1) / 2, (ax.y0 + ax.y1) / 2]

  it('draws something nearer the viewer larger than the same thing farther away', () => {
    const cam = camera(W, H, HOME_CAMERA, 1)
    const span = y => cam.project(mid[0] + 50, y, 0)[0] - cam.project(mid[0] - 50, y, 0)[0]
    expect(span(ax.y1)).toBeGreaterThan(span(ax.y0))
  })

  it('turns the ground about its centre: the centre stays put at any heading', () => {
    const a = camera(W, H, HOME_CAMERA, 1).project(...mid, 0)
    const b = camera(W, H, { ...HOME_CAMERA, az: 1.3 }, 1).project(...mid, 0)
    expect(b[0]).toBeCloseTo(a[0]); expect(b[1]).toBeCloseTo(a[1])
  })

  it('lifts height straight up the screen', () => {
    const cam = camera(W, H, HOME_CAMERA, 10)
    const [x0, y0] = cam.project(...mid, 0), [x1, y1] = cam.project(...mid, 2)
    expect(x1).toBeCloseTo(x0)
    expect(y1).toBeLessThan(y0)
  })

  it('finds the ground point under a screen point, at any heading, zoom and pan', () => {
    for (const view of [HOME_CAMERA, { az: 0.7, tilt: 0.6, zoom: 2.4, pan: [40, -25] }]) {
      const cam = camera(W, H, view, 1)
      const [sx, sy] = cam.project(mid[0] + 60, mid[1] - 35, 0)
      const [gx, gy] = cam.toGround(sx, sy)
      expect(gx).toBeCloseTo(mid[0] + 60, 6); expect(gy).toBeCloseTo(mid[1] - 35, 6)
    }
  })

  it('starts high enough that the horizon is above the frame', () => {
    expect(camera(W, H, HOME_CAMERA, 1).horizon).toBeLessThan(0)
  })

  it('zooming in draws the same ground larger', () => {
    const span = zoom => {
      const cam = camera(W, H, { ...HOME_CAMERA, zoom }, 1)
      return cam.project(mid[0] + 50, mid[1], 0)[0] - cam.project(mid[0] - 50, mid[1], 0)[0]
    }
    expect(span(2)).toBeCloseTo(span(1) * 2, 6)
  })

  it('looks straight down without perspective for the plan', () => {
    const cam = camera(W, H, HOME_PLAN, 1)
    const span = y => cam.project(mid[0] + 50, y, 0)[0] - cam.project(mid[0] - 50, y, 0)[0]
    expect(span(ax.y1)).toBeCloseTo(span(ax.y0), 6)
    const [gx, gy] = cam.toGround(...cam.project(mid[0] + 20, mid[1] + 10, 0))
    expect(gx).toBeCloseTo(mid[0] + 20, 6); expect(gy).toBeCloseTo(mid[1] + 10, 6)
  })

  it('orders depth so a turned map still paints its near side last', () => {
    const turned = camera(W, H, { ...HOME_CAMERA, az: Math.PI }, 1)
    // Half a turn: the back edge is now the near one.
    expect(turned.depth(mid[0], ax.y0)).toBeGreaterThan(turned.depth(mid[0], ax.y1))
  })
})

describe('placeMountains', () => {
  const items = [
    { id: 'a', sigma: 30, lastActive: 0, progress: 0.9 },
    { id: 'b', sigma: 25, lastActive: 60, progress: 0.1 },
    { id: 'c', sigma: 20, lastActive: 0, progress: 0.9 },
  ]

  it('places the same input the same way every time', () => {
    expect(placeMountains(items, W, H)).toEqual(placeMountains(items, W, H))
  })

  it('stands a mountain at its reading when nothing crowds it', () => {
    const [, b] = placeMountains(items, W, H)
    const ax = axes(W, H)
    expect(Math.abs(b.x - ax.x(60))).toBeLessThan(2)
    expect(Math.abs(b.y - ax.y(0.1))).toBeLessThan(2)
  })

  it('separates two mountains with the same reading instead of stacking them', () => {
    const [a, , c] = placeMountains(items, W, H)
    expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThan((a.sigma + c.sigma) * 1.1)
  })

  it('keeps every summit on the ground the axes cover', () => {
    const ax = axes(W, H)
    for (const s of placeMountains(items, W, H)) {
      expect(s.x).toBeGreaterThanOrEqual(ax.x0); expect(s.x).toBeLessThanOrEqual(ax.x1)
      expect(s.y).toBeGreaterThanOrEqual(ax.y0); expect(s.y).toBeLessThanOrEqual(ax.y1)
    }
  })
})

describe('foldFoothills', () => {
  const project = (i, open) => ({
    id: `p${i}`, name: `P${i}`, heat: i, lastActive: i,
    tasks: Array.from({ length: open }, (_, k) => task(`p${i}t${k}`, 'todo')),
  })

  it('leaves a small share alone', () => {
    const few = [1, 2, 3].map(i => project(i, i))
    expect(foldFoothills(few)).toBe(few)
  })

  it('keeps the mountains with the most open work and folds the rest into one', () => {
    const many = Array.from({ length: 12 }, (_, i) => project(i, i + 1))
    const out = foldFoothills(many)
    expect(out).toHaveLength(MAX_MOUNTAINS)
    expect(out.slice(0, -1).map(p => p.id)).toEqual(['p11', 'p10', 'p9', 'p8', 'p7', 'p6', 'p5'])
    const rest = out.at(-1)
    expect(rest.name).toBe('+5 other projects')
    // Folded, not dropped: every task the share holds is still on the map.
    expect(out.reduce((n, p) => n + p.tasks.length, 0)).toBe(many.reduce((n, p) => n + p.tasks.length, 0))
    expect(rest.lastActive).toBe(0)
  })
})

describe('ContourMap', () => {
  it('describes each mountain by its open work, its size and its heat', () => {
    render(<ContourMap projects={[
      { id: 'p1', name: 'Alpha', heat: 5, lastActive: 1, tasks: [task('t1', 'done'), task('t2', 'in_progress')] },
      { id: 'p2', name: 'Beta', heat: 0, lastActive: null, tasks: [task('t3', 'todo')] },
    ]} />)
    expect(screen.getByRole('img', { name: 'Alpha: 1 open of 2 tasks, 5 recent updates; Beta: 1 open of 1 tasks, 0 recent updates' })).toBeTruthy()
  })

  it('leaves a project with no tasks off the map', () => {
    render(<ContourMap projects={[{ id: 'p1', name: 'Empty', heat: 3, lastActive: 0, tasks: [] }]} emptyLabel="flat" />)
    expect(screen.getByText('flat')).toBeTruthy()
  })

  it('draws the same terrain in perspective or from above, and offers extra views beside them', () => {
    const { container } = render(<ContourMap
      projects={[{ id: 'p1', name: 'Alpha', heat: 5, lastActive: 0, tasks: [task('t1', 'done'), task('t2', 'in_progress')] }]}
      extraViews={[{ key: 'other', label: 'Other', render: () => <p>another view</p> }]}
    />)
    // Both views draw the same endless terrain on a canvas; only the camera differs.
    expect(container.querySelectorAll('canvas').length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))
    expect(container.querySelectorAll('canvas').length).toBe(1)
    expect(screen.getByRole('button', { name: '3D' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Map' }).getAttribute('aria-pressed')).toBe('true')
    // Every task is still on the map in either view.
    expect(container.querySelectorAll('title').length).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Other' }))
    expect(screen.getByText('another view')).toBeTruthy()
  })
})
