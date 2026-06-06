import { useEffect, useRef } from 'react'
import { html as diff2html } from 'diff2html'
import 'diff2html/bundles/css/diff2html.min.css'

export default function DiffViewer({ diff, onApply, onDownload, onDiscard }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || !diff?.patch) return
    const html = diff2html(diff.patch, {
      drawFileList: false,
      matching: 'lines',
      outputFormat: 'side-by-side',
    })
    containerRef.current.innerHTML = html
  }, [diff])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
        height: 35, background: '#252526', borderBottom: '1px solid var(--vsc-border)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, color: 'var(--vsc-text-dim)', flex: 1 }}>
          Diff Preview — {diff?.path}
        </span>
        <Btn onClick={onApply} color="#16825d">✓ Apply</Btn>
        <Btn onClick={onDownload} color="var(--vsc-button)">↓ .patch</Btn>
        <Btn onClick={onDiscard} color="#555">✕ Discard</Btn>
      </div>

      <div
        ref={containerRef}
        style={{ flex: 1, overflowY: 'auto', background: 'var(--vsc-bg)' }}
      />
    </div>
  )
}

function Btn({ children, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 10px', background: color, border: 'none',
        borderRadius: 3, color: '#fff', fontSize: 12, cursor: 'pointer',
        fontWeight: 500,
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
    >
      {children}
    </button>
  )
}
