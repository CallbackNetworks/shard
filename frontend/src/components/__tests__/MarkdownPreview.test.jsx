import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import MarkdownPreview from "../MarkdownPreview"

describe("MarkdownPreview", () => {
  it("renders markdown content", () => {
    render(<MarkdownPreview content="Hello **world**" />)
    expect(screen.getByText(/Hello/)).toBeTruthy()
    expect(screen.getByText(/world/)).toBeTruthy()
  })

  it("renders empty when no content", () => {
    const { container } = render(<MarkdownPreview />)
    expect(container.firstChild).toBeNull()
  })

  it("applies custom className", () => {
    const { container } = render(
      <MarkdownPreview content="Preview content" className="custom-preview" />
    )
    expect(container.firstChild.className).toBe("custom-preview")
  })
})
