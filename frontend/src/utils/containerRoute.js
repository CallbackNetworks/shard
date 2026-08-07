// Where a container opens (ADR-0065). One list, because containers are now linked
// from several places (structure map, sub-container panels) and a wrong guess sends
// the user to a 404 page route.
//
// `project` and `goal` keep their richer dedicated pages; every other container type
// — user-defined ones today — opens the generic ContainerView, which works for any
// node carrying the container role, so no registry lookup is needed here.
export function containerRoute(id, typeKey) {
  if (typeKey === 'goal') return '/goals'
  if (typeKey === 'project') return `/projects/${id}`
  return `/c/${id}`
}
