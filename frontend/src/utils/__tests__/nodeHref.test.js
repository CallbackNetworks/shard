import { describe, it, expect } from 'vitest'
import { nodeHref, taskHref, activityHref } from '../nodeHref'

const typeByKey = new Map([
  ['project', { key: 'project', roles: ['container', 'shareable'] }],
  ['identity', { key: 'identity', roles: ['container'] }],
  ['task', { key: 'task', roles: ['task'] }],
  ['bug', { key: 'bug', roles: ['task'] }],
  ['decision', { key: 'decision', roles: [] }],
])

describe('taskHref', () => {
  it('opens a task in its project with the row picked out', () => {
    expect(taskHref({ id: 't1', projectId: 'p1' })).toBe('/projects/p1?focus=t1')
  })

  // The Overview's own shapes disagree on the key: flattenProjectTasks writes
  // projectId, the API writes project_id. Reading only one builds
  // `/projects/undefined?focus=…`, which routes and renders "not found".
  it('accepts either spelling of the project id', () => {
    expect(taskHref({ id: 't1', project_id: 'p1' })).toBe('/projects/p1?focus=t1')
  })

  it('falls back to the node page when no project is known', () => {
    expect(taskHref({ id: 't1' })).toBe('/n/t1')
  })

  it('has no target at all for a task with no id', () => {
    expect(taskHref({ projectId: 'p1' })).toBeNull()
    expect(taskHref(null)).toBeNull()
  })
})

describe('activityHref', () => {
  it('prefers the task the row happened to', () => {
    expect(activityHref({ task_id: 't1', project_id: 'p1', node_type: 'task' }, typeByKey))
      .toBe('/projects/p1?focus=t1')
  })

  // ADR-0090: a type declaring the `task` role is a task everywhere, including here.
  it('treats a task-like custom type as a task', () => {
    expect(activityHref({ task_id: 'b1', project_id: 'p1', node_type: 'bug' }, typeByKey))
      .toBe('/projects/p1?focus=b1')
  })

  it('sends a non-task subject to its own page', () => {
    expect(activityHref({ task_id: 'd1', project_id: 'p1', node_type: 'decision' }, typeByKey))
      .toBe('/n/d1')
  })

  it('falls back to the project when the row names no subject', () => {
    expect(activityHref({ project_id: 'p1' }, typeByKey)).toBe('/projects/p1')
  })

  // A caller must render a plain row here, not a button that goes nowhere.
  it('has no target for a row that names nothing reachable', () => {
    expect(activityHref({ action: 'system.boot' }, typeByKey)).toBeNull()
    expect(activityHref(null, typeByKey)).toBeNull()
  })
})

describe('nodeHref still routes by type and role', () => {
  it('keeps the project page for a project', () => {
    expect(nodeHref({ id: 'p1', type: 'project' }, typeByKey)).toBe('/projects/p1')
  })
  it('sends a container-role type to the container view', () => {
    expect(nodeHref({ id: 'i1', type: 'identity' }, typeByKey)).toBe('/c/i1')
  })
  it('sends everything else to the universal node page', () => {
    expect(nodeHref({ id: 'd1', type: 'decision' }, typeByKey)).toBe('/n/d1')
  })
})
