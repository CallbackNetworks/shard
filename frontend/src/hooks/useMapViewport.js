import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const ZOOM_MIN = 0.65
const ZOOM_MAX = 2.4

// Pan/zoom/fit state for the structure-map canvas: tracks the frame size via
// ResizeObserver, computes a fit-to-frame scale, and exposes pointer/keyboard/
// wheel handlers that pan and zoom around the cursor.
export default function useMapViewport({ width, height }) {
  const graphRef = useRef(null)
  const panRef = useRef(null)
  const [frame, setFrame] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })

  useEffect(() => {
    const el = graphRef.current
    if (!el) return undefined
    const update = () => setFrame({ width: el.clientWidth, height: el.clientHeight })
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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

  const zoomBy = (delta) => {
    setView(current => ({ ...current, zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, current.zoom + delta)) }))
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

  const startPan = (event) => {
    if ((event.button !== undefined && event.button !== 0) || event.target.closest('.kt-map-node, .kt-map-empty button')) return
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      view,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.currentTarget.classList.add('is-panning')
    event.preventDefault()
  }

  const movePan = (event) => {
    const pan = panRef.current
    if (!pan) return
    if (pan.pointerId !== undefined && event.pointerId !== pan.pointerId) return
    setView(current => ({
      ...current,
      x: pan.view.x + event.clientX - pan.x,
      y: pan.view.y + event.clientY - pan.y,
    }))
  }

  const endPan = (event) => {
    const pan = panRef.current
    if (!pan) {
      event.currentTarget.classList.remove('is-panning')
      return
    }
    if (pan?.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== pan.pointerId) return
    if (pan.pointerId !== undefined && event.currentTarget.hasPointerCapture?.(pan.pointerId)) {
      event.currentTarget.releasePointerCapture?.(pan.pointerId)
    }
    panRef.current = null
    event.currentTarget.classList.remove('is-panning')
  }

  const zoomMap = (event) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const nextZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.zoom * (event.deltaY > 0 ? 0.92 : 1.08)))
    const currentScale = fit.scale * view.zoom
    const nextScale = fit.scale * nextZoom
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const canvasX = (px - transform.x) / currentScale
    const canvasY = (py - transform.y) / currentScale
    setView({
      zoom: nextZoom,
      x: px - fit.x - canvasX * nextScale,
      y: py - fit.y - canvasY * nextScale,
    })
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
  }
}
