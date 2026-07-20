import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const ZOOM_MIN = 0.65
const ZOOM_MAX = 2.4
// The fit scale can be tiny on small screens, where a relative ZOOM_MAX still
// leaves nodes unreadable — always allow zooming until the canvas reaches
// this absolute scale (2 = 200% of native node size).
const ABS_SCALE_MAX = 2
// Movement below this (px) is a tap/click; beyond it the gesture is a drag.
const TAP_SLOP = 7

// Pan/zoom/fit state for the structure-map canvas: tracks the frame size via
// ResizeObserver, computes a fit-to-frame scale, and exposes pointer/keyboard/
// wheel handlers that pan and zoom around the cursor. Two simultaneous
// pointers drive a pinch gesture (zoom around the finger midpoint), since
// touch-action: none on the frame disables the browser's own pinch handling.
export default function useMapViewport({ width, height }) {
  // Callback ref instead of a mount-time effect: the graph frame mounts and
  // unmounts as the user switches layout styles, so measurement has to follow
  // the element, not the hook's lifecycle.
  const [frameEl, setFrameEl] = useState(null)
  const graphRef = useCallback((el) => setFrameEl(el), [])
  const panRef = useRef(null)
  // pointerId -> {x, y} for all pointers currently down on the frame.
  const pointersRef = useRef(new Map())
  const pinchRef = useRef(null)
  // Mirrors the latest view set by any handler. Pointer events can fire
  // several times between renders, so handlers must not trust the `view`
  // closure when chaining gestures (pan -> pinch -> pan).
  const liveViewRef = useRef({ zoom: 1, x: 0, y: 0 })
  // True once the current gesture moved past TAP_SLOP; the trailing click
  // then gets swallowed so a drag never selects or deselects anything.
  const movedRef = useRef(false)
  const [frame, setFrame] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })

  useEffect(() => { liveViewRef.current = view }, [view])

  useEffect(() => {
    if (!frameEl) return undefined
    const update = () => setFrame({ width: frameEl.clientWidth, height: frameEl.clientHeight })
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(frameEl)
    return () => observer.disconnect()
  }, [frameEl])

  const fit = useMemo(() => {
    const padding = 28
    if (!frame.width || !frame.height) return { scale: 1, x: 0, y: 0 }
    const scale = Math.max(0.2, Math.min(
      1,
      (frame.width - padding) / width,
      (frame.height - padding) / height
    ))
    return {
      scale,
      x: Math.max(0, (frame.width - width * scale) / 2),
      y: Math.max(0, (frame.height - height * scale) / 2),
    }
  }, [frame.height, frame.width, height, width])

  const transform = {
    scale: fit.scale * view.zoom,
    x: fit.x + view.x,
    y: fit.y + view.y,
  }

  const zoomMax = Math.max(ZOOM_MAX, ABS_SCALE_MAX / fit.scale)

  const zoomBy = (delta) => {
    setView(current => ({ ...current, zoom: Math.max(ZOOM_MIN, Math.min(zoomMax, current.zoom + delta)) }))
  }

  const resetView = useCallback(() => {
    setView({ zoom: 1, x: 0, y: 0 })
  }, [])

  const panBy = (dx, dy) => {
    setView(current => ({
      ...current,
      x: current.x + dx,
      y: current.y + dy,
    }))
  }

  const handleGraphKeyDown = (event) => {
    const step = event.shiftKey ? 120 : 48
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      panBy(step, 0)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      panBy(-step, 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      panBy(0, step)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      panBy(0, -step)
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoomBy(0.14)
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      zoomBy(-0.14)
    } else if (event.key === '0') {
      event.preventDefault()
      resetView()
    }
  }

  const rafRef = useRef(0)
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  // Paint the transform straight onto the canvas element so gestures track
  // the pointer within the same frame; the React state update (which
  // re-renders the whole node tree) is coalesced to one per animation frame.
  const paintCanvas = (next) => {
    const canvas = frameEl?.querySelector('.kt-map-canvas')
    if (!canvas) return
    canvas.style.transform =
      `translate(${fit.x + next.x}px, ${fit.y + next.y}px) scale(${fit.scale * next.zoom})`
  }

  const applyView = (next) => {
    liveViewRef.current = next
    paintCanvas(next)
    if (typeof requestAnimationFrame !== 'function') {
      setView(next)
      return
    }
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        setView(liveViewRef.current)
      })
    }
  }

  const startPinch = (frameNode) => {
    const points = [...pointersRef.current.values()]
    if (points.length < 2) return
    const rect = frameNode.getBoundingClientRect()
    const startView = liveViewRef.current
    const startScale = fit.scale * startView.zoom
    const midX = (points[0].x + points[1].x) / 2 - rect.left
    const midY = (points[0].y + points[1].y) / 2 - rect.top
    pinchRef.current = {
      rect,
      startZoom: startView.zoom,
      startDist: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)),
      // Canvas-space point under the finger midpoint; kept glued to the
      // moving midpoint while zooming, like wheel zoom around the cursor.
      canvasX: (midX - fit.x - startView.x) / startScale,
      canvasY: (midY - fit.y - startView.y) / startScale,
    }
    panRef.current = null
  }

  const movePinch = () => {
    const pinch = pinchRef.current
    const points = [...pointersRef.current.values()]
    if (!pinch || points.length < 2) return
    movedRef.current = true
    const dist = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y))
    const nextZoom = Math.max(ZOOM_MIN, Math.min(zoomMax, pinch.startZoom * (dist / pinch.startDist)))
    const nextScale = fit.scale * nextZoom
    const midX = (points[0].x + points[1].x) / 2 - pinch.rect.left
    const midY = (points[0].y + points[1].y) / 2 - pinch.rect.top
    applyView({
      zoom: nextZoom,
      x: midX - fit.x - pinch.canvasX * nextScale,
      y: midY - fit.y - pinch.canvasY * nextScale,
    })
  }

  const startPan = (event) => {
    if (event.button !== undefined && event.button !== 0) return
    // Track every pointer so a pinch can start even when a finger lands on a
    // node — on a phone the map is dense enough that this is the common case.
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size === 1) movedRef.current = false
    if (pointersRef.current.size >= 2) {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      event.currentTarget.classList.add('is-panning')
      event.preventDefault()
      startPinch(event.currentTarget)
      return
    }
    const onNode = !!event.target.closest('.kt-map-node, .kt-map-empty button')
    if (!onNode) {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      event.currentTarget.classList.add('is-panning')
      event.preventDefault()
    }
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      view: liveViewRef.current,
      // A drag that starts on a node only becomes a pan once it travels past
      // the tap slop, so plain taps/clicks still select the node.
      pending: onNode,
    }
  }

  const movePan = (event) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    if (pinchRef.current) {
      movePinch()
      return
    }
    const pan = panRef.current
    if (!pan) return
    if (pan.pointerId !== undefined && event.pointerId !== pan.pointerId) return
    const dx = event.clientX - pan.x
    const dy = event.clientY - pan.y
    if (!movedRef.current && Math.hypot(dx, dy) > TAP_SLOP) movedRef.current = true
    if (pan.pending) {
      if (!movedRef.current) return
      pan.pending = false
      // Only mice need explicit capture here. Touch pointers are implicitly
      // captured by the node they went down on (a child of the frame, so
      // events still bubble here) — stealing that capture mid-gesture fires
      // lostpointercapture on the node, which endPan would treat as the
      // gesture ending.
      if (event.pointerType === 'mouse') event.currentTarget.setPointerCapture?.(pan.pointerId)
      event.currentTarget.classList.add('is-panning')
    }
    applyView({
      ...liveViewRef.current,
      x: pan.view.x + dx,
      y: pan.view.y + dy,
    })
  }

  const endPan = (event) => {
    if (event.pointerId !== undefined) {
      pointersRef.current.delete(event.pointerId)
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }
    }
    if (pinchRef.current && pointersRef.current.size < 2) {
      pinchRef.current = null
      // One finger left: hand the gesture over to a fresh pan from where
      // that finger currently is, instead of ending the interaction.
      const remaining = [...pointersRef.current.entries()][0]
      if (remaining) {
        const [pointerId, point] = remaining
        panRef.current = { pointerId, x: point.x, y: point.y, view: liveViewRef.current }
        return
      }
    }
    const pan = panRef.current
    if (!pan) {
      if (pointersRef.current.size === 0) event.currentTarget.classList.remove('is-panning')
      return
    }
    if (pan.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== pan.pointerId) return
    panRef.current = null
    event.currentTarget.classList.remove('is-panning')
  }

  // Zoom by `factor` keeping the canvas point under the cursor stationary.
  const zoomAtPoint = (event, factor) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const current = liveViewRef.current
    const nextZoom = Math.max(ZOOM_MIN, Math.min(zoomMax, current.zoom * factor))
    const currentScale = fit.scale * current.zoom
    const nextScale = fit.scale * nextZoom
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const canvasX = (px - fit.x - current.x) / currentScale
    const canvasY = (py - fit.y - current.y) / currentScale
    applyView({
      zoom: nextZoom,
      x: px - fit.x - canvasX * nextScale,
      y: py - fit.y - canvasY * nextScale,
    })
  }

  const zoomMap = (event) => {
    event.preventDefault()
    zoomAtPoint(event, event.deltaY > 0 ? 0.92 : 1.08)
  }

  // Swallow the click that trails a pan/pinch so a drag never selects a node
  // or clears the selection. The flag resets on the next pointerdown.
  const handleGraphClickCapture = (event) => {
    if (movedRef.current) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  // Double-click/double-tap on empty canvas zooms in around the cursor
  // (shift inverts to zoom out). Nodes keep their own dblclick = open.
  const handleGraphDoubleClick = (event) => {
    if (movedRef.current) return
    if (event.target.closest('.kt-map-node, button, a')) return
    event.preventDefault()
    zoomAtPoint(event, event.shiftKey ? 1 / 1.4 : 1.4)
  }

  return {
    graphRef,
    transform,
    zoomBy,
    resetView,
    handleGraphKeyDown,
    startPan,
    movePan,
    endPan,
    zoomMap,
    handleGraphClickCapture,
    handleGraphDoubleClick,
  }
}
