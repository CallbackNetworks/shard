import s from './TypeChip.module.css'

// One node type's badge. It existed twice — `NodePage` drew it with inline styles and
// `NodeExplorer` with a module class — which is two places to change when the registry
// grows a field, on a chip whose whole job is to say the same thing everywhere.
export default function TypeChip({ typeMeta, typeKey }) {
  const color = typeMeta?.color || '#818cf8'
  return (
    <span className={s.chip} style={{ '--chip': color }}>
      {typeMeta?.label || typeKey}
    </span>
  )
}
