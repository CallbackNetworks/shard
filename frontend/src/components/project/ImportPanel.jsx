import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Button from '../shared/Button'
import { importTasks } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { DARK } from '../../constants/theme'
import s from './ImportPanel.module.css'

const PLACEHOLDER = '[\n  { "title": "Task 1", "priority": "high" },\n  { "title": "Task 2", "subtasks": [{ "title": "Sub 1" }] }\n]'

/**
 * Paste a JSON array of tasks into a project. The pasted text and the parse
 * error it produced are the panel's own — the project page kept them only to
 * hand them straight back down, and closing the panel has always discarded
 * them, so the parent mounts this rather than passing an `open` flag.
 */
export default function ImportPanel({ projectId, onClose }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [json, setJson] = useState('')
  const [error, setError] = useState('')

  const importMut = useMutation({
    mutationFn: (data) => importTasks(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.project(projectId) })
      qc.invalidateQueries({ queryKey: qk.projects() })
      setJson('')
      onClose()
    },
  })

  const submit = () => {
    try {
      const parsed = JSON.parse(json)
      setError('')
      importMut.mutate({ tasks: Array.isArray(parsed) ? parsed : [parsed] })
    } catch (err) {
      // Inline and specific: a blocking alert() saying only "Invalid JSON" does
      // not say where the problem is.
      setError(err.message)
    }
  }

  return (
    <div className={s.panel}>
      <div className={s.title}>{t('project.importTasks')}</div>
      <textarea
        value={json}
        onChange={e => { setJson(e.target.value); if (error) setError('') }}
        placeholder={PLACEHOLDER}
        className={s.textarea}
        data-invalid={error ? 'true' : 'false'}
      />
      {error && <div role="alert" className={s.error}>{error}</div>}
      <div className={s.actions}>
        <Button
          onClick={submit}
          disabled={!json.trim() || importMut.isPending}
          tone={DARK.info}
        >
          {importMut.isPending ? t('project.importing') : t('project.importAction')}
        </Button>
        <Button variant="cancel" onClick={onClose}>{t('cancel')}</Button>
      </div>
    </div>
  )
}
