import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { X } from 'lucide-react'
import { getNodeTypes } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { hasNodeRole } from '../../constants/nodeRoles'
import FormModal from '../shared/FormModal'
import NodeCombobox from '../shared/NodeCombobox'
import s from './GovernPicker.module.css'

/**
 * Pick the work a decision decides (`governs`, ADR-0118).
 *
 * The relation's declared targets are the task-like and container-like types, so the
 * picker filters by *role* rather than by a list of type keys — a custom type carrying
 * the `task` role is a task everywhere (ADR-0090), and this picker is one of the
 * everywheres. The server enforces the same rule on `add_edge` (ADR-0078); filtering
 * here is so the refusal is not how the user finds out.
 */
export default function GovernPicker({ decision, onPick, onDrop, onClose }) {
  const { t } = useTranslation()
  const { data: nodeTypes = [] } = useQuery({ queryKey: qk.nodeTypes(), queryFn: getNodeTypes, staleTime: 300000 })

  const eligible = useMemo(() => {
    const keys = new Set(nodeTypes
      .filter(nt => hasNodeRole(nt, 'task') || hasNodeRole(nt, 'container'))
      .map(nt => nt.key))
    return (node) => keys.size === 0 || keys.has(node.type)
  }, [nodeTypes])

  const governs = decision.governs || []

  return (
    <FormModal
      title={t('decisions.governTitle', { name: decision.name })}
      onClose={onClose}
      onSubmit={onClose}
      submitLabel={t('close')}
    >
      <div className="kt-page-subtitle" style={{ marginBottom: 10 }}>{t('decisions.governHint')}</div>

      {governs.length > 0 && (
        <div className={s.current}>
          {governs.map(n => (
            <span key={n.id} className={s.chip}>
              <Link to={`/n/${n.id}`} className={s.chipName}>{n.title}</Link>
              <em>{n.type}</em>
              <button type="button" aria-label={t('decisions.ungovern', { name: n.title })} onClick={() => onDrop(n)}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <NodeCombobox
        autoFocus
        placeholder={t('decisions.governPlaceholder')}
        filter={eligible}
        excludeIds={[decision.id, ...governs.map(n => n.id)]}
        onSelect={onPick}
      />
    </FormModal>
  )
}
