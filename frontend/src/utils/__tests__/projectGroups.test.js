/**
 * A project card belongs under exactly one heading (ADR-0094).
 *
 * The dashboard used to be a flat wall of cards. Grouping them means deciding what "whose
 * is this" means when a project is both contained by something and owned by someone — two
 * different relations (ADR-0078). One rule, in one place: containment names the group, and
 * ownership only steps in when nothing contains the project. Anything looser and the same
 * card would appear under two headings, so the dashboard's count would stop matching the
 * project list's.
 */
import { describe, it, expect } from 'vitest'
import { groupProjectsByOwner, ownerOf } from '../projectGroups'

const ref = (id, title, type = 'identity') => ({ id, title, type, type_label: type })
const P = (id) => ({ id, name: id })

describe('groupProjectsByOwner', () => {
  it('groups by the nearest container above the project, and remembers what is above that', () => {
    const groups = groupProjectsByOwner([P('p1'), P('p2')], {
      p1: { trails: [[ref('o1', 'CGCG', 'organization'), ref('i1', 'Pipeline dev')]], owners: [] },
      p2: { trails: [[ref('o1', 'CGCG', 'organization'), ref('i1', 'Pipeline dev')]], owners: [] },
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].owner.title).toBe('Pipeline dev')
    expect(groups[0].above.map(a => a.title)).toEqual(['CGCG'])
    expect(groups[0].projects.map(p => p.id)).toEqual(['p1', 'p2'])
  })

  it('falls back to the owning identity when nothing contains the project', () => {
    const groups = groupProjectsByOwner([P('p1')], {
      p1: { trails: [], owners: [ref('i9', 'Solo creator')] },
    })
    expect(groups[0].owner.title).toBe('Solo creator')
    expect(groups[0].above).toEqual([])
  })

  it('puts every project in exactly one group, unclaimed ones last', () => {
    const groups = groupProjectsByOwner([P('loose'), P('p1')], {
      p1: { trails: [[ref('i1', 'Pipeline dev')]], owners: [] },
    })
    expect(groups.map(g => g.projects.map(p => p.id))).toEqual([['p1'], ['loose']])
    expect(groups[1].owner).toBeNull()
  })

  it('takes the first trail when a project has two parents, so no card is drawn twice', () => {
    const entry = { trails: [[ref('i1', 'First')], [ref('i2', 'Second')]], owners: [] }
    expect(ownerOf(entry).title).toBe('First')
    const groups = groupProjectsByOwner([P('p1')], { p1: entry })
    expect(groups).toHaveLength(1)
  })
})
