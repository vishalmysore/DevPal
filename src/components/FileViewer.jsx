export default function FileViewer({ file }) {
  if (!file) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--vsc-bg)', color: 'var(--vsc-text-dim)', fontSize: 13,
        flexDirection: 'column', gap: 12,
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
        </svg>
        <span>Open a file from the explorer</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--vsc-bg)' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--vsc-border)',
        background: 'var(--vsc-tab-inactive)', flexShrink: 0, height: 35,
      }}>
        <div style={{
          padding: '0 16px', height: '100%', display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--vsc-tab-active)', borderRight: '1px solid var(--vsc-border)',
          borderTop: '1px solid var(--vsc-accent)', fontSize: 13,
          color: 'var(--vsc-text)',
        }}>
          <span style={{ fontSize: 10, opacity: 0.7 }}>
            {file.path.split('/').pop()?.split('.').pop()?.toUpperCase()}
          </span>
          <span>{file.path.split('/').pop()}</span>
        </div>
      </div>

      {/* Breadcrumb */}
      <div style={{
        padding: '3px 12px', borderBottom: '1px solid var(--vsc-border)',
        color: 'var(--vsc-text-dim)', fontSize: 12, flexShrink: 0,
        background: 'var(--vsc-bg)',
      }}>
        {file.path.split('/').filter(Boolean).join(' › ')}
      </div>

      {/* Code */}
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'Cascadia Code, Fira Code, Consolas, monospace', fontSize: 13 }}>
          <tbody>
            {file.content.split('\n').map((line, i) => (
              <tr key={i} style={{ lineHeight: '20px' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <td style={{
                  width: 48, textAlign: 'right', paddingRight: 16, paddingLeft: 8,
                  color: 'var(--vsc-text-dim)', userSelect: 'none', fontSize: 12,
                  verticalAlign: 'top', flexShrink: 0,
                }}>
                  {i + 1}
                </td>
                <td style={{ paddingRight: 16, color: 'var(--vsc-text)', whiteSpace: 'pre', verticalAlign: 'top' }}>
                  {line || ' '}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
