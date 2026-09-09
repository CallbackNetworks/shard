import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp } from 'lucide-react'
import { getAncestry } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { nodeHref } from '../../utils/nodeHref'
import OverflowMenu from './OverflowMenu'
import s from './AncestryTrail.module.css'
import { useNodeTypeMap } from '../../hooks/useNodeTypeMap'

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
// `showOwners` is off in list rows. Both axes belong on a page about one node, but in a
// result list the trail is a locator and the owner strip is a second line per row —
// which, over a page of a hundred, is what turns a list into a scroll (ADR-0150).
//
// `self` is what separates the two modes (ADR-0156). Without it this is a *locator* on
// a row: it names ancestors and disappears when there are none, which is right, because
// a row already says what it is. With it this is the page's own **breadcrumb**, and the
// two differences follow from that:
//
//   - the subject is drawn at the tail. A path that stops one short of you is a row of
//     floating chips, not a path — the separator is what says "inside", and with nothing
//     after the last one it says it about nobody.
//   - it never renders nothing. "This node is a root" and "the trail has not arrived
//     yet" are different answers and a vanishing strip gives the same blank for both —
//     and takes the up control with it, on exactly the pages where going up is the act.
export default function AncestryTrail({
  nodeId,
  entry: given,
  className,
  maxTrails = MAX_TRAILS_SHOWN,
  showOwners = true,
  self = null,
}) {
  const { t } = useTranslation()
  const { data: ancestry, isLoading } = useQuery({
    queryKey: qk.ancestry(nodeId),
    queryFn: () => getAncestry([nodeId]),
    enabled: !!nodeId && !given,
    staleTime: 30000,
  })
  const typeByKey = useNodeTypeMap()

  const entry = given || ancestry?.[nodeId]
  const trails = entry?.trails || []
  const owners = showOwners ? entry?.owners || [] : []
  if (!self && trails.length === 0 && owners.length === 0) return null

  const shown = trails.slice(0, maxTrails)
  const hidden = trails.slice(maxTrails)

  // Up is one level, so it reads the *last* ref of each trail rather than the first —
  // and of every trail, not only the shown ones: capping what is drawn must not cap
  // where you can go. Deduped, because two trails meeting at one parent are one way up.
  const parents = []
  const seen = new Set()
  for (const trail of trails) {
    const parent = trail[trail.length - 1]
    if (parent && !seen.has(parent.id)) {
      seen.add(parent.id)
      parents.push(parent)
    }
  }

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

  // Page mode only: a list row is a locator, and one up control per row over a page of
  // a hundred is a hundred controls for an act nobody performs from a list.
  //
  // One parent is a link; several is a menu naming each of them. Picking the first of
  // several would send you somewhere silently — the trail is already drawn, so the one
  // thing the control must not do is disagree with it.
  const upControl = !self ? null : parents.length === 1 ? (
    <Link
      to={nodeHref(parents[0], typeByKey)}
      className={s.up}
      title={`${t('ancestry.up')}: ${parents[0].title || parents[0].id}`}
    >
      <ArrowUp size={11} />
      {t('ancestry.up')}
    </Link>
  ) : parents.length > 1 ? (
    <OverflowMenu
      icon={<ArrowUp size={11} />}
      text={t('ancestry.up')}
      label={t('ancestry.upAmong', { count: parents.length })}
      items={parents.map(p => ({
        key: p.id,
        label: p.title || p.id,
        href: nodeHref(p, typeByKey),
      }))}
    />
  ) : null

  const selfChip = self ? (
    <span className={s.self} aria-current="page">
      {self.title || t('nodePage.untitled')}
    </span>
  ) : null

  return (
    <div className={className}>
      {shown.map((trail, i) => (
        <nav key={i} className={s.trail} aria-label={t('ancestry.livesIn')}>
          {i === 0 && upControl}
          {trail.map((ref, j) => (
            <span key={ref.id} style={{ display: 'contents' }}>
              {j > 0 && <span className={s.sep}>›</span>}
              {chip(ref)}
            </span>
          ))}
          {self && <><span className={s.sep}>›</span>{selfChip}</>}
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
      {self && shown.length === 0 && (
        <nav className={s.trail} aria-label={t('ancestry.livesIn')}>
          {/* Said out loud rather than left blank, and only once the answer is in:
              while the request is still out, the subject alone is the honest strip. */}
          {!isLoading && <><span className={s.rootMark}>{t('ancestry.noParent')}</span><span className={s.sep}>›</span></>}
          {selfChip}
        </nav>
      )}
      {owners.length > 0 && (
        <div className={s.trail}>
          <span className={s.ownerLabel}>{t('ancestry.ownedBy')}</span>
          {owners.map(chip)}
        </div>
      )}
    </div>
  )
}
