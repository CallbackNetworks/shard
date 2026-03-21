import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'

export default function MarkdownPreview({ content }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: true }),
      Markdown.configure({ html: false }),
    ],
    content: content || '',
    editable: false,
  })

  if (!content) return null

  return (
    <div>
      <EditorContent editor={editor} />
      <style>{`
        .tiptap { outline: none; }
        .tiptap p { margin: 0 0 0.4em; }
        .tiptap h1 { font-size: 1.5em; font-weight: 700; margin: 0.4em 0 0.2em; }
        .tiptap h2 { font-size: 1.25em; font-weight: 700; margin: 0.4em 0 0.2em; }
        .tiptap h3 { font-size: 1.1em; font-weight: 600; margin: 0.4em 0 0.2em; }
        .tiptap ul, .tiptap ol { padding-left: 1.4em; margin: 0.3em 0; }
        .tiptap li { margin: 0.1em 0; }
        .tiptap code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; font-family: monospace; }
        .tiptap pre { background: #1e293b; color: #e2e8f0; padding: 10px 14px; border-radius: 6px; overflow-x: auto; margin: 0.4em 0; }
        .tiptap pre code { background: none; padding: 0; color: inherit; }
        .tiptap blockquote { border-left: 3px solid #d1d5db; padding-left: 12px; margin: 0.4em 0; color: #6b7280; }
        .tiptap a { color: #5e6ad2; text-decoration: underline; }
      `}</style>
    </div>
  )
}
