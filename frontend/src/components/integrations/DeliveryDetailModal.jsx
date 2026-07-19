import { useTranslation } from 'react-i18next'
import { DARK, DELIVERY_STATUS_COLORS } from '../../constants/theme'
import FormModal from '../shared/FormModal'
import s from './DeliveryDetailModal.module.css'

function Row({ label, value, mono, color }) {
  return (
    <div className={s.row}>
      <span className={s.rowLabel}>{label}</span>
      <span className={mono ? s.rowValueMono : s.rowValue} style={{ color: color || DARK.textMid }}>{String(value)}</span>
    </div>
  )
}

/** Full detail view for a single webhook delivery attempt. */
export default function DeliveryDetailModal({ delivery, onClose, onRetry }) {
  const { t } = useTranslation()
  return (
    <FormModal
      title="Delivery Detail"
      onClose={onClose}
      footer={(
        <div className={s.modalActions}>
          {['failed', 'dead'].includes(delivery.status) && (
            <button onClick={() => onRetry(delivery.id)} className="btn-primary">{t('retry')}</button>
          )}
          <button onClick={onClose} className="btn-ghost">{t('cancel')}</button>
        </div>
      )}
    >
      <div className={s.deliveryDetailBody}>
        <Row label="Event" value={delivery.event} />
        <Row label="Status" value={delivery.status} color={DELIVERY_STATUS_COLORS[delivery.status]?.color} />
        <Row label="Status Code" value={delivery.status_code ?? '—'} />
        <Row label="Attempt" value={delivery.attempt} />
        <Row label="URL" value={delivery.request_url} mono />
        <Row label="Created" value={new Date(delivery.created_at).toLocaleString()} />
        {delivery.delivered_at && <Row label="Delivered" value={new Date(delivery.delivered_at).toLocaleString()} />}
        {delivery.next_retry_at && <Row label="Next Retry" value={new Date(delivery.next_retry_at).toLocaleString()} />}
        {delivery.error && (
          <div>
            <div className={s.detailLabel}>Error</div>
            <pre className={s.errorPre}>{delivery.error}</pre>
          </div>
        )}
        {delivery.response_body && (
          <div>
            <div className={s.detailLabel}>Response Body</div>
            <pre className={s.responsePre}>{delivery.response_body}</pre>
          </div>
        )}
        <div>
          <div className={s.detailLabel}>Payload</div>
          <pre className={s.payloadPre}>{JSON.stringify(delivery.payload, null, 2)}</pre>
        </div>
      </div>
    </FormModal>
  )
}
