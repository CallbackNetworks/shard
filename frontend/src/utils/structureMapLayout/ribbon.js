const RIBBON_MAX = 20

function nodeCenterY(node) {
  return node.y + node.h / 2
}

// Allocate stacked vertical slots on each node edge for flow ribbons,
// so ribbons fan out along the node height instead of all meeting at the center.
export function assignSankeySlots(links, nodeById) {
  const outgoing = new Map()
  const incoming = new Map()
  for (const link of links) {
    if (!link.flow) continue
    if (!outgoing.has(link.from)) outgoing.set(link.from, [])
    if (!incoming.has(link.to)) incoming.set(link.to, [])
    outgoing.get(link.from).push(link)
    incoming.get(link.to).push(link)
  }

  for (const [nodeId, group] of outgoing) {
    const node = nodeById.get(nodeId)
    group.sort((a, b) => nodeCenterY(nodeById.get(a.to)) - nodeCenterY(nodeById.get(b.to)))
    const usable = node.h - 8
    const slot = usable / group.length
    group.forEach((link, i) => {
      link.sourceX = node.x + node.w
      link.sourceY = node.y + 4 + (i + 0.5) * slot
      link.sourceW = Math.min(slot - 1.5, RIBBON_MAX)
    })
  }

  for (const [nodeId, group] of incoming) {
    const node = nodeById.get(nodeId)
    group.sort((a, b) => nodeCenterY(nodeById.get(a.from)) - nodeCenterY(nodeById.get(b.from)))
    const usable = node.h - 8
    const slot = usable / group.length
    group.forEach((link, i) => {
      link.targetX = node.x
      link.targetY = node.y + 4 + (i + 0.5) * slot
      link.targetW = Math.min(slot - 1.5, RIBBON_MAX)
    })
  }
}

// A filled, tapered Sankey band between a source node's right edge and a
// target node's left edge (falls back to node centers if slots are unset).
export function ribbonPath(link, from, to) {
  const x0 = link.sourceX ?? from.x + from.w
  const x1 = link.targetX ?? to.x
  const sy = link.sourceY ?? nodeCenterY(from)
  const ty = link.targetY ?? nodeCenterY(to)
  const sw = Math.max(2, link.sourceW ?? 6)
  const tw = Math.max(2, link.targetW ?? 6)
  const cx = (x0 + x1) / 2
  return [
    `M ${x0} ${sy - sw / 2}`,
    `C ${cx} ${sy - sw / 2}, ${cx} ${ty - tw / 2}, ${x1} ${ty - tw / 2}`,
    `L ${x1} ${ty + tw / 2}`,
    `C ${cx} ${ty + tw / 2}, ${cx} ${sy + sw / 2}, ${x0} ${sy + sw / 2}`,
    'Z',
  ].join(' ')
}
