import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, RefreshCw, RotateCcw } from 'lucide-react'
import { getDeliveries, getIntegrationEvents, retryDelivery, bulkRetryDeliveries } from '../../api/client'
import { globalAddToast } from '../../context/ToastContext'
import { BRAND, DELIVERY_STATUS_COLORS } from '../../constants/theme'
import { useInvalidatingMutation } from '../../hooks/useCrudMutations'
import DeliveryDetailModal from './DeliveryDetailModal'
import s from './DeliveryLog.module.css'

/** Collapsible recent-deliveries log with filters, retry, and detail modal. */
export default function DeliveryLog({ integrationId }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState(null)
  const [filterEvent, setFilterEvent] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  // The same list the subscription checkboxes use (ADR-0047). It was a hardcoded copy,
  // which drifts by construction: the served list also carries the custom events a
  // rule's fire_event emits (ADR-0048), so a subscribable event was unfilterable here.
  const { data: filterEvents = [] } = useQuery({
    queryKey: ['integration-events'],
    queryFn: getIntegrationEvents,
    enabled: expanded,
    staleTime: Infinity,
  })

  const { data: deliveries = [], refetch } = useQuery({
    queryKey: ['deliveries', integrationId, filterEvent, filterStatus],
    queryFn: () => getDeliveries(integrationId, {
      ...(filterEvent ? { event: filterEvent } : {}),
      ...(filterStatus ? { status: filterStatus } : {}),
    }),
    enabled: expanded,
    staleTime: 10000,
  })

  const retryMut = useInvalidatingMutation({
    mutationFn: retryDelivery,
    invalidateKeys: [['deliveries', integrationId]],
    onSuccess: () => setSelected(null),
  })

  const bulkRetryMut = useInvalidatingMutation({
    mutationFn: () => bulkRetryDeliveries(integrationId),
    invalidateKeys: [['deliveries', integrationId], ['integration-health', integrationId]],
    onSuccess: (data) => {
      globalAddToast(t('integrations.bulkRetryResult', data), 'info')
    },
  })

  const hasFailures = deliveries.some(d => ['failed', 'dead'].includes(d.status))

  return (
    <div className={s.deliveryLogWrapper}>
      <button
        onClick={() => setExpanded(v => !v)}
        className={s.deliveryToggleBtn}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t('integrations.recentDeliveries')}
        <button
          onClick={(e) => { e.stopPropagation(); refetch() }}
          className={s.refreshBtn}
          title="Refresh"
        >
          <RefreshCw size={10} />
        </button>
      </button>

      {expanded && (
        <div className={s.deliveryContent}>
          {/* Filters Row */}
          <div className={s.filtersRow}>
            <select value={filterEvent} onChange={e => setFilterEvent(e.target.value)}
              className={s.filterSelect}>
              <option value="">{t('integrations.allEvents')}</option>
              {filterEvents.map(ev => <option key={ev} value={ev}>{ev}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className={s.filterSelect}>
              <option value="">{t('integrations.allStatuses')}</option>
              {['success', 'failed', 'dead', 'pending'].map(st => <option key={st} value={st}>{st}</option>)}
            </select>
            {hasFailures && (
              <button onClick={() => bulkRetryMut.mutate()} disabled={bulkRetryMut.isPending}
                className={s.bulkRetryBtn} style={{ color: BRAND }}>
                <RotateCcw size={10} /> {t('integrations.bulkRetry')}
              </button>
            )}
          </div>

          {deliveries.length === 0 ? (
            <div className={s.noDeliveries}>{t('integrations.noDeliveries')}</div>
          ) : (
            <div className={s.deliveryList}>
              {deliveries.slice(0, 20).map(d => {
                const sc = DELIVERY_STATUS_COLORS[d.status] || DELIVERY_STATUS_COLORS.pending
                return (
                  <div key={d.id} onClick={() => setSelected(d)}
                    className={s.deliveryRow}>
                    <span className={s.deliveryDot} style={{ background: sc.dot }} />
                    <span className={s.deliveryEvent}>{d.event}</span>
                    <span className={s.deliveryStatusCode} style={{ color: sc.color }}>{d.status_code ?? d.status}</span>
                    <span className={s.deliveryDate}>
                      {new Date(d.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {['failed', 'dead'].includes(d.status) && (
                      <button onClick={(e) => { e.stopPropagation(); retryMut.mutate(d.id) }}
                        className={s.retryBtn}>
                        {t('retry')}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {selected && (
        <DeliveryDetailModal delivery={selected} onClose={() => setSelected(null)} onRetry={(id) => retryMut.mutate(id)} />
      )}
    </div>
  )
}
