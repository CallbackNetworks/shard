import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import useKeyboardShortcuts from '../useKeyboardShortcuts'

describe('useKeyboardShortcuts', () => {
  let onCreateTask, onCreateProject, onSearch, onShowHelp, navigate

  beforeEach(() => {
    vi.useFakeTimers()
    onCreateTask = vi.fn()
    onCreateProject = vi.fn()
    onSearch = vi.fn()
    onShowHelp = vi.fn()
    navigate = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderShortcuts(overrides = {}) {
    return renderHook(() =>
      useKeyboardShortcuts({
        onCreateTask,
        onCreateProject,
        onSearch,
        onShowHelp,
        navigate,
        ...overrides,
      })
    )
  }

  function press(key, opts = {}) {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      ...opts,
    })
    act(() => {
      window.dispatchEvent(event)
    })
  }

  it('calls onCreateTask when "c" is pressed', () => {
    renderShortcuts()
    press('c')
    expect(onCreateTask).toHaveBeenCalledTimes(1)
  })

  it('calls onCreateProject when "n" is pressed', () => {
    renderShortcuts()
    press('n')
    expect(onCreateProject).toHaveBeenCalledTimes(1)
  })

  it('calls onSearch when "/" is pressed', () => {
    renderShortcuts()
    press('/')
    expect(onSearch).toHaveBeenCalledTimes(1)
  })

  it('calls onShowHelp when "?" is pressed', () => {
    renderShortcuts()
    press('?')
    expect(onShowHelp).toHaveBeenCalledTimes(1)
  })

  it('navigates to / on chord g+h', () => {
    renderShortcuts()
    press('g')
    press('h')
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('navigates to /analytics on chord g+a', () => {
    renderShortcuts()
    press('g')
    press('a')
    expect(navigate).toHaveBeenCalledWith('/analytics')
  })

  it('navigates to /identities on chord g+i', () => {
    renderShortcuts()
    press('g')
    press('i')
    expect(navigate).toHaveBeenCalledWith('/identities')
  })

  it('navigates to /goals on chord g+g', () => {
    renderShortcuts()
    press('g')
    press('g')
    expect(navigate).toHaveBeenCalledWith('/goals')
  })

  it('chord expires after 500ms', () => {
    renderShortcuts()
    press('g')
    act(() => {
      vi.advanceTimersByTime(600)
    })
    press('h')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('ignores shortcuts when an INPUT is focused', () => {
    renderShortcuts()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const event = new KeyboardEvent('keydown', { key: 'c', bubbles: true })
    Object.defineProperty(event, 'target', { value: input })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(onCreateTask).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('ignores shortcuts when a TEXTAREA is focused', () => {
    renderShortcuts()
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()

    const event = new KeyboardEvent('keydown', { key: 'c', bubbles: true })
    Object.defineProperty(event, 'target', { value: textarea })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(onCreateTask).not.toHaveBeenCalled()
    document.body.removeChild(textarea)
  })

  it('ignores shortcuts when a SELECT is focused', () => {
    renderShortcuts()
    const select = document.createElement('select')
    document.body.appendChild(select)
    select.focus()

    const event = new KeyboardEvent('keydown', { key: 'c', bubbles: true })
    Object.defineProperty(event, 'target', { value: select })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(onCreateTask).not.toHaveBeenCalled()
    document.body.removeChild(select)
  })

  it('ignores shortcuts when ctrlKey is held', () => {
    renderShortcuts()
    press('c', { ctrlKey: true })
    expect(onCreateTask).not.toHaveBeenCalled()
  })

  it('ignores shortcuts when metaKey is held', () => {
    renderShortcuts()
    press('c', { metaKey: true })
    expect(onCreateTask).not.toHaveBeenCalled()
  })

  it('ignores shortcuts when altKey is held', () => {
    renderShortcuts()
    press('c', { altKey: true })
    expect(onCreateTask).not.toHaveBeenCalled()
  })

  it('does not call navigate for unknown chord key', () => {
    renderShortcuts()
    press('g')
    press('z')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('cleans up listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderShortcuts()

    unmount()

    const keydownCalls = removeSpy.mock.calls.filter(([event]) => event === 'keydown')
    expect(keydownCalls.length).toBeGreaterThanOrEqual(1)
    removeSpy.mockRestore()
  })
})
