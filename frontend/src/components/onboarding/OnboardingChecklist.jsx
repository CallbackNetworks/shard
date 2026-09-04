import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { Check, ChevronRight, X, BookOpen } from 'lucide-react'
import { getWorkflowRules, getIntegrations, getPreference, setPreference } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { CHECKLIST_STEPS, deriveChecklist } from './checklistState'
import s from './OnboardingChecklist.module.css'

const PREF_KEY = 'onboarding-dismissed'

/**
 * How far into the product the reader has got (ADR-0148).
 *
 * This replaces `GettingStarted`, which was four cards of static text shown *only*
 * while there were zero projects — so it disappeared the instant you did the first
 * step and never mentioned any of the others. The five things that actually make
 * this product worth using over a list app (due dates, structure, decisions,
 * automation) were introduced by nothing at all.
 *
 * It is derived from live data, so it cannot congratulate you for work you have
 * since deleted, and it disappears on its own when complete.
 */
export default function OnboardingChecklist({ projects = [], decisions = [] }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: rules = [] } = useQuery({ queryKey: qk.workflowRules(), queryFn: () => getWorkflowRules(), staleTime: 60000 })
  const { data: integrations = [] } = useQuery({ queryKey: qk.integrations(), queryFn: getIntegrations, staleTime: 60000 })
  const { data: dismissed } = useQuery({
    queryKey: qk.preference(PREF_KEY),
    queryFn: () => getPreference(PREF_KEY),
    staleTime: 300000,
  })

  const state = deriveChecklist({ projects, decisions, rules, integrations })

  const dismiss = () => {
    setPreference(PREF_KEY, { dismissed: true }).catch(() => {})
    qc.setQueryData(qk.preference(PREF_KEY), { value: { dismissed: true } })
  }

  // Finished is its own dismissal — a panel reading "6 of 6" is a panel asking to be
  // closed, and asking somebody to close a congratulation is a small rudeness.
  if (state.allDone || dismissed?.value?.dismissed) return null

  const pct = Math.round((state.completed / state.total) * 100)

  return (
    <section className={s.root} aria-label={t('onboarding.title')}>
      <header className={s.header}>
        <div className={s.headings}>
          <h2 className={s.title}>{t('onboarding.title')}</h2>
          <p className={s.subtitle}>{t('onboarding.subtitle')}</p>
        </div>
        <div className={s.headerRight}>
          <Link to="/guide" className={s.guideLink}>
            <BookOpen size={13} />
            {t('onboarding.readGuide')}
          </Link>
          <button type="button" className={s.dismiss} onClick={dismiss} aria-label={t('onboarding.dismiss')} title={t('onboarding.dismiss')}>
            <X size={14} />
          </button>
        </div>
      </header>

      <div className={s.meter}>
        <div className={s.meterFill} style={{ width: `${pct}%` }} />
      </div>
      <div className={s.count}>{t('onboarding.progress', { done: state.completed, total: state.total })}</div>

      <ol className={s.steps}>
        {CHECKLIST_STEPS.map(step => {
          const isDone = state.done[step.id]
          const isNext = state.next?.id === step.id
          const body = (
            <>
              <span className={isDone ? `${s.mark} ${s.markDone}` : s.mark} aria-hidden="true">
                {isDone ? <Check size={11} /> : null}
              </span>
              <span className={s.stepText}>
                <span className={isDone ? `${s.stepLabel} ${s.stepLabelDone}` : s.stepLabel}>{t(step.labelKey)}</span>
                {/* The hint is shown only on the step you are actually on. Six hints
                    at once is a paragraph, and a paragraph is not a checklist. */}
                {isNext && <span className={s.stepHint}>{t(step.hintKey)}</span>}
              </span>
              {isNext && step.to && <ChevronRight size={14} className={s.stepArrow} />}
            </>
          )
          // Only the outstanding step with a destination is a control. A done step
          // is a statement, and a later step is not yet an instruction.
          return isNext && step.to ? (
            <li key={step.id} className={`${s.step} ${s.stepNext}`}>
              <button type="button" className={s.stepBtn} onClick={() => navigate(step.to)}>{body}</button>
            </li>
          ) : (
            <li key={step.id} className={isNext ? `${s.step} ${s.stepNext}` : s.step}>{body}</li>
          )
        })}
      </ol>
    </section>
  )
}
