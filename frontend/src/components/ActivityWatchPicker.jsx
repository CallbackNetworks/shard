import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { getNodeTypes } from '../api/client'
import { qk } from '../api/queryKeys'
import NodeCombobox from './shared/NodeCombobox'

// The "+" affordance on the activity ticker's bottom bar (ADR-0105): pick a node to
// watch by searching (any type, via NodeCombobox / GET /nodes) or a node type from
// the registry, each becoming its own curve on the chart above.
export default function ActivityWatchPicker({ onAddNode, onAddType, excludeNodeIds = [] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('node')
  const [typePick, setTypePick] = useState('')
  const rootRef = useRef(null)

  const { data: nodeTypes = [] } = useQuery({ queryKey: qk.nodeTypes(), queryFn: getNodeTypes, staleTime: 300000 })

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const handleNode = (node) => {
    onAddNode(node)
    setOpen(false)
  }

  const handleType = () => {
    if (!typePick) return
    const nt = nodeTypes.find(n => n.key === typePick)
    onAddType(typePick, nt?.label)
    setTypePick('')
    setOpen(false)
  }

  return (
    <div className="kt-watch-add-wrap" ref={rootRef}>
      <button type="button" className="kt-watch-add" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Plus size={10} /> {t('ticker.watchAdd')}
      </button>
      {open && (
        <div className="kt-watch-popover" role="dialog" aria-label={t('ticker.watchAdd')}>
          <div className="kt-watch-popover-tabs">
            <button
              type="button"
              className={`kt-watch-popover-tab${tab === 'node' ? ' active' : ''}`}
              onClick={() => setTab('node')}
            >
              {t('ticker.watchAddNode')}
            </button>
            <button
              type="button"
              className={`kt-watch-popover-tab${tab === 'type' ? ' active' : ''}`}
              onClick={() => setTab('type')}
            >
              {t('ticker.watchAddType')}
            </button>
          </div>
          {tab === 'node' ? (
            <NodeCombobox excludeIds={excludeNodeIds} onSelect={handleNode} autoFocus />
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                className="kt-input"
                style={{ flex: 1 }}
                value={typePick}
                onChange={e => setTypePick(e.target.value)}
                aria-label={t('ticker.watchPickType')}
              >
                <option value="">{t('ticker.watchPickType')}</option>
                {nodeTypes.map(nt => (
                  <option key={nt.key} value={nt.key}>{nt.label}</option>
                ))}
              </select>
              <button type="button" className="kt-watch-add" onClick={handleType} disabled={!typePick}>
                {t('ticker.watchAdd')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
