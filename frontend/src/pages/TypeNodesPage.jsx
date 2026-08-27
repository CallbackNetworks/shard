import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Boxes, Plus } from 'lucide-react'
import { getNodes, getNodeTypes, createNode } from '../api/client'
import { qk } from '../api/queryKeys'
import { DARK } from '../constants/theme'
import { hasNodeRole } from '../constants/nodeRoles'
import EmptyState from '../components/shared/EmptyState'

// Thin per-type node listing (ADR-0037): the sidebar entry for a user-defined
// container type lands here; each row opens the container view.
export default function TypeNodesPage() {
  const { typeKey } = useParams()
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [newTitle, setNewTitle] = useState('')

  const { data: nodeTypes = [] } = useQuery({ queryKey: qk.nodeTypes(), queryFn: getNodeTypes, staleTime: 300000 })
  const { data: nodes = [], isLoading } = useQuery({ queryKey: qk.nodes(typeKey), queryFn: () => getNodes(typeKey) })

  const typeMeta = nodeTypes.find(nt => nt.key === typeKey)
  const color = typeMeta?.color || '#818cf8'
  const href = (n) => (hasNodeRole(typeMeta, 'container') ? `/c/${n.id}` : `/n/${n.id}`)

  const createMut = useMutation({
    mutationFn: () => createNode({ type: typeKey, title: newTitle.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.nodes(typeKey) }); setNewTitle('') },
  })

  return (
    <div className="kt-page">
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{typeMeta?.label || typeKey}</h1>
          <p className="kt-page-subtitle">{t('typeNodes.subtitle', { n: nodes.length })}</p>
        </div>
        <Boxes size={22} color={color} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, maxWidth: 480 }}>
        <input
          className="kt-input" style={{ flex: 1 }}
          placeholder={t('typeNodes.newPlaceholder')}
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && newTitle.trim()) createMut.mutate() }}
        />
        <button
          className="kt-btn kt-btn-primary"
          disabled={!newTitle.trim() || createMut.isPending}
          onClick={() => createMut.mutate()}
        >
          <Plus size={12} /> {t('typeNodes.add')}
        </button>
      </div>

      {isLoading ? (
        <div style={{ fontSize: 12, color: DARK.textDim }}>{t('loading')}</div>
      ) : nodes.length === 0 ? (
        <EmptyState message={t('typeNodes.empty')} hint={t('typeNodes.emptyHint')} />
      ) : (
        <div className="kt-card" style={{ padding: '4px 16px' }}>
          {nodes.map(n => (
            <Link
              key={n.id}
              to={href(n)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px',
                borderBottom: `1px solid ${DARK.border}`, textDecoration: 'none',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, color: DARK.text }}>
                {n.title || <em style={{ color: DARK.textDim }}>{t('nodePage.untitled')}</em>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
