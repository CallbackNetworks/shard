import { useMemo } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { getAncestry, getNodeTypes } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { nodeHref } from '../../utils/nodeHref'
import s from './AncestryTrail.module.css'

// The one strip that says where a node lives (ADR-0094). Every page that shows a
// single node shows it through this component — a project page, a container page and
// the universal node page were all drawing their subject as if it were a root, which
// is why an identity reached the screen only as a colour.
//
// Trails come from the server root-first; ownership stays on its own axis (ADR-0078)
// and is labelled instead of chained, so it can never read as one more level.

const MAX_TRAILS_SHOWN = 2

// A page showing one node fetches its own trail; a page showing a *list* fetches the
// whole list in one request (`useAncestry`) and hands each row its entry, because one
// request per row is how a list ends up not asking at all — the reason the endpoint is
// batched in the first place.
export default function AncestryTrail({ nodeId, entry: given, className, maxTrails = MAX_TRAILS_SHOWN }) {
  const { t } = useTranslation()
  const { data: ancestry } = useQuery({
    queryKey: qk.ancestry(nodeId),
    queryFn: () => getAncestry([nodeId]),
    enabled: !!nodeId && !given,
    staleTime: 30000,
  })
  const { data: nodeTypes = [] } = useQuery({ queryKey: qk.nodeTypes(), queryFn: getNodeTypes, staleTime: 300000 })
  const typeByKey = useMemo(() => new Map(nodeTypes.map(nt => [nt.key, nt])), [nodeTypes])

  const entry = given || ancestry?.[nodeId]
  const trails = entry?.trails || []
  const owners = entry?.owners || []
  if (trails.length === 0 && owners.length === 0) return null

  const shown = trails.slice(0, maxTrails)
  const hidden = trails.slice(maxTrails)

  const chip = (ref) => (
    <Link
      key={ref.id}
      to={nodeHref(ref, typeByKey)}
      className={s.chip}
      title={`${ref.type_label}: ${ref.title || ref.id}`}
    >
      {ref.color && <span className={s.dot} style={{ background: ref.color }} />}
      {ref.title || ref.id}
    </Link>
  )

  return (
    <div className={className}>
      {shown.map((trail, i) => (
        <nav key={i} className={s.trail} aria-label={t('ancestry.livesIn')}>
          {trail.map((ref, j) => (
            <span key={ref.id} style={{ display: 'contents' }}>
              {j > 0 && <span className={s.sep}>›</span>}
              {chip(ref)}
            </span>
          ))}
          {i === shown.length - 1 && hidden.length > 0 && (
            <span
              className={s.more}
              title={hidden.map(tr => tr.map(r => r.title).join(' › ')).join('\n')}
            >
              {t('ancestry.alsoIn', { count: hidden.length })}
            </span>
          )}
        </nav>
      ))}
      {owners.length > 0 && (
        <div className={s.trail}>
          <span className={s.ownerLabel}>{t('ancestry.ownedBy')}</span>
          {owners.map(chip)}
        </div>
      )}
    </div>
  )
}
