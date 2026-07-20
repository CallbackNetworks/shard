import { STATUS_COLOR } from '../../constants/theme'

export function riskColor(risk) {
  if (risk === 'failed' || risk === 'overdue') return STATUS_COLOR.failed
  if (risk === 'active' || risk === 'priority') return STATUS_COLOR.in_progress
  return STATUS_COLOR.todo
}

export function taskWeight(task) {
  const riskScore = {
    failed: 90,
    overdue: 80,
    priority: 70,
    active: 60,
    normal: 10,
  }[task.risk] || 10
  return riskScore + (task.blockedBy?.length || 0) * 12 + (task.blocking?.length || 0) * 10
}

export function resolveOverlaps(items, minGap) {
  if (items.length <= 1) return
  items.sort((a, b) => a.y - b.y)
  for (let i = 1; i < items.length; i++) {
    const minY = items[i - 1].y + items[i - 1].h + minGap
    if (items[i].y < minY) items[i].y = minY
  }
}

export function computePath(from, to, linkType) {
  const fromCy = from.y + from.h / 2
  const toCy = to.y + to.h / 2
  const dx = (to.x + to.w / 2) - (from.x + from.w / 2)

  if (linkType === 'dependency') {
    const x1 = from.x + from.w
    const x2 = to.x + to.w
    const arc = 28 + Math.abs(toCy - fromCy) * 0.1
    return `M ${x1} ${fromCy} C ${x1 + arc} ${fromCy}, ${x2 + arc} ${toCy}, ${x2} ${toCy}`
  }

  if (Math.abs(dx) > 80) {
    const goRight = dx > 0
    const x1 = goRight ? from.x + from.w : from.x
    const x2 = goRight ? to.x : to.x + to.w
    const bend = Math.max(20, Math.abs(x2 - x1) * 0.35)
    const dir = goRight ? 1 : -1
    return `M ${x1} ${fromCy} C ${x1 + dir * bend} ${fromCy}, ${x2 - dir * bend} ${toCy}, ${x2} ${toCy}`
  }

  const goDown = toCy > fromCy
  const x1 = from.x + from.w / 2
  const y1 = goDown ? from.y + from.h : from.y
  const x2 = to.x + to.w / 2
  const y2 = goDown ? to.y : to.y + to.h
  const bend = Math.max(20, Math.abs(y2 - y1) * 0.4)
  const dir = goDown ? 1 : -1
  return `M ${x1} ${y1} C ${x1} ${y1 + dir * bend}, ${x2} ${y2 - dir * bend}, ${x2} ${y2}`
}
