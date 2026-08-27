/**
 * The neighbourhood of one node, laid out.
 *
 * The Node Explorer's relations panel listed each edge as `rel_type → <uuid>`, so the
 * one page whose subject *is* the relation named neither end of it and drew no shape at
 * all. These assertions are about what the drawing claims: that a neighbour reached by
 * two different paths appears once at its shortest hop, that both directions of an edge
 * count as adjacency (a parent is as much a neighbour as a child), and that a
 * neighbourhood cut short says so rather than passing for the whole one.
 */
import { describe, it, expect } from 'vitest'
import { buildEgoNetwork } from '../egoNetwork'

const node = (id, extra = {}) => ({ id, type: 'task', title: id, ...extra })
const edge = (id, source_id, target_id, rel_type = 'contains') => ({ id, source_id, target_id, rel_type })

const slice = {
  nodes: [node('center'), node('parent'), node('child'), node('grandchild'), node('stranger')],
  edges: [
    edge('e1', 'parent', 'center'),
    edge('e2', 'center', 'child'),
    edge('e3', 'child', 'grandchild'),
    edge('e4', 'stranger', 'stranger2'),
  ],
}

const depthOf = (graph, id) => graph.nodes.find(n => n.id === id)?.depth

describe('buildEgoNetwork', () => {
  it('walks edges in both directions — a parent is a neighbour too', () => {
    const graph = buildEgoNetwork(slice, 'center')
    expect(depthOf(graph, 'parent')).toBe(1)
    expect(depthOf(graph, 'child')).toBe(1)
  })

  it('reaches the second hop, which is where a list stops being a shape', () => {
    const graph = buildEgoNetwork(slice, 'center')
    expect(depthOf(graph, 'grandchild')).toBe(2)
  })

  it('leaves out nodes the centre cannot reach', () => {
    const graph = buildEgoNetwork(slice, 'center')
    expect(graph.nodes.map(n => n.id)).not.toContain('stranger')
  })

  it('keeps a node once, at its shortest hop, when two paths reach it', () => {
    const diamond = {
      nodes: [node('center'), node('a'), node('b'), node('shared')],
      edges: [
        edge('e1', 'center', 'a'),
        edge('e2', 'center', 'b'),
        edge('e3', 'a', 'shared'),
        edge('e4', 'b', 'shared'),
        edge('e5', 'center', 'shared'),
      ],
    }
    const graph = buildEgoNetwork(diamond, 'center')
    expect(graph.nodes.filter(n => n.id === 'shared')).toHaveLength(1)
    expect(depthOf(graph, 'shared')).toBe(1)
  })

  it('draws each edge once even though both endpoints are in the neighbourhood', () => {
    const graph = buildEgoNetwork(slice, 'center')
    expect(graph.links.map(l => l.id).sort()).toEqual(['e1', 'e2', 'e3'])
  })

  it('resolves link endpoints to the positions it placed the nodes at', () => {
    const graph = buildEgoNetwork(slice, 'center')
    const link = graph.links.find(l => l.id === 'e2')
    const child = graph.nodes.find(n => n.id === 'child')
    expect([link.x2, link.y2]).toEqual([child.x, child.y])
  })

  it('puts the centre at the origin and everything else off it', () => {
    const graph = buildEgoNetwork(slice, 'center')
    const centre = graph.nodes.find(n => n.id === 'center')
    expect([centre.x, centre.y]).toEqual([0, 0])
    expect(graph.nodes.filter(n => n.id !== 'center').every(n => n.x !== 0 || n.y !== 0)).toBe(true)
  })

  it('says it is partial rather than passing a cut-off neighbourhood for the whole one', () => {
    const wide = {
      nodes: [node('center'), ...Array.from({ length: 10 }, (_, i) => node(`n${i}`))],
      edges: Array.from({ length: 10 }, (_, i) => edge(`e${i}`, 'center', `n${i}`)),
    }
    expect(buildEgoNetwork(wide, 'center', { maxNodes: 4 }).truncated).toBe(true)
    expect(buildEgoNetwork(wide, 'center').truncated).toBe(false)
  })

  it('returns an empty drawing for a centre that is not in the slice', () => {
    expect(buildEgoNetwork(slice, 'nope').nodes).toEqual([])
    expect(buildEgoNetwork(undefined, 'center').nodes).toEqual([])
  })

  it('ignores edges whose other endpoint the slice did not return', () => {
    const dangling = { nodes: [node('center')], edges: [edge('e1', 'center', 'missing')] }
    const graph = buildEgoNetwork(dangling, 'center')
    expect(graph.nodes).toHaveLength(1)
    expect(graph.links).toEqual([])
  })
})
