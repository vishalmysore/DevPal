import { useState } from 'react'

function FileNode({ node, depth, onSelect, selected }) {
  const [open, setOpen] = useState(depth < 1)
  const pad = depth * 12 + 8

  if (node.type === 'dir') {
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center',
            gap: 4, padding: `2px 8px 2px ${pad}px`,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--vsc-text)', fontSize: 13, whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--vsc-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          <span style={{ fontSize: 10, color: 'var(--vsc-text-dim)', width: 12 }}>
            {open ? '▾' : '▸'}
          </span>
          <span style={{ fontSize: 15 }}>{open ? '📂' : '📁'}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
        </button>
        {open && node.children?.map(child => (
          <FileNode key={child.path} node={child} depth={depth + 1} onSelect={onSelect} selected={selected} />
        ))}
      </div>
    )
  }

  const isSelected = selected === node.path
  return (
    <button
      onClick={() => onSelect(node)}
      style={{
        width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center',
        gap: 4, padding: `2px 8px 2px ${pad + 16}px`,
        background: isSelected ? 'var(--vsc-selection)' : 'none',
        border: 'none', cursor: 'pointer',
        color: isSelected ? '#fff' : 'var(--vsc-text)', fontSize: 13, whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--vsc-hover)' }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'none' }}
    >
      <FileIcon name={node.name} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
    </button>
  )
}

function FileIcon({ name }) {
  const ext = name.split('.').pop()?.toLowerCase()
  const colors = {
    js: '#f0db4f', jsx: '#61dafb', ts: '#3178c6', tsx: '#61dafb',
    py: '#3572a5', json: '#a8a233', md: '#519aba', css: '#563d7c',
    html: '#e44b23', yml: '#cb171e', yaml: '#cb171e', sh: '#89e051',
    rs: '#dea584', go: '#00add8', java: '#b07219',
  }
  const color = colors[ext ?? ''] ?? '#808080'
  const dot = ext ? ext.slice(0, 2).toUpperCase() : '  '
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, color, width: 16, flexShrink: 0,
      letterSpacing: '-0.5px',
    }}>
      {dot}
    </span>
  )
}

export default function Sidebar({ tree, onSelect, selected, ragStats }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '8px 12px 4px', fontSize: 11, fontWeight: 700,
        color: 'var(--vsc-text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Explorer</span>
        {ragStats && (
          <span style={{
            background: '#1a3a1a', color: 'var(--vsc-green)', padding: '1px 6px',
            borderRadius: 10, fontSize: 10,
          }}>
            RAG: {ragStats.files} files
          </span>
        )}
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {tree.length === 0 ? (
          <p style={{ padding: '8px 12px', color: 'var(--vsc-text-dim)', fontSize: 12 }}>
            Clone a repo to view files.
          </p>
        ) : (
          tree.map(node => (
            <FileNode key={node.path} node={node} depth={0} onSelect={onSelect} selected={selected} />
          ))
        )}
      </div>
    </div>
  )
}
