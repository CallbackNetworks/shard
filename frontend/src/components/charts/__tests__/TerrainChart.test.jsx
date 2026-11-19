import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import TerrainChart, { weeklyTerrain } from '../TerrainChart'

const NOW = new Date('2026-11-19T12:00:00')

describe('weeklyTerrain', () => {
  it('buckets days into weeks, oldest first, and drops what is out of range', () => {
    const { rows } = weeklyTerrain([{ id: 'a', name: 'A', days: [
      { date: '2026-11-19', count: 2 },
      { date: '2026-11-10', count: 3 },
      { date: '2025-01-01', count: 9 },
    ] }], 4, NOW)
    expect(rows[0].raw).toEqual([0, 0, 3, 2])
    expect(rows[0].total).toBe(5)
  })

  it('scales every ridge against one peak, so heights compare across projects', () => {
    const { rows, peak } = weeklyTerrain([
      { id: 'a', name: 'A', days: [{ date: '2026-11-19', count: 8 }] },
      { id: 'b', name: 'B', days: [{ date: '2026-11-19', count: 2 }] },
    ], 4, NOW)
    expect(peak).toBe(Math.max(...rows[0].smooth))
  })
})

describe('TerrainChart', () => {
  it('names each ridge with its total', () => {
    render(<TerrainChart series={[{ id: 'a', name: 'Alpha', days: [{ date: new Date().toISOString().slice(0, 10), count: 4 }] }]} />)
    expect(screen.getByRole('img', { name: 'Alpha: 4' })).toBeTruthy()
  })

  it('says so when there is nothing to draw', () => {
    render(<TerrainChart series={[{ id: 'a', name: 'Alpha', days: [] }]} emptyLabel="quiet" />)
    expect(screen.getByText('quiet')).toBeTruthy()
  })
})
