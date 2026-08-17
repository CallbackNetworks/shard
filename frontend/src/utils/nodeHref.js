import { hasNodeRole } from '../constants/nodeRoles'

// One rule for "where does this node open" (ADR-0094). Entity types with a richer
// dedicated page keep it; container-role types get the container view; everything
// else lands on the universal node page. It lives here rather than in NodePage
// because the ancestry strip links the same nodes from every page.
export function nodeHref(ref, typeByKey) {
  if (!ref) return '/'
  if (ref.type === 'project') return `/projects/${ref.id}`
  if (hasNodeRole(typeByKey?.get(ref.type), 'container')) return `/c/${ref.id}`
  return `/n/${ref.id}`
}
