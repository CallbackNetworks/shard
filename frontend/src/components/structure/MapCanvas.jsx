import { useTranslation } from 'react-i18next'
import { AlertTriangle, Boxes, GitFork, Network, Target, UserRound } from 'lucide-react'
import { computePath, networkPath, ribbonPath, treePath } from '../../utils/structureMapLayout'

function GraphNode({ children, active, muted, color, label, onClick, onDoubleClick, className = '', style }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={[
        'kt-map-node',
        active ? 'is-active' : '',
        muted ? 'is-muted' : '',
        className,
      ].filter(Boolean).join(' ')}
      style={{ '--node-color': color, ...style }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </button>
  )
}

export default function MapCanvas({
  layout,
  layoutStyle,
  viewMode,
  transform,
  selectedNodeKey,
  isNodeMuted,
  isLinkMuted,
  onSelect,
  onOpen,
  showEmpty,
  onClearFilters,
}) {
  const { t } = useTranslation()

  return (
    <div
      className="kt-map-canvas"
      style={{
        width: layout.width,
        height: layout.height,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
      }}
    >
      <svg className="kt-map-links" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
        {layout.orbit && layout.orbit.rings.map(radius => (
          <ellipse
            key={radius}
            className="kt-map-orbit"
            cx={layout.orbit.cx}
            cy={layout.orbit.cy}
            rx={radius}
            ry={radius * layout.orbit.squash}
          />
        ))}
        {layout.links.map((link, index) => {
          const from = layout.nodeById.get(link.from)
          const to = layout.nodeById.get(link.to)
          const muted = isLinkMuted(link)
          // Goal/decision arcs stay hidden until a linked node is selected, so
          // the resting picture only shows the ownership/task hierarchy.
          const accent = link.type === 'goal' || link.type === 'decision'
          if (accent && (!selectedNodeKey || muted)) return null
          if (layoutStyle === 'sankey' && link.flow) {
            return (
              <path
                key={`${link.from}-${link.to}-${index}`}
                className={['kt-ribbon', `is-${link.type}`, muted ? 'is-muted' : ''].filter(Boolean).join(' ')}
                d={ribbonPath(link, from, to)}
                fill={link.color}
                stroke="none"
              />
            )
          }
          const d = layoutStyle === 'network'
            ? networkPath(from, to)
            : layoutStyle === 'lines'
              ? treePath(from, to, link.type)
              : computePath(from, to, link.type)
          const dash = link.type === 'dependency' ? '1.75 1.75' : accent ? '4 4' : undefined
          return (
            <path
              key={`${link.from}-${link.to}-${index}`}
              className={[`is-${link.type}`, muted ? 'is-muted' : ''].filter(Boolean).join(' ')}
              d={d}
              stroke={link.color}
              strokeWidth={accent ? 1.6 : 1.35}
              strokeDasharray={dash}
              style={dash ? { '--kt-map-dash': dash, strokeDasharray: dash } : undefined}
              fill="none"
              strokeLinecap="round"
            />
          )
        })}
      </svg>

      {(layout.bands || []).map(band => (
        <div
          key={band.key}
          className="kt-map-col-label is-band"
          style={{ left: band.x, top: band.y, width: band.w }}
        >
          {t(band.key === 'goals' ? 'structure.goals' : 'structure.decisionsLabel')}
        </div>
      ))}
      {layout.columns && (
        <>
          <div className="kt-map-col-label" style={{ left: layout.columns.identity.x, top: layout.labelY ?? layout.padY ?? 6, width: layout.columns.identity.w }}>
            {t('structure.identities')}
          </div>
          <div className="kt-map-col-label" style={{ left: layout.columns.project.x, top: layout.labelY ?? layout.padY ?? 6, width: layout.columns.project.w }}>
            {t('structure.projects')}
          </div>
          <div className="kt-map-col-label" style={{ left: layout.columns.task.x, top: layout.labelY ?? layout.padY ?? 6, width: layout.columns.task.w }}>
            {t('structure.signalTasks')}
          </div>
        </>
      )}

      {layout.nodes.map(node => (
        <GraphNode
          key={node.id}
          color={node.color}
          active={selectedNodeKey === node.id}
          muted={isNodeMuted(node.data)}
          label={`${node.name} · ${node.data.status || node.data.risk || node.type} — ${t('structure.doubleClickOpen')}`}
          onClick={() => onSelect(node.data)}
          onDoubleClick={() => onOpen(node.data)}
          className={`is-${node.type}`}
          style={{ left: node.x, top: node.y, width: node.w, minHeight: node.h }}
        >
          {node.type === 'identity' && (
            node.data.avatar
              ? <span className="kt-map-avatar">{node.data.avatar}</span>
              : <UserRound size={13} />
          )}
          {node.type === 'goal' && <Target size={13} />}
          {node.type === 'decision' && <GitFork size={13} />}
          {node.type === 'project' && <Network size={13} />}
          {node.type === 'task' && <AlertTriangle size={13} />}
          {node.type === 'custom' && <Boxes size={13} />}
          <strong>{node.name}</strong>
          {(node.data.isCustomType || node.type === 'custom') && node.data.typeLabel && (
            <em style={{ color: node.data.typeColor || undefined }}>{node.data.typeLabel}</em>
          )}
          {node.type === 'identity' && <em>{node.data.projectCount} {t('structure.projects')}</em>}
          {node.type === 'project' && (
            <>
              <span className="kt-map-progress"><i style={{ width: `${node.data.progress}%` }} /></span>
              <em>{node.data.doneTasks}/{node.data.totalTasks} {t('done')} · {node.data.pendingDecisionCount} {t('pending')}</em>
              {(node.data.failed > 0 || node.data.overdue > 0) && <b><AlertTriangle size={11} /> {node.data.failed + node.data.overdue}</b>}
            </>
          )}
          {node.type === 'task' && (
            <>
              <em>{node.data.status} · {node.data.priority}</em>
              {viewMode === 'dependencies' && (node.data.blockedBy?.length > 0 || node.data.blocking?.length > 0) && (
                <em>{node.data.blockedBy?.length || 0} {t('structure.dependsOn')} · {node.data.blocking?.length || 0} {t('structure.blocks')}</em>
              )}
              <span className={`kt-map-risk is-${node.data.risk}`}>{node.data.risk}</span>
            </>
          )}
          {(node.type === 'goal' || node.type === 'decision') && <em>{node.data.status}</em>}
        </GraphNode>
      ))}
      {showEmpty && (
        <div className="kt-map-empty">
          <strong>{t('structure.noMatches')}</strong>
          <span>{t('structure.noMatchesHint')}</span>
          <button type="button" onClick={onClearFilters}>{t('structure.clearFilters')}</button>
        </div>
      )}
    </div>
  )
}
