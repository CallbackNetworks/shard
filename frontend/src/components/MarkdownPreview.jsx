import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'

export default function MarkdownPreview({ content, className }) {
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
    <div className={className}>
      <EditorContent editor={editor} />
      <style>{`
        .tiptap { outline: none; color: #ffffff; }
        .tiptap p { margin: 0 0 0.4em; }
        .tiptap h1 { font-size: 1.5em; font-weight: 700; margin: 0.4em 0 0.2em; }
        .tiptap h2 { font-size: 1.25em; font-weight: 700; margin: 0.4em 0 0.2em; }
        .tiptap h3 { font-size: 1.1em; font-weight: 600; margin: 0.4em 0 0.2em; }
        .tiptap ul, .tiptap ol { padding-left: 1.4em; margin: 0.3em 0; }
        .tiptap li { margin: 0.1em 0; }
        .tiptap code { background: rgba(var(--kt-ink-rgb), 0.08); padding: 1px 4px; border-radius: 3px; font-size: 0.9em; font-family: monospace; color: #facc15; }
        .tiptap pre { background: #1e293b; color: #e2e8f0; padding: 10px 14px; border-radius: 6px; overflow-x: auto; margin: 0.4em 0; }
        .tiptap pre code { background: none; padding: 0; color: inherit; }
        .tiptap blockquote { border-left: 3px solid rgba(var(--kt-ink-rgb), 0.15); padding-left: 12px; margin: 0.4em 0; color: rgba(var(--kt-ink-rgb), 0.4); }
        .tiptap a { color: #facc15; text-decoration: underline; }
      `}</style>
    </div>
  )
}
