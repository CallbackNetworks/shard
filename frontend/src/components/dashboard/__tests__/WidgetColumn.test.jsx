import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { DndContext } from '@dnd-kit/core'
import WidgetColumn from '../WidgetColumn'

const widgets = {
  a: { label: 'Widget A', node: <div>Content A</div> },
  b: { label: 'Widget B', node: <div>Content B</div> },
}

describe('WidgetColumn', () => {
  it('renders widget content without a drag handle outside edit mode', () => {
    render(<WidgetColumn colKey="main" ids={['a', 'b']} widgets={widgets} editing={false} />)
    expect(screen.getByText('Content A')).toBeInTheDocument()
    expect(screen.getByText('Content B')).toBeInTheDocument()
    expect(screen.queryByText('Widget A')).not.toBeInTheDocument()
  })

  it('skips an id the widget map does not know about', () => {
    render(<WidgetColumn colKey="main" ids={['a', 'ghost']} widgets={widgets} editing={false} />)
    expect(screen.getByText('Content A')).toBeInTheDocument()
    expect(screen.queryByText('Content B')).not.toBeInTheDocument()
  })

  it('shows a drag handle with the widget label while editing', () => {
    render(
      <DndContext>
        <WidgetColumn colKey="main" ids={['a', 'b']} widgets={widgets} editing emptyLabel="Empty" />
      </DndContext>
    )
    expect(screen.getByText('Widget A')).toBeInTheDocument()
    expect(screen.getByText('Widget B')).toBeInTheDocument()
    expect(screen.getByText('Content A')).toBeInTheDocument()
  })

  it('shows the empty-column hint when editing an empty column', () => {
    render(
      <DndContext>
        <WidgetColumn colKey="sidebar" ids={[]} widgets={widgets} editing emptyLabel="Drop here" />
      </DndContext>
    )
    expect(screen.getByText('Drop here')).toBeInTheDocument()
  })
})
