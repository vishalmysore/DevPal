import { useState, useRef, useEffect } from 'react'
import { MODELS } from '../lib/models'

export default function ModelSelector({ selectedModel, onModelChange, modelStatus, onLoadModel }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = MODELS.find(m => m.id === selectedModel) ?? MODELS[0]

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const isLoading = modelStatus === 'loading'
  const isReady   = modelStatus === 'ready'

  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
      {/* Dropdown trigger */}
      <button
        onClick={() => !isLoading && setOpen(o => !o)}
        disabled={isLoading}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: '#3c3c3c', border: '1px solid #555', borderRadius: 4,
          color: isReady ? '#4ec9b0' : '#ccc', fontSize: 12,
          padding: '4px 10px', cursor: isLoading ? 'default' : 'pointer',
          height: 26, minWidth: 200,
        }}
        onMouseEnter={e => { if (!isLoading) e.currentTarget.style.borderColor = '#007acc' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#555' }}
      >
        <span style={{ fontSize: 14 }}>
          {isLoading ? '⟳' : isReady ? '✦' : '○'}
        </span>
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isLoading ? 'Loading model…' : current.label}
        </span>
        <span style={{ fontSize: 10, color: '#888' }}>
          {isLoading ? '' : isReady ? '✓' : current.size}
        </span>
        {!isLoading && <span style={{ color: '#888', fontSize: 10 }}>▾</span>}
      </button>

      {/* Load / Reload button */}
      <button
        onClick={onLoadModel}
        disabled={isLoading}
        style={{
          background: isReady ? '#1a5c1a' : '#6c3aab',
          border: 'none', borderRadius: 4, color: '#fff', fontSize: 12,
          padding: '4px 12px', cursor: isLoading ? 'default' : 'pointer',
          height: 26, whiteSpace: 'nowrap', opacity: isLoading ? 0.5 : 1,
        }}
        onMouseEnter={e => { if (!isLoading) e.currentTarget.style.opacity = '0.85' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
      >
        {isReady ? '↺ Reload' : isLoading ? 'Loading…' : '↓ Load Engine'}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          background: '#252526', border: '1px solid #454545', borderRadius: 4,
          width: 360, zIndex: 300, boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        }}>
          <div style={{
            padding: '6px 12px 5px', fontSize: 11, color: '#888',
            borderBottom: '1px solid #3c3c3c', display: 'flex', justifyContent: 'space-between',
          }}>
            <span>AI Model</span>
            {isReady && <span style={{ color: '#f0a050' }}>Selecting will unload current model</span>}
          </div>

          {MODELS.map(m => {
            const active = m.id === selectedModel
            return (
              <button
                key={m.id}
                onClick={() => { onModelChange(m.id); setOpen(false) }}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 12px',
                  background: active ? '#094771' : 'none', border: 'none',
                  cursor: 'pointer', color: active ? '#fff' : '#ccc',
                  borderBottom: '1px solid #2d2d2d',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#2a2d2e' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {active && isReady ? '✓ ' : ''}{m.label}
                  </span>
                  <span style={{ color: '#888', fontSize: 11 }}>{m.size}</span>
                </div>
                <div style={{ color: '#777', fontSize: 11, marginTop: 2 }}>{m.description}</div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
