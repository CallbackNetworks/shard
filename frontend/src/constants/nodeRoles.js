// Node-type capability roles (ADR-0040). The backend collapsed the four
// is_container/is_task_like/is_shareable/is_subscribable booleans into a single
// `roles` set; the UI reads and writes that set directly.

export const NODE_ROLE_DEFS = [
  { role: 'container', labelKey: 'graphTypes.roleContainer' },
  { role: 'task', labelKey: 'graphTypes.roleTask' },
  { role: 'shareable', labelKey: 'graphTypes.capShareable' },
  { role: 'subscribable', labelKey: 'graphTypes.capSubscribable' },
]

export const hasNodeRole = (nt, role) => Array.isArray(nt?.roles) && nt.roles.includes(role)

export const toggleNodeRole = (roles, role, on) => {
  const set = new Set(roles || [])
  if (on) set.add(role)
  else set.delete(role)
  return [...set]
}
