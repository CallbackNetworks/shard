import { useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  getProjects, addTaskMembership, removeTaskMembership,
  getNodeTypes, getNode, attachNodeEdge, detachNodeEdge,
} from '../api/client'
import NodeCombobox from './shared/NodeCombobox'

// Cross-project membership management (ADR-0032): a task can belong to multiple
// projects via graph contains edges. ``projectId`` is the project this row is
// viewed from; other memberships can be added/removed from here. Custom
// containers (ADR-0034/0037) get their own section below the project chips,
// managed through the generic node-edge API.
export default function MembershipPanel({ projectId, task, depth = 0 }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [pick, setPick] = useState('')

  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: getProjects })
  const { data: nodeTypes = [] } = useQuery({ queryKey: ['node-types'], queryFn: getNodeTypes, staleTime: 300000 })
  const nameOf = (id) => projects.find(p => p.id === id)?.name || id.slice(-8)

  const memberships = task.project_ids || []
  const invalidate = () => qc.invalidateQueries({ queryKey: ['project', projectId] })

  // Custom containers: container_ids minus project memberships (ADR-0034 keeps
  // compat project fields literal-project; custom containers only appear here).
  const containerTypes = nodeTypes.filter(nt => nt.is_container && nt.key !== 'project')
  const containerTypeKeys = new Set(containerTypes.map(nt => nt.key))
  const extraContainers = (task.container_ids || []).filter(cid => !memberships.includes(cid))
  const containerNodes = useQueries({
    queries: extraContainers.map(cid => ({ queryKey: ['node', cid], queryFn: () => getNode(cid), staleTime: 60000 })),
  })

  const handleLinkContainer = async (node) => {
    await attachNodeEdge(node.id, { target_id: task.id, rel_type: 'contains' })
    invalidate()
    qc.invalidateQueries({ queryKey: ['contained-tasks', node.id] })
  }
  const handleUnlinkContainer = async (cid) => {
    await detachNodeEdge(cid, task.id, 'contains')
    invalidate()
    qc.invalidateQueries({ queryKey: ['contained-tasks', cid] })
  }

  const handleAdd = async () => {
    const target = pick.trim()
    if (!target) return
    await addTaskMembership(projectId, task.id, target)
    setPick('')
    invalidate()
  }

  const handleRemove = async (target) => {
    await removeTaskMembership(projectId, task.id, target)
    invalidate()
  }

  const padLeft = 16 + depth * 20 + 36
  const linkable = projects.filter(p => p.id !== projectId && !memberships.includes(p.id))

  return (
    <div style={{
      paddingLeft: padLeft, paddingRight: 16,
      paddingTop: 10, paddingBottom: 12,
      borderBottom: '1px solid rgba(var(--kt-ink-rgb), 0.07)',
      background: 'rgba(var(--kt-ink-rgb), 0.02)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(var(--kt-ink-rgb), 0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {t('membership.title')}
      </div>
      {memberships.length <= 1 ? (
        <div style={{ fontSize: 12, color: 'rgba(var(--kt-ink-rgb), 0.2)', marginBottom: 8 }}>{t('membership.onlyHere')}</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {memberships.map(pid => {
            const isCurrent = pid === projectId
            return (
              <span key={pid} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.25)', color: '#818cf8' }}>
                {nameOf(pid)}{isCurrent ? ` (${t('membership.thisProject')})` : ''}
                {/* No primary (ADR-0032): any membership can be unlinked, incl. the
                    current project, as long as it is not the last one. */}
                <button aria-label={`unlink ${nameOf(pid)}`} onClick={() => handleRemove(pid)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#818cf8', padding: 0, display: 'flex' }}>
                  <X size={9} />
                </button>
              </span>
            )
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          value={pick}
          onChange={e => setPick(e.target.value)}
          style={{ flex: 1, padding: '4px 8px', border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 5, fontSize: 11, background: 'rgba(var(--kt-ink-rgb), 0.05)', color: 'var(--kt-ink)', outline: 'none' }}
        >
          <option value="">{t('membership.pickProject')}</option>
          {linkable.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button onClick={handleAdd} disabled={!pick} style={{ padding: '4px 14px', border: 'none', borderRadius: 9999, background: '#818cf8', color: '#000', fontSize: 11, cursor: 'pointer', fontWeight: 700, opacity: pick ? 1 : 0.4, textTransform: 'uppercase', letterSpacing: '1px' }}>{t('membership.link')}</button>
      </div>

      {(containerTypeKeys.size > 0 || extraContainers.length > 0) && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(var(--kt-ink-rgb), 0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {t('membership.containers')}
          </div>
          {extraContainers.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {extraContainers.map((cid, i) => {
                const node = containerNodes[i]?.data
                const nt = nodeTypes.find(x => x.key === node?.type)
                const color = nt?.color || '#818cf8'
                const label = node?.title || cid.slice(-8)
                return (
                  <span key={cid} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: `${color}1a`, border: `1px solid ${color}40`, color }}>
                    {nt && <b style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4 }}>{nt.label}</b>}
                    {label}
                    <button aria-label={`unlink container ${label}`} onClick={() => handleUnlinkContainer(cid)} style={{ background: 'none', border: 'none', cursor: 'pointer', color, padding: 0, display: 'flex' }}>
                      <X size={9} />
                    </button>
                  </span>
                )
              })}
            </div>
          )}
          {containerTypeKeys.size > 0 && (
            <NodeCombobox
              placeholder={t('membership.linkContainer')}
              filter={n => containerTypeKeys.has(n.type)}
              excludeIds={[task.id, ...extraContainers]}
              onSelect={handleLinkContainer}
            />
          )}
        </div>
      )}
    </div>
  )
}
