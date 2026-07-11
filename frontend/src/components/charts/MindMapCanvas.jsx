import { useState, useRef, useCallback, useEffect } from 'react'

const NODE_W = 160
const NODE_H = 36
const H_GAP = 40
const V_GAP = 12
const LABEL_TRUNC = 20

function layoutTree(node, depth = 0, y = 0) {
  const result = []
  const x = depth * (NODE_W + H_GAP)
  const children = node.children || []

  if (children.length === 0) {
    result.push({ ...node, x, y, depth })
    return { nodes: result, height: NODE_H }
  }

  let childY = y
  const childResults = []
  let totalH = 0

  for (const child of children) {
    const sub = layoutTree(child, depth + 1, childY)
    childResults.push(sub)
    childY += sub.height + V_GAP
    totalH += sub.height + V_GAP
  }
  totalH -= V_GAP

  const nodeY = y + totalH / 2 - NODE_H / 2
  result.push({ ...node, x, y: nodeY, depth })

  for (const sub of childResults) {
    result.push(...sub.nodes)
  }

  return { nodes: result, height: totalH }
}

function layoutForest(trees) {
  const allNodes = []
  let y = 0
  for (const tree of trees) {
    const { nodes, height } = layoutTree(tree, 0, y)
    allNodes.push(...nodes)
    y += height + V_GAP * 3
  }
  return allNodes
}

export default function MindMapCanvas({ trees = [], onNodeClick }) {
  const svgRef = useRef(null)
  const [transform, setTransform] = useState({ x: 40, y: 40, scale: 1 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [hoverNode, setHoverNode] = useState(null)

  const nodes = layoutForest(trees)

  const edges = []
  const nodeMap = {}
  for (const n of nodes) nodeMap[n.id] = n
  for (const n of nodes) {
    for (const child of (n.children || [])) {
      const target = nodeMap[child.id]
      if (target) {
        edges.push({ from: n, to: target })
      }
    }
  }

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setTransform(prev => ({
      ...prev,
      scale: Math.max(0.2, Math.min(3, prev.scale * delta)),
    }))
  }, [])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const handleMouseDown = (e) => {
    if (e.target.closest('[data-node]')) return
    setDragging(true)
    setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y })
  }

  const handleMouseMove = (e) => {
    if (!dragging) return
    setTransform(prev => ({
      ...prev,
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    }))
  }

  const handleMouseUp = () => setDragging(false)

  return (
    <div style={{ position: 'relative', width: '100%', height: 420, overflow: 'hidden', borderRadius: 8 }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ cursor: dragging ? 'grabbing' : 'grab', background: 'rgba(var(--kt-ink-rgb), 0.015)' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
          {edges.map((edge, i) => {
            const x1 = edge.from.x + NODE_W
            const y1 = edge.from.y + NODE_H / 2
            const x2 = edge.to.x
            const y2 = edge.to.y + NODE_H / 2
            const midX = (x1 + x2) / 2
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="rgba(var(--kt-ink-rgb), 0.12)"
                strokeWidth={1.5}
              />
            )
          })}

          {nodes.map((node) => {
            const isHover = hoverNode === node.id
            const fillColor = node.color || '#9ca3af'
            const bgOpacity = node.depth === 0 ? 0.2 : node.depth === 1 ? 0.12 : 0.08
            return (
              <g
                key={node.id}
                data-node="true"
                style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
                onClick={() => onNodeClick?.(node)}
                onMouseEnter={() => setHoverNode(node.id)}
                onMouseLeave={() => setHoverNode(null)}
              >
                <rect
                  x={node.x} y={node.y}
                  width={NODE_W} height={NODE_H}
                  rx={8}
                  fill={isHover ? fillColor + '33' : fillColor + Math.round(bgOpacity * 255).toString(16).padStart(2, '0')}
                  stroke={isHover ? fillColor : 'rgba(var(--kt-ink-rgb), 0.08)'}
                  strokeWidth={isHover ? 1.5 : 0.5}
                />
                {node.depth === 0 && (
                  <rect
                    x={node.x} y={node.y}
                    width={4} height={NODE_H}
                    rx={2}
                    fill={fillColor}
                  />
                )}
                <text
                  x={node.x + (node.depth === 0 ? 14 : 10)}
                  y={node.y + NODE_H / 2 + 1}
                  dominantBaseline="middle"
                  fontSize={node.depth === 0 ? 12 : 11}
                  fontWeight={node.depth === 0 ? 700 : 400}
                  fill={node.depth === 0 ? 'var(--kt-ink)' : 'rgba(var(--kt-ink-rgb), 0.7)'}
                  fontFamily="system-ui"
                >
                  {node.label.length > LABEL_TRUNC ? node.label.slice(0, LABEL_TRUNC - 1) + '…' : node.label}
                </text>
                {node.badge != null && (
                  <g>
                    <rect
                      x={node.x + NODE_W - 30} y={node.y + 8}
                      width={22} height={16} rx={8}
                      fill={fillColor + '33'}
                    />
                    <text
                      x={node.x + NODE_W - 19} y={node.y + 19}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={9} fontWeight={700} fill={fillColor}
                      fontFamily="system-ui"
                    >
                      {node.badge}
                    </text>
                  </g>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      <div style={{
        position: 'absolute', bottom: 8, right: 8,
        display: 'flex', gap: 4,
      }}>
        <button
          onClick={() => setTransform(prev => ({ ...prev, scale: Math.min(3, prev.scale * 1.2) }))}
          style={zoomBtnStyle}
        >+</button>
        <button
          onClick={() => setTransform(prev => ({ ...prev, scale: Math.max(0.2, prev.scale * 0.8) }))}
          style={zoomBtnStyle}
        >-</button>
        <button
          onClick={() => setTransform({ x: 40, y: 40, scale: 1 })}
          style={zoomBtnStyle}
        >Reset</button>
      </div>
    </div>
  )
}

const zoomBtnStyle = {
  background: 'rgba(var(--kt-ink-rgb), 0.08)',
  border: '1px solid rgba(var(--kt-ink-rgb), 0.12)',
  color: 'rgba(var(--kt-ink-rgb), 0.6)',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'system-ui',
}
