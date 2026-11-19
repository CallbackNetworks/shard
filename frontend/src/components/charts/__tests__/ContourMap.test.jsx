import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ContourMap, { axes, camera, convexHull, foldFoothills, HOME_CAMERA, MAX_MOUNTAINS, placeMountains, RECENCY_DAYS } from '../ContourMap'

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

describe('convexHull', () => {
  const cube = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1], [0.5, 0.5, 0.5]]
  const faces = convexHull(cube)

  it('wraps the outside in triangles and leaves an inside point out', () => {
    expect(faces).toHaveLength(12)
    expect(faces.flat()).not.toContain(8)
  })

  it('turns every triangle outward, so back faces can be culled', () => {
    for (const [a, b, c] of faces) {
      const [p, q, r] = [cube[a], cube[b], cube[c]]
      const u = q.map((v, i) => v - p[i]), w = r.map((v, i) => v - p[i])
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
      const out = p.map(v => v - 0.5)
      expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(0)
    }
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

  it('draws the same projects as shards or as a contour map, and offers extra views beside them', () => {
    const { container } = render(<ContourMap
      projects={[{ id: 'p1', name: 'Alpha', heat: 5, lastActive: 0, tasks: [task('t1', 'done'), task('t2', 'in_progress')] }]}
      extraViews={[{ key: 'other', label: 'Other', render: () => <p>another view</p> }]}
    />)
    // 3D frosts each shard with flakes on a canvas; the plan draws contour lines.
    const flakes = () => container.querySelectorAll('canvas').length
    expect(flakes()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))
    expect(flakes()).toBe(0)
    expect(screen.getByRole('button', { name: '3D' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Map' }).getAttribute('aria-pressed')).toBe('true')
    // Every task is still on the map in either view.
    expect(container.querySelectorAll('title').length).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Other' }))
    expect(screen.getByText('another view')).toBeTruthy()
  })
})
