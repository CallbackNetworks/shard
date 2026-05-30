import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ProjectCard from '../ProjectCard'

const mockProject = {
  id: 1,
  name: 'Test Project',
  description: 'A test description',
  status: 'active',
  progress: 60,
  done_tasks: 6,
  total_tasks: 10,
}

function renderCard(project = mockProject, onDelete = vi.fn()) {
  return render(
    <MemoryRouter>
      <ProjectCard project={project} onDelete={onDelete} />
    </MemoryRouter>
  )
}

describe('ProjectCard', () => {
  it('renders project name', () => {
    renderCard()
    expect(screen.getByText('Test Project')).toBeTruthy()
  })

  it('renders project description', () => {
    renderCard()
    expect(screen.getByText('A test description')).toBeTruthy()
  })

  it('hides description when empty', () => {
    renderCard({ ...mockProject, description: '' })
    expect(screen.queryByText('A test description')).toBeNull()
  })

  it('renders task count', () => {
    renderCard()
    expect(screen.getByText('6/10 tasks done')).toBeTruthy()
  })

  it('renders progress percentage', () => {
    renderCard()
    expect(screen.getByText('60%')).toBeTruthy()
  })

  it('renders status badge', () => {
    renderCard()
    expect(screen.getByText('active')).toBeTruthy()
  })

  it('renders archived status', () => {
    renderCard({ ...mockProject, status: 'archived' })
    expect(screen.getByText('archived')).toBeTruthy()
  })

  it('calls onDelete with project id when delete clicked', () => {
    const onDelete = vi.fn()
    renderCard(mockProject, onDelete)
    fireEvent.click(screen.getByText('Delete'))
    expect(onDelete).toHaveBeenCalledWith(1)
  })

  it('renders delete button', () => {
    renderCard()
    expect(screen.getByText('Delete')).toBeTruthy()
  })
})
