import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * A node's relations are editable where the node is read (ADR-0155).
 *
 * ADR-0150 collapsed three copies of the relation *picker* into one control, which
 * fixed what the control offered and not where it was. The list stayed hand-written in
 * three places and — the part with no failure symptom — it was mounted only on
 * `/n/{id}`, `/explorer` and a task's membership row. `nodeHref` sends a project to
 * `/projects/{id}` and every other container to `/c/{id}`, and no page linked back, so
 * the type that holds nearly all the work could be attached to an identity from the
 * Data page and nowhere else.
 *
 * Two directions, because either alone passes while the defect is present:
 *   - every page that is the detail view of one node mounts the panel;
 *   - the picker has exactly one consumer, so a fourth hand-written list cannot
 *     quietly reappear beside it.
 */

const SRC = resolve(__dirname, '..')
const read = (rel) => readFileSync(join(SRC, rel), 'utf8')

const NODE_DETAIL_PAGES = [
  'pages/NodePage.jsx',
  'pages/NodeExplorer.jsx',
  'pages/ContainerView.jsx',
  'pages/ProjectDetail.jsx',
  'pages/Identities.jsx',
  'components/MembershipPanel.jsx',
]

describe('a node says what it is attached to, on the page it opens on', () => {
  it.each(NODE_DETAIL_PAGES)('%s mounts the relations panel', (rel) => {
    expect(read(rel)).toMatch(/<NodeRelationsPanel\b/)
  })

  it('the picker has one consumer', () => {
    const consumers = NODE_DETAIL_PAGES
      .concat(['components/NodeRelationsPanel.jsx'])
      .filter(rel => /from '.*shared\/RelationPicker'/.test(read(rel)))
    expect(consumers).toEqual(['components/NodeRelationsPanel.jsx'])
  })
})
