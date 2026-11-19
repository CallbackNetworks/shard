import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ContourMap, { placeMountains } from '../ContourMap'

const task = (id, status) => ({ id, title: id, status })

describe('placeMountains', () => {
  const items = [
    { id: 'a', sigma: 40 }, { id: 'b', sigma: 30 }, { id: 'c', sigma: 25 }, { id: 'd', sigma: 20 },
  ]

  it('places the same input the same way every time', () => {
    expect(placeMountains(items, 720, 420)).toEqual(placeMountains(items, 720, 420))
  })

  it('keeps every pair of summits apart, so a saddle can form between them', () => {
    const spots = placeMountains(items, 720, 420)
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const d = Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y)
        expect(d).toBeGreaterThanOrEqual((spots[i].sigma + spots[j].sigma) * 1.5)
      }
    }
  })

  it('fits the range inside the frame', () => {
    for (const s of placeMountains(items, 720, 420)) {
      expect(s.x).toBeGreaterThan(0); expect(s.x).toBeLessThan(720)
      expect(s.y).toBeGreaterThan(0); expect(s.y).toBeLessThan(420)
    }
  })
})

describe('ContourMap', () => {
  it('describes each mountain by its size and its heat', () => {
    render(<ContourMap projects={[
      { id: 'p1', name: 'Alpha', heat: 5, tasks: [task('t1', 'done'), task('t2', 'in_progress')] },
      { id: 'p2', name: 'Beta', heat: 0, tasks: [task('t3', 'todo')] },
    ]} />)
    expect(screen.getByRole('img', { name: 'Alpha: 2 tasks, 5 recent updates; Beta: 1 tasks, 0 recent updates' })).toBeTruthy()
  })

  it('leaves a project with no tasks off the map', () => {
    render(<ContourMap projects={[{ id: 'p1', name: 'Empty', heat: 3, tasks: [] }]} emptyLabel="flat" />)
    expect(screen.getByText('flat')).toBeTruthy()
  })
})
