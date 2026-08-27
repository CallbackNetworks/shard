import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { updateProject } from '../../api/client'
import { qk } from '../../api/queryKeys'
import s from './AgentInstructionsPanel.module.css'

/**
 * The repo URL and the standing instructions an agent reads before working on
 * this project. Nothing else on the project page reads the draft, so the draft,
 * its dirty flag and the write all live here rather than in `ProjectDetail`.
 *
 * It takes `open` and hides itself instead of being mounted by the toggle,
 * because a half-typed instruction has to survive closing the panel — that is
 * what the page's `if (!dirty) reseed` on the toggle used to buy. The effect is
 * the other half of the same rule: a value saved from somewhere else lands in
 * the boxes, unless you are in the middle of writing over it.
 */
export default function AgentInstructionsPanel({ open, project }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [instructions, setInstructions] = useState(project.agent_instructions || '')
  const [repoUrl, setRepoUrl] = useState(project.repo_url || '')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (dirty) return
    setInstructions(project.agent_instructions || '')
    setRepoUrl(project.repo_url || '')
  }, [project.agent_instructions, project.repo_url, dirty])

  const saveMut = useMutation({
    mutationFn: () => updateProject(project.id, {
      agent_instructions: instructions || null,
      repo_url: repoUrl || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.project(project.id) })
      qc.invalidateQueries({ queryKey: qk.projects() })
      setDirty(false)
    },
  })

  if (!open) return null

  return (
    <div className="kt-inline-panel">
      <div className={s.title}>{t('project.agentInstructions')}</div>
      <div className={s.desc}>{t('project.agentInstructionsHint')}</div>
      <input
        type="text"
        value={repoUrl}
        onChange={e => { setRepoUrl(e.target.value); setDirty(true) }}
        placeholder={t('project.repoUrlPlaceholder')}
        className={`${s.textarea} ${s.repoInput}`}
      />
      <textarea
        value={instructions}
        onChange={e => { setInstructions(e.target.value); setDirty(true) }}
        placeholder={t('project.agentInstrPlaceholder')}
        rows={4}
        className={s.textarea}
      />
      {dirty && (
        <div className={s.actions}>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className={s.saveBtn}
          >
            {saveMut.isPending ? t('saving') : t('save')}
          </button>
          <button onClick={() => setDirty(false)} className={s.cancelBtn}>
            {t('cancel')}
          </button>
        </div>
      )}
    </div>
  )
}
