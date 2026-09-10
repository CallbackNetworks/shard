/**
 * A decision's state goes on the node's `status` column, not in its `data` (ADR-0130).
 *
 * The app's own vocabulary for it is `decision_status` — that is what every read returns
 * and what every component and test is written against — so the translation happens once,
 * here in the client, rather than at each call site. The reason it must not leak back into
 * `data` is the reason ADR-0130 exists: sent that way it used to be accepted as an inert
 * key while the column every decision surface reads stayed empty. It is a 422 now, so a
 * regression here is a broken write rather than a silent one, but the point of the test is
 * that the shape is decided in one place and can be read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const post = vi.fn(() => Promise.resolve({ data: {} }))
const patch = vi.fn(() => Promise.resolve({ data: {} }))
vi.mock('axios', () => {
  const instance = {
    post, patch,
    get: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  }
  return { default: { create: () => instance, get: vi.fn(), post: vi.fn() } }
})

const { createDecision, updateDecision } = await import('../client')

beforeEach(() => { post.mockClear(); patch.mockClear() })

describe('decision writes', () => {
  it('creates with the state on the column and the rest in data', async () => {
    await createDecision('proj-1', {
      name: 'Adopt the graph model',
      decision_status: 'accepted',
      description: 'why',
      color: '#818cf8',
    })

    const [url, body] = post.mock.calls[0]
    expect(url).toBe('/nodes')
    expect(body).toEqual({
      type: 'decision',
      container_id: 'proj-1',
      title: 'Adopt the graph model',
      status: 'accepted',
      data: { description: 'why', color: '#818cf8' },
    })
    expect(body.data).not.toHaveProperty('decision_status')
  })

  it('updates the status as a column, with no data bag at all', async () => {
    await updateDecision('d-1', { decision_status: 'deprecated' })

    expect(patch.mock.calls[0]).toEqual(['/nodes/d-1', { status: 'deprecated' }])
  })

  it('still routes everything else into data', async () => {
    await updateDecision('d-1', { name: 'Renamed', description: 'new body' })

    expect(patch.mock.calls[0][1]).toEqual({ title: 'Renamed', data: { description: 'new body' } })
  })
})

/**
 * The other half, and the one that was missing (ADR-0157): a *read*.
 *
 * `client.js` translates the column back into `decision_status` on the way out, so every
 * consumer that goes through the API layer is correct by construction. `graphStructure.js`
 * does not — it derives the structure map straight from the raw `/graph/map` slice — and it
 * read `n.data?.decision_status`, which ADR-0130 emptied. Result: every decision on the map
 * reported `proposed`, including the settled ones ADR-0128 added the map's decision rule for.
 *
 * The write guard above could never have caught it, and neither could a fixture, because the
 * fixture wrote the field the code read. So this asks the question of the source instead.
 */
describe('nothing reads a decision state out of the data bag', () => {
  const SRC = resolve(__dirname, '../..')
  const walk = (dir) => readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full)
    return /\.jsx?$/.test(full) ? [full] : []
  })

  // `data.decision_status`, `data?.decision_status`, `data['decision_status']`.
  const FROM_DATA = /data\s*\??\s*(\.\s*decision_status|\[\s*['"`]decision_status)/

  it.each(walk(SRC).map(f => relative(SRC, f).replaceAll('\\', '/')))(
    '%s reads it from the status column',
    (rel) => {
      const source = readFileSync(join(SRC, rel), 'utf8')
      expect(
        FROM_DATA.test(source),
        `${rel} reads decision_status out of a node's data — it lives on the status column (ADR-0130)`,
      ).toBe(false)
    }
  )
})
