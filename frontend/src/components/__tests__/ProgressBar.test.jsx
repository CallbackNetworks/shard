import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ProgressBar from '../ProgressBar'

function getInnerBar(container) {
  // ProgressBar renders: <div(outer)><div(inner)/></div>
  // container is the testing-library wrapper, so container.firstChild is the outer div
  return container.firstChild.firstChild
}

describe('ProgressBar', () => {
  it('renders with correct width percentage', () => {
    const { container } = render(<ProgressBar value={75} />)
    const style = getInnerBar(container).getAttribute('style')
    expect(style).toContain('width: 75%')
  })

  it('clamps value to 0 minimum', () => {
    const { container } = render(<ProgressBar value={-10} />)
    const style = getInnerBar(container).getAttribute('style')
    expect(style).toContain('width: 0%')
  })

  it('clamps value to 100 maximum', () => {
    const { container } = render(<ProgressBar value={150} />)
    const style = getInnerBar(container).getAttribute('style')
    expect(style).toContain('width: 100%')
  })

  it('handles null value as 0', () => {
    const { container } = render(<ProgressBar value={null} />)
    const style = getInnerBar(container).getAttribute('style')
    expect(style).toContain('width: 0%')
  })

  it('uses custom height', () => {
    const { container } = render(<ProgressBar value={50} height={10} />)
    const outer = container.firstChild
    expect(outer.style.height).toBe('10px')
  })

  it('hides bar when value is 0', () => {
    const { container } = render(<ProgressBar value={0} />)
    const style = getInnerBar(container).getAttribute('style')
    expect(style).toContain('opacity: 0')
  })

  it('shows bar when value is positive', () => {
    const { container } = render(<ProgressBar value={50} />)
    const style = getInnerBar(container).getAttribute('style')
    expect(style).toContain('opacity: 1')
  })
})
