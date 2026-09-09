import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * A path is walked in both directions (ADR-0156).
 *
 * "Where does this node open" had three implementations — `utils/nodeHref.js`,
 * a retired `utils/containerRoute.js` and a hand-written `switch` inside the structure
 * map — and the two copies disagreed with the rule on every type that is not a project:
 * a goal, an identity and a decision each navigated to the *list* page for their kind,
 * so opening one decision out of a hundred landed on all hundred.
 *
 * Nothing failed while that was true. Each copy returned a real route and the browser
 * went there, which is why this is a static scan rather than a behavioural test: the
 * symptom of a fourth copy is not an error, it is arriving somewhere plausible.
 *
 * Both halves of the pairing are asserted, because either alone passes with the defect
 * present — a page can hold no literal and still not link anywhere, and the helper can
 * exist with nobody calling it (the ADR-0122/0132 shape).
 */

const SRC = resolve(__dirname, '..')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      // `api/` holds backend paths, which share the shape and are not routes.
      if (name === '__tests__' || name === 'node_modules' || name === 'api') continue
      walk(full, out)
    } else if (/\.jsx?$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

// Files allowed to name a per-node route literally, each for a reason that is not
// "where does this node open":
//   - `nodeHref.js` is the rule itself; `App.jsx` declares the routes it returns.
//   - `NodePage.jsx` offers the *same* node's container view — one node, two lenses.
//   - `MapInspector.jsx` offers "open node page" beside the subject's own page, as the
//     deliberate raw-node escape hatch, and compares the two so it never draws both.
//   - `ProjectDetail.jsx` falls back to the node page for a `?focus=` id it could not
//     find on the board; sending it through the rule would route it back here.
//   - `NodeRelationsPanel.jsx` has the same fallback for an edge that arrived with an
//     id and no `NodeRef` — the rule needs a type, and there is none to give it.
const ALLOWED = new Set([
  'utils/nodeHref.js',
  'App.jsx',
  'pages/NodePage.jsx',
  'components/structure/MapInspector.jsx',
  'pages/ProjectDetail.jsx',
  'components/NodeRelationsPanel.jsx',
])

// A per-node route: one of the destinations `nodeHref` owns, built from an expression.
const PER_NODE_ROUTE = /['"`]\/(?:n|c|projects)\/\$\{/

describe('one rule decides where a node opens', () => {
  it('no component builds a per-node route of its own', () => {
    const offenders = walk(SRC)
      .map(full => [relative(SRC, full), readFileSync(full, 'utf8')])
      .filter(([rel]) => !ALLOWED.has(rel))
      .filter(([, src]) => PER_NODE_ROUTE.test(src))
      .map(([rel]) => rel)

    expect(offenders).toEqual([])
  })

  it('the rule is what the surfaces that navigate to a node actually call', () => {
    // The reverse direction. A helper nobody calls is the failure mode this project
    // has shipped twice; naming the callers is what makes the first assertion mean
    // "they all go through the rule" rather than "nobody navigates anywhere".
    const callers = [
      'pages/StructureMap.jsx',
      'pages/NodeExplorer.jsx',
      'components/ChildContainersPanel.jsx',
      'components/shared/AncestryTrail.jsx',
      'components/NodeRelationsPanel.jsx',
      'components/decisions/DecisionGroup.jsx',
      'components/decisions/DecisionCard.jsx',
      'components/decisions/GovernPicker.jsx',
      'pages/TypeNodesPage.jsx',
      'pages/Goals.jsx',
      'pages/Dashboard.jsx',
      'components/CommandPalette.jsx',
      'components/GoverningDecisions.jsx',
      'components/dashboard/ProjectCard.jsx',
    ]
    for (const rel of callers) {
      expect(readFileSync(join(SRC, rel), 'utf8')).toMatch(/\bnodeHref\s*\(/)
    }
  })
})
