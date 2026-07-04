import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PriorityIcon, StatusIcon, LabelChip } from '../TaskIcons'
import { STATUS_COLOR } from '../../constants/theme'

describe('PriorityIcon', () => {
  it('renders high priority triangle', () => {
    const { container } = render(<PriorityIcon priority="high" />)
    expect(container.textContent).toBe('▲')
  })

  it('renders medium priority square', () => {
    const { container } = render(<PriorityIcon priority="medium" />)
    expect(container.textContent).toBe('■')
  })

  it('renders low priority triangle', () => {
    const { container } = render(<PriorityIcon priority="low" />)
    expect(container.textContent).toBe('▼')
  })

  it('renders medium icon for unknown priority', () => {
    const { container } = render(<PriorityIcon priority="unknown" />)
    expect(container.textContent).toBe('■')
  })

  it('applies a color style for high priority', () => {
    const { container } = render(<PriorityIcon priority="high" />)
    const span = container.querySelector('span')
    expect(span.style.color).toBeTruthy()
  })
})

describe('StatusIcon', () => {
  it('renders done icon with complete circle', () => {
    const { container } = render(<StatusIcon status="done" />)
    const circle = container.querySelector('circle')
    expect(circle).toBeTruthy()
    expect(circle.getAttribute('fill')).toBe(STATUS_COLOR.done)
  })

  it('renders in_progress icon with active stroke', () => {
    const { container } = render(<StatusIcon status="in_progress" />)
    const circle = container.querySelector('circle')
    expect(circle.getAttribute('stroke')).toBe(STATUS_COLOR.in_progress)
  })

  it('renders failed icon with failed X lines', () => {
    const { container } = render(<StatusIcon status="failed" />)
    const lines = container.querySelectorAll('line')
    expect(lines.length).toBe(2)
    expect(lines[0].getAttribute('stroke')).toBe(STATUS_COLOR.failed)
  })

  it('renders todo icon with dashed circle', () => {
    const { container } = render(<StatusIcon status="todo" />)
    const circle = container.querySelector('circle')
    expect(circle.getAttribute('stroke-dasharray')).toBeTruthy()
  })
})

describe('LabelChip', () => {
  it('renders label name', () => {
    render(<LabelChip label={{ name: 'Bug', color: '#ff0000', type: 'label' }} />)
    expect(screen.getByText('Bug')).toBeTruthy()
  })

  it('applies label color', () => {
    const { container } = render(<LabelChip label={{ name: 'Feature', color: '#00ff00', type: 'label' }} />)
    const span = container.querySelector('span')
    expect(span.style.color).toBeTruthy()
  })

  it('renders decision icon for decision labels', () => {
    const { container } = render(
      <LabelChip label={{ name: 'Use PostgreSQL', color: '#5e6ad2', type: 'decision', decision_status: 'accepted' }} />
    )
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
  })

  it('does not render decision icon for regular labels', () => {
    const { container } = render(
      <LabelChip label={{ name: 'Bug', color: '#ff0000', type: 'label' }} />
    )
    const svg = container.querySelector('svg')
    expect(svg).toBeFalsy()
  })

  it('renders proposed decision with decision icon', () => {
    const { container } = render(
      <LabelChip label={{ name: 'Maybe', color: '#aaa', type: 'decision', decision_status: 'proposed' }} />
    )
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('Maybe')).toBeTruthy()
  })
})
