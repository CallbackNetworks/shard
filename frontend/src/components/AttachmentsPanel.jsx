import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, Paperclip, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getAttachments, uploadAttachment, deleteAttachment, getAttachmentUrl } from '../api/client'

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function AttachmentsPanel({ projectId, taskId, depth }) {
  const { t } = useTranslation()
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const qc = useQueryClient()

  useEffect(() => {
    setLoading(true)
    getAttachments(projectId, taskId)
      .then(setFiles)
      .finally(() => setLoading(false))
  }, [projectId, taskId])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const att = await uploadAttachment(projectId, taskId, file)
      setFiles(prev => [att, ...prev])
      qc.invalidateQueries({ queryKey: ['project', projectId] })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDelete = async (attId) => {
    await deleteAttachment(projectId, taskId, attId)
    setFiles(prev => prev.filter(f => f.id !== attId))
  }

  const padLeft = 16 + depth * 20 + 36

  return (
    <div style={{
      paddingLeft: padLeft, paddingRight: 16,
      paddingTop: 10, paddingBottom: 12,
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      background: 'rgba(255,255,255,0.02)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {t('attachments.title')}
        </span>
        <input ref={fileRef} type="file" onChange={handleUpload} style={{ display: 'none' }} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', borderRadius: 9999, border: '1px solid rgba(255,255,255,0.15)',
            background: 'transparent', fontSize: 11, cursor: 'pointer', color: '#b3b3b3', fontWeight: 600,
          }}
        >
          <Paperclip size={10} /> {uploading ? t('attachments.uploading') : t('attachments.addFile')}
        </button>
      </div>
      {loading ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>Loading{'\u2026'}</div>
      ) : files.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>{t('attachments.noAttachments')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map(f => (
            <div key={f.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}>
              <Paperclip size={11} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.filename}
              </span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>
                {formatSize(f.size)}
              </span>
              <a
                href={getAttachmentUrl(projectId, taskId, f.id)}
                download
                style={{ display: 'flex', color: '#1ed760', padding: '2px' }}
              >
                <Download size={11} />
              </a>
              <button onClick={() => handleDelete(f.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(248,113,113,0.5)', padding: 0, display: 'flex' }}>
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
