import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DatabaseBackup, Download, RotateCcw, Upload } from 'lucide-react'
import { getBackupStatus, runBackup, exportBackup, downloadBackupFile, restoreBackupFile, restoreServerBackup } from '../../api/client'
import { DARK } from '../../constants/theme'
import { ControlRow, SectionTitle, Segmented } from './primitives'
import s from './BackupPanel.module.css'

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function saveBlob(response, fallbackName) {
  const disposition = response.headers?.['content-disposition'] || ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const url = URL.createObjectURL(response.data)
  const a = document.createElement('a')
  a.href = url
  a.download = match?.[1] || fallbackName
  a.click()
  URL.revokeObjectURL(url)
}

/** Backup settings + run/export/restore card. Owns its backup queries;
 *  auto-backup settings persist through the page's system-settings mutation. */
export default function BackupPanel({ settings, onUpdateSystem }) {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: backupStatus } = useQuery({
    queryKey: ['backup-status'],
    queryFn: getBackupStatus,
    staleTime: 30000,
  })

  const backupMut = useMutation({
    mutationFn: runBackup,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup-status'] }),
  })

  const [exporting, setExporting] = useState(false)
  const handleExport = async () => {
    setExporting(true)
    try {
      saveBlob(await exportBackup(), 'shard-backup.zip')
    } finally {
      setExporting(false)
    }
  }

  const restoreMut = useMutation({
    mutationFn: ({ file, filename }) => (file ? restoreBackupFile(file) : restoreServerBackup(filename)),
    onSuccess: () => {
      qc.invalidateQueries()
      window.alert(t('settings.backupRestoreDone'))
    },
    onError: (e) => window.alert(`${t('settings.backupRestoreFailed')}: ${e?.response?.data?.detail || e.message}`),
  })
  const uploadRestoreRef = useRef(null)
  const handleRestore = (opts) => {
    if (!window.confirm(t('settings.backupRestoreConfirm'))) return
    restoreMut.mutate(opts)
  }

  return (
    <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
      <SectionTitle
        icon={<DatabaseBackup size={16} color={DARK.info} />}
        title={t('settings.backup')}
      />
      <ControlRow label={t('settings.backupAuto')} hint={t('settings.backupAutoHint')}>
        <Segmented
          value={settings.backup_enabled ? 'on' : 'off'}
          onChange={v => onUpdateSystem({ backup_enabled: v === 'on' ? 1 : 0 })}
          options={[
            { value: 'off', label: t('settings.off') },
            { value: 'on', label: t('settings.on') },
          ]}
        />
      </ControlRow>
      <ControlRow label={t('settings.backupHour')} hint={t('settings.backupHourHint')}>
        <select
          value={settings.backup_hour}
          onChange={e => onUpdateSystem({ backup_hour: Number(e.target.value) })}
          className="kt-input"
          style={{ width: 'auto', minWidth: 110 }}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{String(h).padStart(2, '0')}:00 UTC</option>
          ))}
        </select>
      </ControlRow>
      <ControlRow label={t('settings.backupKeep')} hint={t('settings.backupKeepHint')}>
        <Segmented
          value={settings.backup_keep}
          onChange={v => onUpdateSystem({ backup_keep: v })}
          options={[3, 7, 14, 30].map(n => ({ value: n, label: String(n) }))}
        />
      </ControlRow>
      <div className={s.actions}>
        <button
          onClick={() => backupMut.mutate()}
          disabled={backupMut.isPending}
          className="kt-btn kt-btn-primary"
        >
          {backupMut.isPending ? t('loading') : t('settings.backupNow')}
        </button>
        <button onClick={handleExport} disabled={exporting} className="kt-btn">
          <Download size={12} /> {exporting ? t('loading') : t('settings.backupDownload')}
        </button>
        <button
          onClick={() => uploadRestoreRef.current?.click()}
          disabled={restoreMut.isPending}
          className="kt-btn"
        >
          <Upload size={12} /> {restoreMut.isPending ? t('loading') : t('settings.backupRestoreUpload')}
        </button>
        <input
          ref={uploadRestoreRef}
          type="file"
          accept=".zip,application/zip"
          className={s.hiddenInput}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) handleRestore({ file })
          }}
        />
      </div>
      {backupStatus?.backups?.length > 0 ? (
        <div>
          <div className={s.listTitle}>
            {t('settings.backupExisting')}
          </div>
          {backupStatus.backups.map(b => (
            <div key={b.filename} className={s.backupRow}>
              <code className={s.backupName}>{b.filename}</code>
              <span className={s.backupSize}>{formatBytes(b.size_bytes)}</span>
              <button
                onClick={async () => saveBlob(await downloadBackupFile(b.filename), b.filename)}
                aria-label={t('settings.backupDownload')}
                title={t('settings.backupDownload')}
                className={s.iconBtn}
              >
                <Download size={13} />
              </button>
              <button
                onClick={() => handleRestore({ filename: b.filename })}
                disabled={restoreMut.isPending}
                aria-label={t('settings.backupRestore')}
                title={t('settings.backupRestore')}
                className={s.iconBtn}
              >
                <RotateCcw size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className={s.noBackups}>{t('settings.backupNone')}</div>
      )}
    </div>
  )
}
