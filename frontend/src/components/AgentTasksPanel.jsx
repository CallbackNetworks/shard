import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown, ChevronRight, Clock } from 'lucide-react'
import { getAgentSummary } from '../api/client'
import { DARK, STATUS_MAP } from '../constants/theme'
import { PriorityChip } from './TaskIcons'

function StatusBar({ counts }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) return null
  return (
    <div style={{ display: 'flex', height: 4, borderRadius: 9999, overflow: 'hidden', gap: 1, width: '100%' }}>
      {Object.entries(counts).map(([status, count]) => {
        if (!count) return null
        return (
          <div key={status} style={{
            flex: count,
            background: STATUS_MAP[status]?.color,
            minWidth: 4,
          }} title={`${status}: ${count}`} />
        )
      })}
    </div>
  )
}

function AgentCard({ agent, index }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const total = Object.values(agent.task_counts).reduce((a, b) => a + b, 0)
  const lastSeen = agent.last_used_at
    ? new Date(agent.last_used_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div style={{
      background: 'var(--kt-surface)',
      border: '1px solid rgba(var(--kt-ink-rgb), 0.08)',
      borderRadius: 10,
      padding: 14,
      animation: 'fadeUpIn 0.35s ease forwards',
      animationDelay: `${index * 0.07}s`,
      opacity: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: agent.active ? 'rgba(250,204,21,0.15)' : 'rgba(var(--kt-ink-rgb), 0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          border: `1px solid ${agent.active ? 'rgba(250,204,21,0.3)' : 'rgba(var(--kt-ink-rgb), 0.1)'}`,
        }}>
          <Bot size={14} color={agent.active ? DARK.info : '#6b7280'} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: DARK.text }}>{agent.agent_name}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 9999,
              background: agent.active ? 'rgba(250,204,21,0.1)' : 'rgba(var(--kt-ink-rgb), 0.05)',
              color: agent.active ? DARK.success : '#6b7280',
            }}>
              {agent.active ? t('agent.active') : t('agent.inactive')}
            </span>
            {total > 0 && (
              <span style={{ fontSize: 10, color: '#6b7280' }}>
                {t('agent.taskCount', { count: total })}
              </span>
            )}
          </div>
          <StatusBar counts={agent.task_counts} />
          {lastSeen && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 5, fontSize: 10, color: '#4b5563' }}>
              <Clock size={9} />
              {t('agent.lastSeen')}: {lastSeen}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {['todo', 'in_progress', 'done', 'failed'].map(s => {
            const count = agent.task_counts[s] || 0
            if (!count) return null
            return (
              <span key={s} style={{
                fontSize: 10, fontWeight: 600,
                padding: '1px 6px', borderRadius: 9999,
                background: (STATUS_MAP[s]?.color ?? '#6b7280') + '18', color: STATUS_MAP[s]?.color ?? '#6b7280',
              }}>
                {count}
              </span>
            )
          })}
          {total > 0 && (
            <button
              onClick={() => setExpanded(v => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 2 }}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
        </div>
      </div>

      {expanded && agent.tasks.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(var(--kt-ink-rgb), 0.06)' }}>
          {agent.tasks.map(task => {
            const sm = STATUS_MAP[task.status] || {}
            return (
              <div key={task.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 0',
                borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.04)',
              }}>
                <span style={{ fontSize: 10, color: sm.color, flexShrink: 0 }}>{sm.labelKey ? t(sm.labelKey) : task.status}</span>
                <span style={{ flex: 1, fontSize: 12, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {task.title}
                </span>
                <PriorityChip priority={task.priority} compact />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function AgentTasksPanel() {
  const { t } = useTranslation()
  const { data: agents = [], isLoading, isError } = useQuery({
    queryKey: ['agent-summary'],
    queryFn: getAgentSummary,
  })

  const relevant = agents.filter(a => a.active || Object.values(a.task_counts).some(c => c > 0))

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Bot size={14} color={DARK.info} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>{t('agent.workload')}</span>
      </div>
      {isLoading || isError || relevant.length === 0 ? (
        <div style={{
          border: '1px solid rgba(var(--kt-ink-rgb), 0.08)',
          background: 'rgba(var(--kt-ink-rgb), 0.018)',
          color: '#6b7280',
          fontSize: 12,
          padding: '18px 14px',
          textAlign: 'center',
        }}>
          {isLoading
            ? t('loading')
            : isError
            ? t('agent.noAgents')
            : t('agent.noTasks')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {relevant.map((agent, i) => (
            <AgentCard key={agent.agent_id} agent={agent} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
