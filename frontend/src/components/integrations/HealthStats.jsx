import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { getIntegrationHealth } from '../../api/client'
import { BRAND } from '../../constants/theme'
import s from './HealthStats.module.css'

/** Success-rate / latency / last-success badge line for one integration. */
export default function HealthStats({ integrationId }) {
  const { t } = useTranslation()
  const { data: health } = useQuery({
    queryKey: ['integration-health', integrationId],
    queryFn: () => getIntegrationHealth(integrationId),
    staleTime: 60000,
  })
  if (!health || health.total_deliveries === 0) return null

  const rateColor = health.success_rate >= 90 ? BRAND : health.success_rate >= 50 ? '#f59e0b' : BRAND

  return (
    <div className={s.healthStats}>
      <span style={{ color: rateColor }}>
        <Activity size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
        {health.success_rate}% {t('integrations.successRate').toLowerCase()}
      </span>
      {health.avg_latency_ms != null && (
        <span className={s.healthLatency}>
          {health.avg_latency_ms}ms {t('integrations.avgLatency').toLowerCase()}
        </span>
      )}
      {health.last_success_at && (
        <span className={s.healthLastSuccess}>
          {t('integrations.lastSuccess')}: {new Date(health.last_success_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
        </span>
      )}
      {health.dead > 0 && (
        <span className={s.healthDead}>{health.dead} dead</span>
      )}
    </div>
  )
}
