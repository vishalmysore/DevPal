export default function StatusBar({ gpuStatus, cloneStatus, selectedFile }) {
  return (
    <div style={{
      height: 22, background: 'var(--vsc-status)', display: 'flex',
      alignItems: 'center', fontSize: 12, color: '#fff', flexShrink: 0,
      paddingLeft: 8, gap: 0,
    }}>
      <StatusItem>⎇ DevPal</StatusItem>

      <div style={{ flex: 1 }} />

      <StatusItem title={gpuStatus === 'active' ? 'WebGPU available' : 'WebGPU unavailable'}>
        {gpuStatus === 'active' ? '⬡ WebGPU' : '⚠ No WebGPU'}
      </StatusItem>

      {selectedFile && (
        <StatusItem title={selectedFile.path}>
          {selectedFile.path.split('/').pop()}
        </StatusItem>
      )}

      {cloneStatus === 'cloning' && (
        <StatusItem>⟳ Cloning…</StatusItem>
      )}
    </div>
  )
}

function StatusItem({ children, title }) {
  return (
    <div title={title} style={{
      padding: '0 8px', height: '100%', display: 'flex',
      alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
    }}>
      {children}
    </div>
  )
}
