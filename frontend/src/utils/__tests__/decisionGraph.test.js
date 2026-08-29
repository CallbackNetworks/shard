import { describe, expect, it } from 'vitest'
import { buildDecisionGraph, decisionDegree } from '../decisionGraph'

const ref = (id, title = id, type = 'decision') => ({ id, type, title })
const dec = (id, extra = {}) => ({ id, name: id, decision_status: 'accepted', project_id: 'p1', ...extra })

describe('decisionDegree', () => {
  it('counts every relation that would put a record on the canvas', () => {
    expect(decisionDegree(dec('a'))).toBe(0)
    expect(decisionDegree(dec('a', { required_by: [ref('b')] }))).toBe(1)
    expect(decisionDegree(dec('a', { governs: [ref('t1', 'Task', 'task')] }))).toBe(1)
  })
})

describe('buildDecisionGraph', () => {
  it('leaves unconnected records off the canvas and counts them', () => {
    // The whole reason a graph mode did not exist before ADR-0127: production held 103
    // records and three non-containment edges, so drawing everything is 98 isolated dots.
    const decisions = [
      dec('a', { requires: [ref('b')] }),
      dec('b', { required_by: [ref('a')] }),
      dec('lonely'),
    ]
    const graph = buildDecisionGraph(decisions)
    expect(graph.nodes.map(n => n.id).sort()).toEqual(['a', 'b'])
    expect(graph.unconnected).toBe(1)

    const all = buildDecisionGraph(decisions, { includeUnconnected: true })
    expect(all.nodes.map(n => n.id).sort()).toEqual(['a', 'b', 'lonely'])
    expect(all.unconnected).toBe(1)
  })

  it('puts what a decision rests on to its left', () => {
    // Position is the answer here: column 0 is the foundations, and following an arrow
    // rightwards is following a premise up to its conclusion.
    const graph = buildDecisionGraph([
      dec('top', { requires: [ref('mid')] }),
      dec('mid', { requires: [ref('base')], required_by: [ref('top')] }),
      dec('base', { required_by: [ref('mid')] }),
    ])
    const x = Object.fromEntries(graph.nodes.map(n => [n.id, n.x]))
    expect(x.base).toBeLessThan(x.mid)
    expect(x.mid).toBeLessThan(x.top)
  })

  it('treats supersession as the same axis as a premise', () => {
    const graph = buildDecisionGraph([
      dec('new', { supersedes: [ref('old')] }),
      dec('old', { decision_status: 'superseded', superseded_by: [ref('new')] }),
    ])
    const x = Object.fromEntries(graph.nodes.map(n => [n.id, n.x]))
    expect(x.old).toBeLessThan(x.new)
  })

  it('draws a symmetric conflict once', () => {
    // The server merges both directions into each record's list, so a naive pass would
    // emit the same undirected edge twice — two arcs bowing opposite ways.
    const graph = buildDecisionGraph([
      dec('a', { conflicts_with: [ref('b')] }),
      dec('b', { conflicts_with: [ref('a')] }),
    ])
    const conflicts = graph.links.filter(l => l.rel === 'conflicts_with')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].symmetric).toBe(true)
  })

  it('puts governed work in its own band, below every decision', () => {
    const graph = buildDecisionGraph([
      dec('a', { governs: [ref('t1', 'Ship it', 'task')] }),
    ])
    const decision = graph.nodes.find(n => n.kind === 'decision')
    const work = graph.nodes.find(n => n.kind === 'work')
    expect(work.name).toBe('Ship it')
    expect(work.y).toBeGreaterThan(decision.y + decision.h)
  })

  it('ignores an endpoint that is not on screen', () => {
    // Same rule as the structure map and the board (ADR-0069, ADR-0094): resolution
    // happens within the visible set, so a filtered-out record cannot anchor an edge.
    const graph = buildDecisionGraph([dec('a', { requires: [ref('gone')] })])
    expect(graph.links.filter(l => l.rel === 'requires')).toHaveLength(0)
  })

  it('does not hang on a cycle written by hand', () => {
    const graph = buildDecisionGraph([
      dec('a', { requires: [ref('b')] }),
      dec('b', { requires: [ref('a')] }),
    ])
    expect(graph.nodes).toHaveLength(2)
  })

  it('is deterministic', () => {
    // A force simulation cannot promise this, and here position carries meaning.
    const rows = [
      dec('top', { requires: [ref('base')], governs: [ref('t1', 'Task', 'task')] }),
      dec('base', { required_by: [ref('top')] }),
    ]
    const a = buildDecisionGraph(rows)
    const b = buildDecisionGraph(rows)
    expect(a.nodes.map(n => [n.id, n.x, n.y])).toEqual(b.nodes.map(n => [n.id, n.x, n.y]))
  })
})
