import { describe, expect, it } from 'vitest'
import { buildContainerForest, flattenContainerForest } from '../containerTree'

const c = (id, parentContainerId = null) => ({ id, name: id, parentContainerId })

describe('buildContainerForest', () => {
  it('roots the containers with no parent and hangs the rest under theirs', () => {
    const forest = buildContainerForest([c('top'), c('mid', 'top'), c('leaf', 'mid'), c('other')])
    expect(forest.roots.map(n => n.id)).toEqual(['top', 'other'])
    expect(forest.childrenOf('top').map(n => n.id)).toEqual(['mid'])
    expect(forest.childrenOf('mid').map(n => n.id)).toEqual(['leaf'])
    expect(forest.depthOf('leaf')).toBe(2)
    expect(forest.parentOf('leaf')).toBe('mid')
    expect(forest.parentOf('top')).toBe(null)
  })

  it('promotes a container whose parent is filtered out of the visible set', () => {
    // Search/risk filters hide nodes; a child must not disappear with its parent.
    const forest = buildContainerForest([c('mid', 'hidden-parent'), c('leaf', 'mid')])
    expect(forest.roots.map(n => n.id)).toEqual(['mid'])
    expect(forest.childrenOf('mid').map(n => n.id)).toEqual(['leaf'])
  })

  it('draws every container exactly once even if the data describes a cycle', () => {
    // The backend rejects containment cycles; a partial slice must still render.
    const forest = buildContainerForest([c('a', 'b'), c('b', 'a')])
    const flat = flattenContainerForest(forest)
    expect(flat.map(item => item.container.id).sort()).toEqual(['a', 'b'])
    expect(new Set(flat.map(item => item.container.id)).size).toBe(2)
  })

  it('ignores a container that claims itself as its parent', () => {
    const forest = buildContainerForest([c('self', 'self')])
    expect(forest.roots.map(n => n.id)).toEqual(['self'])
    expect(forest.childrenOf('self')).toEqual([])
  })
})

describe('flattenContainerForest', () => {
  it('emits each root immediately followed by its own subtree, with depths', () => {
    const forest = buildContainerForest([c('a'), c('a1', 'a'), c('a1x', 'a1'), c('b'), c('b1', 'b')])
    expect(flattenContainerForest(forest).map(item => [item.container.id, item.depth])).toEqual([
      ['a', 0], ['a1', 1], ['a1x', 2], ['b', 0], ['b1', 1],
    ])
  })
})
