import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell, Check, CheckCheck, X, AlertCircle, Clock, CheckCircle2, XCircle } from 'lucide-react'
import {
  getNotifications, getUnreadCount,
  markNotificationRead, markAllNotificationsRead, dismissNotification,
} from '../api/client'
import { DARK } from '../constants/theme'

const TYPE_ICON = {
  'task.done': <CheckCircle2 size={13} style={{ color: '#4ade80' }} />,
  'task.failed': <XCircle size={13} style={{ color: '#f87171' }} />,
  'task.due_soon': <Clock size={13} style={{ color: '#facc15' }} />,
  'task.overdue': <AlertCircle size={13} style={{ color: '#f97316' }} />,
  'project.complete': <CheckCheck size={13} style={{ color: '#818cf8' }} />,
}

function timeAgo(dateStr, t) {
  if (!dateStr) return ''
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000
  if (diff < 60) return t('notifications.justNow')
  if (diff < 3600) return t('notifications.minutesAgo', { n: Math.floor(diff / 60) })
  if (diff < 86400) return t('notifications.hoursAgo', { n: Math.floor(diff / 3600) })
  return t('notifications.daysAgo', { n: Math.floor(diff / 86400) })
}

export default function NotificationCenter() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const panelRef = useRef(null)

  const { data: countData } = useQuery({
    queryKey: ['notification-count'],
    queryFn: getUnreadCount,
    refetchInterval: 60000,
  })

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getNotifications({ limit: 30 }),
    enabled: open,
  })

  const unread = countData?.count || 0

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notification-count'] })
    },
  })

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notification-count'] })
    },
  })

  const dismiss = useMutation({
    mutationFn: dismissNotification,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notification-count'] })
    },
  })

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleClickNotif = (notif) => {
    if (!notif.read) markRead.mutate(notif.id)
    if (notif.link) {
      navigate(notif.link)
      setOpen(false)
    }
  }

  return (
    <div ref={panelRef} style={{ position: 'fixed', top: 14, right: 14, zIndex: 250 }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          position: 'relative',
          background: open ? 'rgba(255,255,255,0.1)' : DARK.hover,
          border: `1px solid ${DARK.border}`,
          borderRadius: '50%',
          width: 34, height: 34,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#9ca3af',
          transition: 'background 0.15s',
        }}
        title="Notifications"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: '#f87171', color: '#000',
            borderRadius: '50%', fontSize: 9, fontWeight: 700,
            width: 16, height: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid ${DARK.bg}`,
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'absolute', top: 40, right: 0,
          width: 340, maxHeight: 480,
          background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
          boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{t('notifications.title')}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {unread > 0 && (
                <button
                  onClick={() => markAll.mutate()}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.info, fontSize: 11, padding: '2px 6px', borderRadius: 4 }}
                  title={t('notifications.markAllRead')}
                >
                  <Check size={11} style={{ verticalAlign: 'middle' }} /> {t('notifications.markAllRead')}
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#4b5563' }}>
                <Bell size={24} style={{ marginBottom: 8, opacity: 0.3 }} />
                <div style={{ fontSize: 12 }}>{t('notifications.empty')}</div>
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => handleClickNotif(n)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    cursor: n.link ? 'pointer' : 'default',
                    background: n.read ? 'transparent' : 'rgba(129,140,248,0.05)',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(129,140,248,0.05)' }}
                >
                  <div style={{ marginTop: 2, flexShrink: 0 }}>
                    {TYPE_ICON[n.type] || <Bell size={13} style={{ color: '#6b7280' }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: n.read ? '#6b7280' : DARK.text, lineHeight: 1.4 }}>
                      {n.message}
                    </div>
                    <div style={{ fontSize: 10, color: '#4b5563', marginTop: 2 }}>{timeAgo(n.created_at, t)}</div>
                  </div>
                  {!n.read && (
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: DARK.info, flexShrink: 0, marginTop: 4 }} />
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); dismiss.mutate(n.id) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', padding: 2, flexShrink: 0 }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
