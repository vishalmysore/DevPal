import { useState } from 'react'

const inputStyle = {
  width: '100%', background: 'var(--vsc-input-bg, #3c3c3c)', border: '1px solid #555',
  borderRadius: 3, color: 'var(--vsc-text)', fontSize: 12, padding: '4px 8px',
  outline: 'none', boxSizing: 'border-box',
}

const buttonStyle = (disabled) => ({
  background: disabled ? '#333' : 'var(--vsc-button)',
  border: 'none', borderRadius: 3, color: disabled ? 'var(--vsc-text-dim)' : '#fff',
  fontSize: 12, padding: '4px 10px', cursor: disabled ? 'not-allowed' : 'pointer',
  whiteSpace: 'nowrap',
})

const labelStyle = {
  fontSize: 11, color: 'var(--vsc-text-dim)', textTransform: 'uppercase',
  letterSpacing: 0.5, marginBottom: 4, display: 'block',
}

function dotColor(state) {
  if (state === 'connected') return 'var(--vsc-green, #4ec94e)'
  if (state === 'connecting') return '#f0a050'
  return '#888'
}

// AgentHerd-style multi-agent panel: name yourself, mint invite links,
// paste answer tokens, join from an inbound offer, see the mesh.
export default function AgentsPanel({
  agentName, setAgentName, started, onStart,
  peers,
  invite,          // { url, slot } | null — the open invite awaiting an answer
  onCreateInvite,
  answerToken, setAnswerToken, onConnectAnswer,
  inboundOffer,    // true when the page was opened from an invite link
  joinToken,       // answer token to send back to the inviter
  autoCollab, setAutoCollab,
  status,
}) {
  const [copied, setCopied] = useState('')

  const copy = async (text, tag) => {
    await navigator.clipboard.writeText(text)
    setCopied(tag)
    setTimeout(() => setCopied(''), 2000)
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', fontSize: 12, color: 'var(--vsc-text)' }}>
      <div>
        <span style={labelStyle}>Agent Herd</span>
        <p style={{ margin: 0, color: 'var(--vsc-text-dim)', lineHeight: 1.5 }}>
          Connect multiple DevPal agents over WebRTC — full mesh, no server.
        </p>
      </div>

      {!started ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Your agent name</span>
          <input
            style={inputStyle}
            placeholder="e.g. Alice"
            value={agentName}
            onChange={e => setAgentName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && agentName.trim() && onStart()}
          />
          <button style={buttonStyle(!agentName.trim())} disabled={!agentName.trim()} onClick={onStart}>
            {inboundOffer ? 'Join herd' : 'Start herd'}
          </button>
        </div>
      ) : (
        <>
          <div>
            <span style={labelStyle}>You</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--vsc-green, #4ec94e)', flexShrink: 0 }} />
              {agentName}
            </div>
          </div>

          {/* Answerer flow: we opened an invite link */}
          {joinToken && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>Answer token</span>
              <p style={{ margin: 0, color: 'var(--vsc-text-dim)', lineHeight: 1.5 }}>
                Send this back to the inviter to complete the connection.
              </p>
              <textarea readOnly value={joinToken} rows={3} style={{ ...inputStyle, resize: 'none', fontFamily: 'monospace', fontSize: 10 }} />
              <button style={buttonStyle(false)} onClick={() => copy(joinToken, 'join')}>
                {copied === 'join' ? '✓ Copied' : 'Copy answer token'}
              </button>
            </div>
          )}

          {/* Inviter flow */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Invite an agent</span>
            <button style={buttonStyle(!!invite)} disabled={!!invite} onClick={onCreateInvite}>
              {invite ? 'Invite pending…' : '+ Create invite link'}
            </button>
            {invite && (
              <>
                <textarea readOnly value={invite.url} rows={3} style={{ ...inputStyle, resize: 'none', fontFamily: 'monospace', fontSize: 10 }} />
                <button style={buttonStyle(false)} onClick={() => copy(invite.url, 'invite')}>
                  {copied === 'invite' ? '✓ Copied' : 'Copy invite link'}
                </button>
                <span style={labelStyle}>Paste their answer token</span>
                <textarea
                  value={answerToken}
                  onChange={e => setAnswerToken(e.target.value)}
                  rows={3}
                  placeholder="Answer token from the joining agent…"
                  style={{ ...inputStyle, resize: 'none', fontFamily: 'monospace', fontSize: 10 }}
                />
                <button style={buttonStyle(!answerToken.trim())} disabled={!answerToken.trim()} onClick={onConnectAnswer}>
                  Connect
                </button>
              </>
            )}
          </div>

          {/* Collaboration */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoCollab}
              onChange={e => setAutoCollab(e.target.checked)}
              style={{ accentColor: 'var(--vsc-accent, #0078d4)' }}
            />
            <span>
              Auto-collaborate
              <span style={{ display: 'block', fontSize: 10, color: 'var(--vsc-text-dim)' }}>
                Work on tasks sent by other agents with your local model
              </span>
            </span>
          </label>

          {/* Peers */}
          <div>
            <span style={labelStyle}>Connected agents ({peers.filter(p => p.state === 'connected').length})</span>
            {peers.length === 0 && (
              <p style={{ margin: 0, color: 'var(--vsc-text-dim)' }}>No agents connected yet.</p>
            )}
            {peers.map(p => (
              <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor(p.state), flexShrink: 0 }} />
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{p.name}</div>
                  {(p.modelLabel || p.repo) && (
                    <div style={{ fontSize: 10, color: 'var(--vsc-text-dim)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                      {[p.modelLabel, p.repo].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {status && <p style={{ margin: 0, color: '#f0a050' }}>{status}</p>}

      {/* The hidden cost: this stays manual copy-paste signaling, like AgentHerd */}
      <p style={{ margin: 0, color: 'var(--vsc-text-dim)', fontSize: 11, lineHeight: 1.5 }}>
        Signaling is manual (copy-paste tokens) — after the handshake all traffic is direct peer-to-peer and encrypted.
      </p>
    </div>
  )
}
