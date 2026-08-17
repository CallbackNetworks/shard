/**
 * Subtasks stop vanishing (ADR-0094).
 *
 * The board, the timeline and the calendar filtered with `parent_id == null`, so a project
 * that plans under one parent task showed a single card and hid the ten real pieces — six
 * of them already done. These helpers are what replaced that filter, so what they must
 * guarantee is that nothing is dropped: every task in goes out, once.
 */
import { describe, it, expect } from 'vitest'
import { orderTasksByParent, parentIndex } from '../taskTree'

const T = (id, parent_id = null) => ({ id, title: id, parent_id })

describe('orderTasksByParent', () => {
  it('puts each parent immediately above its own children', () => {
    const tasks = [T('a'), T('b'), T('a1', 'a'), T('a2', 'a')]
    expect(orderTasksByParent(tasks).map(r => [r.task.id, r.depth])).toEqual([
      ['a', 0], ['a1', 1], ['a2', 1], ['b', 0],
    ])
  })

  it('promotes a child whose parent the filter removed, rather than hiding it', () => {
    // Same rule as the container forest (ADR-0069): parenting resolves within the
    // visible set, so a filtered-out parent must not take its children with it.
    const rows = orderTasksByParent([T('a1', 'gone'), T('b')])
    expect(rows.map(r => [r.task.id, r.depth])).toEqual([['a1', 0], ['b', 0]])
  })

  it('emits every task exactly once even if the data claims a cycle', () => {
    const rows = orderTasksByParent([T('a', 'b'), T('b', 'a')])
    expect(rows.map(r => r.task.id).sort()).toEqual(['a', 'b'])
  })

  it('nests deeper than one level', () => {
    const rows = orderTasksByParent([T('a'), T('a1', 'a'), T('a1x', 'a1')])
    expect(rows.map(r => r.depth)).toEqual([0, 1, 2])
  })
})

describe('parentIndex', () => {
  it('resolves a parent only when it is on screen', () => {
    const index = parentIndex([T('a'), T('a1', 'a'), T('orphan', 'elsewhere')])
    expect(index.get('a1').id).toBe('a')
    expect(index.get('orphan')).toBeNull()
    expect(index.get('a')).toBeNull()
  })
})
