export default function TabBar({ tabs, active, onChange, style }) {
  return (
    <div style={{
      display: 'flex',
      gap: 2,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      marginBottom: 16,
      flexWrap: 'wrap',
      ...style,
    }}>
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          style={{
            background: active === tab.key ? 'rgba(255,255,255,0.06)' : 'transparent',
            border: 'none',
            borderBottom: `2px solid ${active === tab.key ? '#00f0ff' : 'transparent'}`,
            cursor: 'pointer',
            padding: '8px 14px',
            fontSize: 11,
            fontWeight: active === tab.key ? 700 : 400,
            color: active === tab.key ? '#fff' : 'rgba(255,255,255,0.4)',
            transition: 'all 0.15s',
            outline: 'none',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {tab.icon && <span style={{ marginRight: 6 }}>{tab.icon}</span>}
          {tab.label}
        </button>
      ))}
    </div>
  )
}
