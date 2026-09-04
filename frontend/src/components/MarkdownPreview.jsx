import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { Markdown } from 'tiptap-markdown'

/**
 * The app's one Markdown renderer. Its stylesheet lives in global.css rather
 * than in a per-instance <style> block: the assistant renders one of these per
 * message (ADR-0089), and N identical copies of the same CSS in the DOM is
 * waste that grows with the length of a conversation.
 */
export default function MarkdownPreview({ content, className }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: true }),
      // StarterKit has no image node, so `![alt](src)` used to render as the
      // literal text of its own markdown — which is what the guide is made of
      // (ADR-0148), and is also what a task description with a screenshot in it
      // has always done. `html: false` below still holds, so this accepts the
      // markdown form and not an <img> tag pasted into a description.
      Image.configure({ inline: false, allowBase64: false }),
      Markdown.configure({ html: false }),
    ],
    content: content || '',
    editable: false,
  })

  if (!content) return null

  return (
    <div className={className}>
      <EditorContent editor={editor} />
    </div>
  )
}
