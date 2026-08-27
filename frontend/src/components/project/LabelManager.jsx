import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Tag, X } from 'lucide-react'
import { createLabel, deleteLabel } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { LABEL_PALETTE } from '../../constants/theme'
import s from './LabelManager.module.css'

export function LabelChip({ label, onRemove }) {
  return (
    <span className={s.labelChip} style={{ '--label-color': label.color }}>
      {label.name}
      {onRemove && (
        <button onClick={onRemove} className={s.labelChipRemoveBtn} style={{ color: label.color }}>
          <X size={10} />
        </button>
      )}
    </span>
  )
}

/**
 * A project's label vocabulary: the list, and the two writes that change it.
 * Labels are read all over the project page but only ever *written* from this
 * dropdown, so the writes live here rather than being declared on the page and
 * passed back down.
 */
export default function LabelManager({ labels, projectId }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(LABEL_PALETTE[0])
  const [open, setOpen] = useState(false)

  // Labels arrive inside the project payload, and the project list shows them
  // on its cards.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.project(projectId) })
    qc.invalidateQueries({ queryKey: qk.projects() })
  }

  const createLabelMut = useMutation({
    mutationFn: (data) => createLabel(projectId, data),
    onSuccess: invalidate,
  })

  const deleteLabelMut = useMutation({
    mutationFn: (labelId) => deleteLabel(projectId, labelId),
    onSuccess: invalidate,
  })

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className={s.labelManagerToggle}
      >
        <Tag size={12} /> {t('project.labelsCount', { count: labels.length })}
      </button>
      {open && (
        <div className={s.labelManagerDropdown}>
          <div className={s.labelManagerTitle}>{t('project.projectLabels')}</div>
          {labels.length === 0 && (
            <div className={s.labelManagerEmpty}>{t('project.noLabels')}</div>
          )}
          <div className={s.labelManagerList}>
            {labels.map(lb => (
              <span key={lb.id} className={s.labelManagerLabelChip} style={{
                background: lb.color + '22', color: lb.color, border: `1px solid ${lb.color}44`,
              }}>
                {lb.name}
                <button onClick={() => deleteLabelMut.mutate(lb.id)} className={s.labelManagerDeleteBtn} style={{ color: lb.color }}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className={s.labelManagerNewLabel}>{t('project.newLabel')}</div>
          <div className={s.labelManagerInputRow}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={t('project.labelName')}
              className={s.labelManagerInput}
            />
          </div>
          <div className={s.labelManagerPalette}>
            {LABEL_PALETTE.map(c => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={s.labelManagerColorBtn}
                style={{
                  background: c,
                  outline: newColor === c ? `2px solid ${c}` : '2px solid transparent',
                }}
              />
            ))}
          </div>
          <button
            disabled={!newName.trim()}
            onClick={() => { if (newName.trim()) { createLabelMut.mutate({ name: newName.trim(), color: newColor }); setNewName('') } }}
            className={s.labelManagerCreateBtn}
            style={{ opacity: newName.trim() ? 1 : 0.5 }}
          >
            {t('project.createLabel')}
          </button>
        </div>
      )}
    </div>
  )
}
