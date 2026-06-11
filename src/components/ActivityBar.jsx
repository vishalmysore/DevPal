const icons = {
  explorer: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 7h6l2 2h10v11H3z"/>
    </svg>
  ),
  chat: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
    </svg>
  ),
  git: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
      <path d="M6 9v6M15.5 6H13a4 4 0 00-4 4v1"/>
    </svg>
  ),
  agents: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/>
      <path d="M3 20v-1a6 6 0 0112 0v1M14.5 20v-.5a4.5 4.5 0 017 0v.5"/>
    </svg>
  ),
  settings: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  ),
}

export default function ActivityBar({ active, onChange }) {
  const items = [
    { id: 'explorer', title: 'Explorer' },
    { id: 'chat',     title: 'Copilot Chat' },
    { id: 'git',      title: 'Source Control' },
    { id: 'agents',   title: 'Agent Herd' },
  ]

  return (
    <div style={{
      width: 48,
      background: 'var(--vsc-activity)',
      borderRight: '1px solid var(--vsc-border)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingTop: 4,
      gap: 0,
      flexShrink: 0,
    }}>
      {items.map(({ id, title }) => (
        <button
          key={id}
          title={title}
          onClick={() => onChange(id)}
          style={{
            width: 48,
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: active === id ? '#fff' : 'var(--vsc-text-dim)',
            borderLeft: active === id ? '2px solid #fff' : '2px solid transparent',
            transition: 'color 0.1s',
          }}
          onMouseEnter={e => { if (active !== id) e.currentTarget.style.color = '#bbb' }}
          onMouseLeave={e => { if (active !== id) e.currentTarget.style.color = 'var(--vsc-text-dim)' }}
        >
          {icons[id]}
        </button>
      ))}

      <div style={{ flex: 1 }} />

      <button
        title="Settings"
        style={{
          width: 48, height: 48,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--vsc-text-dim)', marginBottom: 4,
        }}
      >
        {icons.settings}
      </button>
    </div>
  )
}
