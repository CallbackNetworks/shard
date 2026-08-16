import { useTranslation } from 'react-i18next'
import s from './BulkToolbar.module.css'

/** Bulk-selection action bar shown above the issues list. */
export default function BulkToolbar({ selectedCount, onSetStatus, onSetPriority, onPin, onClear }) {
  const { t } = useTranslation()
  return (
    <div className={s.bar}>
      <span className={s.count}>{t('project.selectedCount', { count: selectedCount })}</span>
      <select
        onChange={e => { if (e.target.value) { onSetStatus(e.target.value); e.target.value = '' } }}
        className={s.select}
        defaultValue=""
      >
        <option value="" disabled>{t('project.setStatus')}</option>
        <option value="todo">{t('todo')}</option>
        <option value="in_progress">{t('inProgress')}</option>
        <option value="done">{t('done')}</option>
        <option value="failed">{t('failed')}</option>
      </select>
      <select
        onChange={e => { if (e.target.value) { onSetPriority(e.target.value); e.target.value = '' } }}
        className={s.select}
        defaultValue=""
      >
        <option value="" disabled>{t('project.setPriority')}</option>
        <option value="high">{t('high')}</option>
        <option value="medium">{t('medium')}</option>
        <option value="low">{t('low')}</option>
      </select>
      <button onClick={onPin} className={s.pinBtn}>{t('issue.pin')}</button>
      <button onClick={onClear} className={s.clearBtn}>{t('clear')}</button>
    </div>
  )
}
