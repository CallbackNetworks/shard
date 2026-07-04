import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RefreshCw, ChevronDown, ChevronUp, ScrollText, Trash2 } from 'lucide-react'
import { getAllDeliveries, getIntegrations, retryDelivery, purgeDeliveries } from '../api/client'
import { DARK, STATUS_COLOR } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'

const STATUS_COLORS = {
  success: STATUS_COLOR.done,
  failed: STATUS_COLOR.failed,
  dead: '#6b7280',
  pending: STATUS_COLOR.in_progress,
}

function DeliveryRow({ delivery, integrationMap, isMobile }) {
  const [expanded, setExpanded] = useState(false)
  const qc = useQueryClient()
  const { t } = useTranslation()

  const retry = useMutation({
    mutationFn: () => retryDelivery(delivery.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['all-deliveries'] }),
  })

  const integration = integrationMap[delivery.integration_id]
  const ts = delivery.delivered_at || delivery.created_at

  return (
    <>
      <tr
        onClick={() => setExpanded(v => !v)}
        style={{ cursor: 'pointer', background: expanded ? 'rgba(255,255,255,0.02)' : 'transparent' }}
      >
        <td style={tdStyle}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 9999,
            background: `${STATUS_COLORS[delivery.status] || '#6b7280'}22`,
            color: STATUS_COLORS[delivery.status] || '#6b7280',
          }}>
            {delivery.status}
          </span>
        </td>
        <td style={tdStyle}>{delivery.event}</td>
        <td style={{ ...tdStyle, color: '#9ca3af' }}>{integration?.name || delivery.integration_id.slice(0, 8)}</td>
        <td style={{ ...tdStyle, textAlign: 'center' }}>{delivery.status_code || '—'}</td>
        <td style={{ ...tdStyle, textAlign: 'center' }}>{delivery.attempt}</td>
        <td style={{ ...tdStyle, color: '#6b7280', whiteSpace: 'nowrap', fontSize: 11 }}>
          {ts ? new Date(ts).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
        </td>
        <td style={{ ...tdStyle, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
          {['failed', 'dead'].includes(delivery.status) && (
            <button
              onClick={() => retry.mutate()}
              disabled={retry.isPending}
              className="kt-btn"
              style={{ padding: '4px 10px' }}
            >
              <RefreshCw size={10} />
              {retry.isPending ? t('retrying') : t('retry')}
            </button>
          )}
          {expanded ? <ChevronUp size={12} style={{ marginLeft: 8, color: '#6b7280' }} /> : <ChevronDown size={12} style={{ marginLeft: 8, color: '#6b7280' }} />}
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
          <td colSpan={7} style={{ padding: '8px 16px 16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>{t('webhookLogs.requestUrl')}</div>
                <div style={{ fontSize: 11, color: '#9ca3af', wordBreak: 'break-all' }}>{delivery.request_url}</div>
              </div>
              {delivery.error && (
                <div>
                  <div style={{ fontSize: 10, color: DARK.danger, marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>{t('error')}</div>
                  <div style={{ fontSize: 11, color: DARK.danger }}>{delivery.error}</div>
                </div>
              )}
              {delivery.response_body && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>{t('webhookLogs.responseBody')}</div>
                  <pre style={{
                    fontSize: 11, color: '#9ca3af', background: 'rgba(0,0,0,0.3)',
                    padding: 8, overflow: 'auto', maxHeight: 120, margin: 0,
                  }}>{delivery.response_body}</pre>
                </div>
              )}
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>{t('webhookLogs.payload')}</div>
                <pre style={{
                  fontSize: 11, color: '#9ca3af', background: 'rgba(0,0,0,0.3)',
                  padding: 8, overflow: 'auto', maxHeight: 150, margin: 0,
                }}>{JSON.stringify(delivery.payload, null, 2)}</pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

const tdStyle = {
  padding: '8px 12px', fontSize: 12, color: DARK.text,
  borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'middle',
}

const thStyle = {
  padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)',
  background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)',
  textAlign: 'left', whiteSpace: 'nowrap',
}

export default function WebhookLogs() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const [statusFilter, setStatusFilter] = useState('')
  const [integrationFilter, setIntegrationFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const limit = 50

  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations'],
    queryFn: getIntegrations,
  })

  const integrationMap = Object.fromEntries(integrations.map(i => [i.id, i]))

  const { data: deliveries = [], isLoading, refetch } = useQuery({
    queryKey: ['all-deliveries', statusFilter, integrationFilter, offset],
    queryFn: () => getAllDeliveries({
      ...(statusFilter && { status: statusFilter }),
      ...(integrationFilter && { integration_id: integrationFilter }),
      limit,
      offset,
    }),
  })

  const purge = useMutation({
    mutationFn: () => purgeDeliveries(30),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['all-deliveries'] }),
  })

  return (
    <div className="kt-page" style={{ maxWidth: 1100 }}>
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('webhookLogs.title')}</h1>
          <div className="kt-page-subtitle">{t('webhookLogs.subtitle')}</div>
        </div>
        <div className="kt-toolbar">
          <button onClick={() => refetch()} className="kt-btn">
            <RefreshCw size={12} /> Refresh
          </button>
          <button
            onClick={() => { if (window.confirm(t('webhookLogs.purgeConfirm'))) purge.mutate() }}
            className="kt-btn kt-btn-danger"
          >
            <Trash2 size={12} /> {t('webhookLogs.purgeOld')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setOffset(0) }} className="kt-input" style={{ width: 'auto' }}>
          <option value="">{t('webhookLogs.allStatuses')}</option>
          <option value="success">{t('success')}</option>
          <option value="failed">{t('failed')}</option>
          <option value="dead">{t('webhookLogs.dead')}</option>
          <option value="pending">{t('pending')}</option>
        </select>
        <select value={integrationFilter} onChange={e => { setIntegrationFilter(e.target.value); setOffset(0) }} className="kt-input" style={{ width: 'auto' }}>
          <option value="">{t('webhookLogs.allIntegrations')}</option>
          {integrations.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="kt-panel" style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#4b5563', fontSize: 13 }}>Loading...</div>
        ) : deliveries.length === 0 ? (
          <div className="kt-empty">
            <ScrollText size={32} className="kt-empty-icon" />
            <div className="kt-empty-title">{t('webhookLogs.noDeliveries')}</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('status')}</th>
                  <th style={thStyle}>{t('event')}</th>
                  <th style={thStyle}>{t('webhookLogs.integration')}</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>{t('webhookLogs.httpCode')}</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>{t('webhookLogs.attempts')}</th>
                  <th style={thStyle}>{t('time')}</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map(d => (
                  <DeliveryRow key={d.id} delivery={d} integrationMap={integrationMap} isMobile={isMobile} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {(deliveries.length === limit || offset > 0) && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} className="kt-btn">
            {t('previous')}
          </button>
          <span style={{ fontSize: 12, color: '#6b7280', padding: '6px 12px' }}>
            {offset + 1}–{offset + deliveries.length}
          </span>
          <button onClick={() => setOffset(offset + limit)} disabled={deliveries.length < limit} className="kt-btn">
            {t('next')}
          </button>
        </div>
      )}
    </div>
  )
}
