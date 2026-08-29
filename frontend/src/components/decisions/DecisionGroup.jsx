import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { nodeHref } from '../../utils/nodeHref'
import s from './DecisionGroup.module.css'

/**
 * One level of the containment hierarchy a decision lives in (ADR-0126).
 *
 * Recursive, because the hierarchy is: production files decisions under
 * `organization → project` and under `organization → project → repository`, and a
 * component that knew how deep it went would be the hardcoded three levels ADR-0069
 * had to take out of the structure map.
 *
 * The header is the whole hit area for open/close *and* carries a link to the container
 * itself, so the group says where you are and gets you there. The count is the number of
 * records below, summed through the subtree — the same "a container counts its whole
 * subtree" rule as ADR-0065, applied to decisions.
 */
export default function DecisionGroup({ group, depth = 0, isOpen, onToggle, typeByKey, renderLineage }) {
  const { t } = useTranslation()
  const open = isOpen(group.id)
  const href = group.ref ? nodeHref(group.ref, typeByKey) : null

  return (
    <div className={s.group} data-depth={depth} style={{ '--depth': Math.min(depth, 3) }}>
      <div className={s.head}>
        <button
          type="button"
          className={s.toggle}
          aria-expanded={open}
          onClick={() => onToggle(group.id)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className={s.type}>{group.ref?.type_label || group.ref?.type}</span>
          {/* A container's colour is arbitrary, so it goes in a dot and never in the
              text — the same rule `AncestryTrail` follows, and the reason is ADR-0088's:
              nothing guarantees a user-picked hue has contrast in either theme. */}
          {group.ref?.color && <span className={s.dot} style={{ background: group.ref.color }} />}
          <span className={s.name}>{group.ref?.title || t('decisions.unfiledGroup')}</span>
        </button>
        {href && (
          <Link to={href} className={s.open} title={group.ref.title}>{t('decisions.openContainer')}</Link>
        )}
        <b className={s.count}>{group.total}</b>
      </div>

      {open && (
        <div className={s.body}>
          {group.children.map(child => (
            <DecisionGroup
              key={child.id}
              group={child}
              depth={depth + 1}
              isOpen={isOpen}
              onToggle={onToggle}
              typeByKey={typeByKey}
              renderLineage={renderLineage}
            />
          ))}
          {group.lineages.map(renderLineage)}
        </div>
      )}
    </div>
  )
}
