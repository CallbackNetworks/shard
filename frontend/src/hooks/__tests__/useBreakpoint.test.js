import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import useBreakpoint from '../useBreakpoint'

describe('useBreakpoint', () => {
  const originalInnerWidth = window.innerWidth

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    })
  })

  function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: w,
    })
  }

  it('returns "desktop" when width >= 800', () => {
    setWidth(1024)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('desktop')
  })

  it('returns "tablet" when width >= 600 and < 800', () => {
    setWidth(700)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('tablet')
  })

  it('returns "mobile" when width < 600', () => {
    setWidth(400)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('mobile')
  })

  it('returns "desktop" at exactly 800', () => {
    setWidth(800)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('desktop')
  })

  it('returns "tablet" at exactly 600', () => {
    setWidth(600)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('tablet')
  })

  it('updates on resize from desktop to mobile', () => {
    setWidth(1024)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('desktop')

    act(() => {
      setWidth(400)
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe('mobile')
  })

  it('updates on resize from mobile to tablet', () => {
    setWidth(400)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('mobile')

    act(() => {
      setWidth(650)
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe('tablet')
  })

  it('removes resize listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    setWidth(1024)
    const { unmount } = renderHook(() => useBreakpoint())

    unmount()

    const resizeCalls = removeSpy.mock.calls.filter(([event]) => event === 'resize')
    expect(resizeCalls.length).toBeGreaterThanOrEqual(1)
    removeSpy.mockRestore()
  })
})
