import { useState, useEffect, useCallback, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, Code, Quote, Link as LinkIcon, FileCode,
} from 'lucide-react'

const toolbarBtnStyle = (active) => ({
  background: active ? 'rgba(239,68,68,0.2)' : 'none',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  color: active ? '#ef4444' : 'rgba(255,255,255,0.4)',
  padding: '3px 5px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
})

const modeBtnStyle = (active) => ({
  padding: '2px 8px',
  fontSize: 11,
  fontWeight: active ? 600 : 400,
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  background: active ? '#ef4444' : 'transparent',
  color: active ? '#fff' : 'rgba(255,255,255,0.4)',
})

function Toolbar({ editor }) {
  if (!editor) return null

  const setLink = () => {
    const prev = editor.getAttributes('link').href
    const url = window.prompt('URL', prev || 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }

  const items = [
    { icon: <Bold size={14} />, action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
    { icon: <Italic size={14} />, action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
    { icon: <Strikethrough size={14} />, action: () => editor.chain().focus().toggleStrike().run(), active: editor.isActive('strike') },
    null, // separator
    { icon: <Heading1 size={14} />, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), active: editor.isActive('heading', { level: 1 }) },
    { icon: <Heading2 size={14} />, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive('heading', { level: 2 }) },
    { icon: <Heading3 size={14} />, action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), active: editor.isActive('heading', { level: 3 }) },
    null,
    { icon: <List size={14} />, action: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
    { icon: <ListOrdered size={14} />, action: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList') },
    null,
    { icon: <Code size={14} />, action: () => editor.chain().focus().toggleCode().run(), active: editor.isActive('code') },
    { icon: <FileCode size={14} />, action: () => editor.chain().focus().toggleCodeBlock().run(), active: editor.isActive('codeBlock') },
    { icon: <Quote size={14} />, action: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive('blockquote') },
    { icon: <LinkIcon size={14} />, action: setLink, active: editor.isActive('link') },
  ]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      {items.map((item, i) =>
        item === null
          ? <div key={i} style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 3px' }} />
          : <button key={i} type="button" onMouseDown={e => e.preventDefault()} onClick={item.action} style={toolbarBtnStyle(item.active)}>{item.icon}</button>
      )}
    </div>
  )
}

export default function MarkdownEditor({ value, onChange, placeholder, minHeight = 80 }) {
  const [mode, setMode] = useState('wysiwyg') // 'wysiwyg' | 'markdown'
  const [mdSource, setMdSource] = useState(value || '')
  const suppressUpdate = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { style: 'color: #ef4444; text-decoration: underline;' },
      }),
      Placeholder.configure({
        placeholder: placeholder || 'Write something...',
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      if (suppressUpdate.current) return
      const md = editor.storage.markdown.getMarkdown()
      setMdSource(md)
      onChange?.(md)
    },
  })

  // Sync external value changes into editor
  useEffect(() => {
    if (!editor || mode !== 'wysiwyg') return
    const currentMd = editor.storage.markdown.getMarkdown()
    if (value !== currentMd && value !== undefined) {
      suppressUpdate.current = true
      editor.commands.setContent(value || '')
      suppressUpdate.current = false
    }
  }, [value, editor, mode])

  const switchToMarkdown = useCallback(() => {
    if (editor) {
      setMdSource(editor.storage.markdown.getMarkdown())
    }
    setMode('markdown')
  }, [editor])

  const switchToWysiwyg = useCallback(() => {
    if (editor) {
      suppressUpdate.current = true
      editor.commands.setContent(mdSource)
      suppressUpdate.current = false
    }
    setMode('wysiwyg')
  }, [editor, mdSource])

  const handleMdChange = useCallback((e) => {
    const val = e.target.value
    setMdSource(val)
    onChange?.(val)
  }, [onChange])

  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 6,
      overflow: 'hidden',
      background: 'rgba(255,255,255,0.03)',
      fontSize: 13,
      color: '#ffffff',
    }}>
      {/* Toolbar + mode toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 8px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(255,255,255,0.02)',
        gap: 8,
        flexWrap: 'wrap',
      }}>
        {mode === 'wysiwyg' ? <Toolbar editor={editor} /> : <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>Markdown source</div>}
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          <button type="button" onClick={switchToWysiwyg} style={modeBtnStyle(mode === 'wysiwyg')}>
            Edit
          </button>
          <button type="button" onClick={switchToMarkdown} style={modeBtnStyle(mode === 'markdown')}>
            Markdown
          </button>
        </div>
      </div>

      {/* Editor area */}
      {mode === 'wysiwyg' ? (
        <div
          style={{ minHeight, padding: '8px 12px', cursor: 'text' }}
          onClick={() => editor?.commands.focus()}
        >
          <EditorContent editor={editor} />
          <style>{`
            .tiptap { outline: none; color: #ffffff; }
            .tiptap p { margin: 0 0 0.4em; }
            .tiptap h1 { font-size: 1.5em; font-weight: 700; margin: 0.4em 0 0.2em; }
            .tiptap h2 { font-size: 1.25em; font-weight: 700; margin: 0.4em 0 0.2em; }
            .tiptap h3 { font-size: 1.1em; font-weight: 600; margin: 0.4em 0 0.2em; }
            .tiptap ul, .tiptap ol { padding-left: 1.4em; margin: 0.3em 0; }
            .tiptap li { margin: 0.1em 0; }
            .tiptap code { background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px; font-size: 0.9em; font-family: monospace; color: #ef4444; }
            .tiptap pre { background: #1e293b; color: #e2e8f0; padding: 10px 14px; border-radius: 6px; overflow-x: auto; margin: 0.4em 0; }
            .tiptap pre code { background: none; padding: 0; color: inherit; }
            .tiptap blockquote { border-left: 3px solid rgba(255,255,255,0.15); padding-left: 12px; margin: 0.4em 0; color: rgba(255,255,255,0.4); }
            .tiptap a { color: #ef4444; text-decoration: underline; }
            .tiptap p.is-editor-empty:first-child::before {
              content: attr(data-placeholder);
              float: left;
              color: rgba(255,255,255,0.2);
              pointer-events: none;
              height: 0;
            }
          `}</style>
        </div>
      ) : (
        <textarea
          value={mdSource}
          onChange={handleMdChange}
          placeholder={placeholder || 'Write markdown...'}
          style={{
            width: '100%',
            minHeight,
            padding: '8px 12px',
            border: 'none',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: 1.6,
            background: 'rgba(255,255,255,0.02)',
            color: '#ffffff',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  )
}
