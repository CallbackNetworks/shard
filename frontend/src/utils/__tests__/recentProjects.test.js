import { describe, it, expect, beforeEach } from 'vitest'
import { getRecentProjectIds, touchProject, forgetProject, orderByRecent } from '../recentProjects'

// The store is a module singleton, so each test starts from a known front.
beforeEach(() => {
  getRecentProjectIds().slice().forEach(forgetProject)
})

describe('recentProjects', () => {
  it('puts the most recently touched project first', () => {
    touchProject('a')
    touchProject('b')
    expect(getRecentProjectIds()).toEqual(['b', 'a'])
  })

  it('moves a revisited project to the front instead of duplicating it', () => {
    touchProject('a')
    touchProject('b')
    touchProject('a')
    expect(getRecentProjectIds()).toEqual(['a', 'b'])
  })

  // Called on every render of a project page, so it must be free to repeat.
  it('is idempotent when the project is already at the front', () => {
    touchProject('a')
    const before = getRecentProjectIds()
    touchProject('a')
    expect(getRecentProjectIds()).toBe(before)
  })

  it('ignores a missing id', () => {
    touchProject('a')
    touchProject(undefined)
    expect(getRecentProjectIds()).toEqual(['a'])
  })

  it('keeps at most eight projects', () => {
    for (let i = 0; i < 12; i++) touchProject(`p${i}`)
    const ids = getRecentProjectIds()
    expect(ids.length).toBe(8)
    expect(ids[0]).toBe('p11')
    expect(ids).not.toContain('p0')
  })

  it('survives a round trip through localStorage', () => {
    touchProject('a')
    expect(JSON.parse(localStorage.getItem('recent_projects'))).toEqual(['a'])
  })
})

describe('orderByRecent', () => {
  const projects = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ]

  it('splits visited from unvisited and orders visited by recency', () => {
    const { recent, rest } = orderByRecent(projects, ['c', 'a'])
    expect(recent.map(p => p.id)).toEqual(['c', 'a'])
    expect(rest.map(p => p.id)).toEqual(['b'])
  })

  it('leaves unvisited projects in their original order', () => {
    const { rest } = orderByRecent(projects, [])
    expect(rest.map(p => p.id)).toEqual(['a', 'b', 'c'])
  })

  // A remembered project that was deleted, archived away or filtered out by an
  // identity focus must not resurrect itself as an entry.
  it('drops remembered ids that are not in the given list', () => {
    const { recent, rest } = orderByRecent([{ id: 'a', name: 'A' }], ['gone', 'a'])
    expect(recent.map(p => p.id)).toEqual(['a'])
    expect(rest).toEqual([])
  })
})
