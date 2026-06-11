import { useRef, useEffect } from 'react'

function UserMessage({ text }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '12px 16px' }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%', background: 'var(--vsc-accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, flexShrink: 0, color: '#fff',
      }}>U</div>
      <div style={{ paddingTop: 3, color: 'var(--vsc-text)', lineHeight: 1.5, flex: 1, wordBreak: 'break-word' }}>
        {text}
      </div>
    </div>
  )
}

function AssistantMessage({ content, streaming }) {
  return (
    <div style={{
      display: 'flex', gap: 8, padding: '12px 16px',
      background: 'rgba(255,255,255,0.03)',
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%',
        background: 'linear-gradient(135deg, #6e40c9, #c06ef3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, flexShrink: 0, color: '#fff',
      }}>✦</div>
      <div style={{ flex: 1 }}>
        {content ? (
          <pre style={{
            fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6,
            color: 'var(--vsc-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
          }}>
            {content}
            {streaming && <span style={{ display: 'inline-block', width: 8, height: 14, background: 'var(--vsc-text)', marginLeft: 2, animation: 'blink 1s step-start infinite', verticalAlign: 'text-bottom' }} />}
          </pre>
        ) : (
          <span style={{ color: 'var(--vsc-text-dim)', fontStyle: 'italic' }}>
            {streaming ? 'Thinking…' : ''}
          </span>
        )}
      </div>
    </div>
  )
}

function PeerMessage({ from, text }) {
  return (
    <div style={{
      display: 'flex', gap: 8, padding: '12px 16px',
      background: 'rgba(80,160,255,0.05)',
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%',
        background: 'linear-gradient(135deg, #1a6ea0, #4fc1ff)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, flexShrink: 0, color: '#fff',
      }}>{(from ?? '?')[0].toUpperCase()}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: '#4fc1ff', marginBottom: 2 }}>{from}</div>
        <pre style={{
          fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6,
          color: 'var(--vsc-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
        }}>{text}</pre>
      </div>
    </div>
  )
}

function SystemMessage({ text }) {
  return (
    <div style={{ padding: '6px 16px', fontSize: 12, color: 'var(--vsc-text-dim)', textAlign: 'center' }}>
      {text}
    </div>
  )
}

function ContextBadge({ file, ragStats }) {
  if (!file && !ragStats) return null
  return (
    <div style={{
      display: 'flex', gap: 6, flexWrap: 'wrap',
      padding: '6px 12px', borderTop: '1px solid var(--vsc-border)',
      background: 'var(--vsc-sidebar)',
    }}>
      {file && (
        <span style={{
          background: '#0d2137', border: '1px solid #1a4a6e',
          color: '#4fc1ff', padding: '2px 8px', borderRadius: 3, fontSize: 11,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          📄 {file.path.split('/').pop()}
        </span>
      )}
      {ragStats && ragStats.files > 0 && (
        <span style={{
          background: '#0d2a0d', border: '1px solid #1a5c1a',
          color: 'var(--vsc-green)', padding: '2px 8px', borderRadius: 3, fontSize: 11,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          ⚡ {ragStats.files} files indexed
          · {Math.round(ragStats.totalOriginal / 1024)}KB → {Math.round(ragStats.totalCompressed / 1024)}KB
        </span>
      )}
    </div>
  )
}

export default function ChatPanel({
  messages,
  streamingContent,
  isStreaming,
  prompt,
  setPrompt,
  onSend,
  disabled,
  selectedFile,
  ragStats,
  modelStatus,
}) {
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!disabled) onSend()
    }
  }

  const placeholder = !selectedFile
    ? 'Select a file to start editing…'
    : modelStatus !== 'ready'
    ? 'Load an AI model first (header)…'
    : 'Ask DevPal (Enter to send, Shift+Enter for newline)…'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--vsc-panel)',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid var(--vsc-border)',
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--vsc-sidebar)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--vsc-text)' }}>
          ✦ DevPal Chat
        </span>
        <span style={{ fontSize: 11, color: 'var(--vsc-text-dim)', marginLeft: 'auto' }}>
          DevPal · Local AI
        </span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {messages.length === 0 && !isStreaming && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: 12, padding: 24,
          }}>
            <div style={{ fontSize: 32 }}>✦</div>
            <p style={{ color: 'var(--vsc-text-dim)', textAlign: 'center', fontSize: 13, lineHeight: 1.6 }}>
              Select a file, then describe your change.
              <br/>DevPal generates SEARCH/REPLACE patches locally.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          msg.role === 'user'   ? <UserMessage key={i} text={msg.content} /> :
          msg.role === 'peer'   ? <PeerMessage key={i} from={msg.from} text={msg.content} /> :
          msg.role === 'system' ? <SystemMessage key={i} text={msg.content} /> :
                                  <AssistantMessage key={i} content={msg.content} streaming={false} />
        ))}

        {isStreaming && (
          <AssistantMessage content={streamingContent} streaming={true} />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Context badges */}
      <ContextBadge file={selectedFile} ragStats={ragStats} />

      {/* Input */}
      <div style={{
        padding: '8px 12px 12px', borderTop: '1px solid var(--vsc-border)',
        background: 'var(--vsc-sidebar)', flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', gap: 8, alignItems: 'flex-end',
          background: 'var(--vsc-input-bg)', borderRadius: 4,
          border: '1px solid var(--vsc-border)', padding: '6px 10px',
        }}>
          <textarea
            ref={textareaRef}
            rows={3}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder}
            disabled={disabled && isStreaming}
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              resize: 'none', color: 'var(--vsc-text)', fontSize: 13,
              fontFamily: 'inherit', lineHeight: 1.5,
              '::placeholder': { color: 'var(--vsc-text-dim)' },
            }}
          />
          <button
            onClick={onSend}
            disabled={disabled}
            title="Send (Enter)"
            style={{
              background: disabled ? '#2a2a2a' : 'var(--vsc-button)',
              border: 'none', borderRadius: 3, padding: '5px 10px',
              color: disabled ? 'var(--vsc-text-dim)' : '#fff',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: 16, display: 'flex', alignItems: 'center',
              transition: 'background 0.15s', flexShrink: 0,
            }}
            onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--vsc-button-h)' }}
            onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = 'var(--vsc-button)' }}
          >
            {isStreaming ? '⏹' : '↑'}
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--vsc-text-dim)', marginTop: 4, paddingLeft: 2 }}>
          All inference runs locally via WebGPU · code never leaves your browser
        </p>
      </div>

      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  )
}
