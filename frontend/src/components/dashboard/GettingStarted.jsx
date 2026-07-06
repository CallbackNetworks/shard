import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import s from '../../pages/Dashboard.module.css'

/* ── Onboarding getting started ───────────────────────────────────── */
export default function GettingStarted({ onNewProject, isMobile }) {
  const { t } = useTranslation()

  const steps = [
    {
      num: 1,
      title: t('dashboard.step1Title'),
      desc: t('dashboard.step1Desc'),
      gradient: 'linear-gradient(135deg, #facc15, #eab308)',
      action: <button
        onClick={onNewProject}
        className={s.stepActionBtn}
      >
        <Plus size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
        {t('dashboard.newProject')}
      </button>,
    },
    {
      num: 2,
      title: t('dashboard.step2Title'),
      desc: t('dashboard.step2Desc'),
      gradient: 'linear-gradient(135deg, #facc15, #eab308)',
    },
    {
      num: 3,
      title: t('dashboard.step3Title'),
      desc: t('dashboard.step3Desc'),
      gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    },
    {
      num: 4,
      title: t('dashboard.step4Title'),
      desc: t('dashboard.step4Desc'),
      gradient: 'linear-gradient(135deg, #fde047, #ca8a04)',
    },
  ]

  return (
    <div className={s.gettingStartedWrap}>
      <div className={s.gettingStartedHeader}>
        <div className={s.gettingStartedTitle}>
          {t('dashboard.gettingStarted')}
        </div>
        <div className={s.gettingStartedSubtitle}>{t('dashboard.createFirstProject')}</div>
      </div>
      <div className={`${s.stepsGrid} ${isMobile ? s.stepsGridMobile : s.stepsGridDesktop}`}>
        {steps.map((step, i) => (
          <div
            key={step.num}
            className={s.stepCard}
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            <div className={s.stepNumber} style={{ background: step.gradient }}>
              {step.num}
            </div>
            <div className={s.stepTitle}>{step.title}</div>
            <div className={s.stepDesc}>{step.desc}</div>
            {step.action}
          </div>
        ))}
      </div>
    </div>
  )
}
