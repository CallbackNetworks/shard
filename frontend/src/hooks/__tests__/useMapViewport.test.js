import { renderHook, act } from '@testing-library/react'
import useMapViewport from '../useMapViewport'

function makeFrame() {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientWidth', { value: 500 })
  Object.defineProperty(el, 'clientHeight', { value: 400 })
  return el
}

function pointerEvent(el, pointerId, clientX, clientY) {
  return {
    pointerId,
    clientX,
    clientY,
    button: 0,
    currentTarget: el,
    target: el,
    preventDefault: () => {},
  }
}

function setup() {
  const hook = renderHook(() => useMapViewport({ width: 1000, height: 800 }))
  const el = makeFrame()
  act(() => hook.result.current.graphRef(el))
  return { hook, el }
}

describe('useMapViewport', () => {
  it('pans with a single pointer', () => {
    const { hook, el } = setup()
    const before = hook.result.current.transform
    act(() => hook.result.current.startPan(pointerEvent(el, 1, 100, 100)))
    act(() => hook.result.current.movePan(pointerEvent(el, 1, 140, 70)))
    const after = hook.result.current.transform
    expect(after.x - before.x).toBeCloseTo(40)
    expect(after.y - before.y).toBeCloseTo(-30)
    expect(after.scale).toBeCloseTo(before.scale)
  })

  it('zooms with a two-finger pinch, clamped to the zoom range', () => {
    const { hook, el } = setup()
    const before = hook.result.current.transform
    act(() => hook.result.current.startPan(pointerEvent(el, 1, 100, 100)))
    act(() => hook.result.current.startPan(pointerEvent(el, 2, 200, 100)))
    // Spread fingers to double the distance -> 2x zoom.
    act(() => hook.result.current.movePan(pointerEvent(el, 2, 300, 100)))
    expect(hook.result.current.transform.scale).toBeCloseTo(before.scale * 2)
    // Spreading far beyond the limit clamps at ZOOM_MAX (2.4).
    act(() => hook.result.current.movePan(pointerEvent(el, 2, 900, 100)))
    expect(hook.result.current.transform.scale).toBeCloseTo(before.scale * 2.4)
  })

  it('keeps the canvas point under the pinch midpoint stationary', () => {
    const { hook, el } = setup()
    const before = hook.result.current.transform
    // Midpoint at (150, 100) in frame coordinates (rect is at 0,0 in jsdom).
    const canvasX = (150 - before.x) / before.scale
    const canvasY = (100 - before.y) / before.scale
    act(() => hook.result.current.startPan(pointerEvent(el, 1, 100, 100)))
    act(() => hook.result.current.startPan(pointerEvent(el, 2, 200, 100)))
    // Symmetric spread: midpoint stays at (150, 100).
    act(() => {
      hook.result.current.movePan(pointerEvent(el, 1, 50, 100))
      hook.result.current.movePan(pointerEvent(el, 2, 250, 100))
    })
    const after = hook.result.current.transform
    expect(after.x + canvasX * after.scale).toBeCloseTo(150, 5)
    expect(after.y + canvasY * after.scale).toBeCloseTo(100, 5)
  })

  it('pinches even when the first finger lands on a node', () => {
    const { hook, el } = setup()
    const node = document.createElement('div')
    node.className = 'kt-map-node'
    el.appendChild(node)
    const before = hook.result.current.transform
    // First finger on a node: no pan starts, but the pointer is tracked.
    act(() => hook.result.current.startPan({ ...pointerEvent(el, 1, 100, 100), target: node }))
    expect(hook.result.current.transform.x).toBeCloseTo(before.x)
    // Second finger anywhere starts the pinch.
    act(() => hook.result.current.startPan(pointerEvent(el, 2, 200, 100)))
    act(() => hook.result.current.movePan(pointerEvent(el, 2, 300, 100)))
    expect(hook.result.current.transform.scale).toBeCloseTo(before.scale * 2)
  })

  it('hands off to a pan when one pinch finger lifts', () => {
    const { hook, el } = setup()
    act(() => hook.result.current.startPan(pointerEvent(el, 1, 100, 100)))
    act(() => hook.result.current.startPan(pointerEvent(el, 2, 200, 100)))
    act(() => hook.result.current.movePan(pointerEvent(el, 2, 300, 100)))
    const pinched = hook.result.current.transform
    act(() => hook.result.current.endPan(pointerEvent(el, 1, 100, 100)))
    act(() => hook.result.current.movePan(pointerEvent(el, 2, 320, 130)))
    const after = hook.result.current.transform
    expect(after.scale).toBeCloseTo(pinched.scale)
    expect(after.x - pinched.x).toBeCloseTo(20)
    expect(after.y - pinched.y).toBeCloseTo(30)
  })

  it('pans when a drag starts on a node and moves past the tap slop', () => {
    const { hook, el } = setup()
    const node = document.createElement('div')
    node.className = 'kt-map-node'
    el.appendChild(node)
    const before = hook.result.current.transform
    act(() => hook.result.current.startPan({ ...pointerEvent(el, 1, 100, 100), target: node }))
    // Within the slop: still a potential tap, no pan yet.
    act(() => hook.result.current.movePan(pointerEvent(el, 1, 104, 100)))
    expect(hook.result.current.transform.x).toBeCloseTo(before.x)
    // Past the slop: the drag becomes a pan.
    act(() => hook.result.current.movePan(pointerEvent(el, 1, 150, 120)))
    expect(hook.result.current.transform.x - before.x).toBeCloseTo(50)
    expect(hook.result.current.transform.y - before.y).toBeCloseTo(20)
    // The trailing click is swallowed so the node is not selected.
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn(), target: node }
    act(() => hook.result.current.handleGraphClickCapture(click))
    expect(click.stopPropagation).toHaveBeenCalled()
  })

  it('keeps a plain tap on a node as a click (no pan, no suppression)', () => {
    const { hook, el } = setup()
    const node = document.createElement('div')
    node.className = 'kt-map-node'
    el.appendChild(node)
    const before = hook.result.current.transform
    act(() => hook.result.current.startPan({ ...pointerEvent(el, 1, 100, 100), target: node }))
    act(() => hook.result.current.endPan(pointerEvent(el, 1, 101, 100)))
    expect(hook.result.current.transform.x).toBeCloseTo(before.x)
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn(), target: node }
    act(() => hook.result.current.handleGraphClickCapture(click))
    expect(click.stopPropagation).not.toHaveBeenCalled()
  })

  it('zooms in on double-click on empty canvas, out with shift', () => {
    const { hook, el } = setup()
    const before = hook.result.current.transform
    act(() => hook.result.current.handleGraphDoubleClick({
      clientX: 150, clientY: 100, shiftKey: false,
      currentTarget: el, target: el, preventDefault: () => {},
    }))
    expect(hook.result.current.transform.scale).toBeCloseTo(before.scale * 1.4)
    act(() => hook.result.current.handleGraphDoubleClick({
      clientX: 150, clientY: 100, shiftKey: true,
      currentTarget: el, target: el, preventDefault: () => {},
    }))
    expect(hook.result.current.transform.scale).toBeCloseTo(before.scale)
  })

  it('ignores double-click on a node', () => {
    const { hook, el } = setup()
    const node = document.createElement('div')
    node.className = 'kt-map-node'
    el.appendChild(node)
    const before = hook.result.current.transform
    act(() => hook.result.current.handleGraphDoubleClick({
      clientX: 150, clientY: 100, shiftKey: false,
      currentTarget: el, target: node, preventDefault: () => {},
    }))
    expect(hook.result.current.transform.scale).toBeCloseTo(before.scale)
  })

  it('still zooms around the cursor on wheel', () => {
    const { hook, el } = setup()
    const before = hook.result.current.transform
    act(() => hook.result.current.zoomMap({
      deltaY: -1,
      clientX: 150,
      clientY: 100,
      currentTarget: el,
      preventDefault: () => {},
    }))
    const after = hook.result.current.transform
    expect(after.scale).toBeCloseTo(before.scale * 1.08)
    // Point under the cursor stays put.
    const canvasX = (150 - before.x) / before.scale
    expect(after.x + canvasX * after.scale).toBeCloseTo(150, 5)
  })
})
