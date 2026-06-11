import { useState, useEffect, useRef, useCallback } from 'react'
import ActivityBar from './components/ActivityBar'
import ModelSelector from './components/ModelSelector'
import Sidebar from './components/Sidebar'
import ChatPanel from './components/ChatPanel'
import DiffViewer from './components/DiffViewer'
import FileViewer from './components/FileViewer'
import StatusBar from './components/StatusBar'
import ModelLoader from './components/ModelLoader'
import { cloneRepo, listFiles, readFile, writeFile } from './lib/gitWorkspace'
import { parseSearchReplace, applyPatches, buildPrompt, generateUnifiedDiff } from './lib/orchestrator'
import { MODELS } from './lib/models'
import { indexFile, clearIndex, getIndexStats, buildContextBlock } from './lib/codeRag'
import AgentsPanel from './components/AgentsPanel'
import { PeerManager, encodeSDP, decodeSDP, buildInviteURL, getInviteOfferFromHash } from './lib/peerManager'
import './index.css'

export default function App() {
  // Engine
  const [gpuStatus, setGpuStatus]       = useState('checking')
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id)
  const [modelStatus, setModelStatus]   = useState('idle')
  const [modelProgress, setModelProgress] = useState(null)

  // Repo
  const [repoUrl, setRepoUrl]     = useState('')
  const [cloneStatus, setCloneStatus] = useState('idle')
  const [fileTree, setFileTree]   = useState([])
  const [ragStats, setRagStats]   = useState(null)

  // Editor
  const [selectedFile, setSelectedFile] = useState(null)
  const [diff, setDiff]                 = useState(null)

  // Chat
  const [messages, setMessages]         = useState([])
  const [prompt, setPrompt]             = useState('')
  const [isStreaming, setIsStreaming]   = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [agentError, setAgentError]     = useState('')

  // UI
  const [activePanel, setActivePanel]   = useState('explorer')

  // Agent herd (multi-agent mesh)
  const [agentName, setAgentName]   = useState('')
  const [herdStarted, setHerdStarted] = useState(false)
  const [peers, setPeers]           = useState([])
  const [invite, setInvite]         = useState(null)   // { url, slot }
  const [answerToken, setAnswerToken] = useState('')
  const [joinToken, setJoinToken]   = useState('')     // our answer token (answerer flow)
  const [herdStatus, setHerdStatus] = useState('')
  const [inboundOffer]              = useState(() => getInviteOfferFromHash())

  const workerRef      = useRef(null)
  const resolveGenRef  = useRef(null)
  const fullOutputRef  = useRef('')
  const pmRef          = useRef(null)
  const inviteSlotSeq  = useRef(0)

  useEffect(() => {
    setGpuStatus(navigator.gpu ? 'active' : 'unavailable')
    // Arrived via an AgentHerd invite link — open the Agents panel
    if (inboundOffer) setActivePanel('agents')
  }, [inboundOffer])

  useEffect(() => {
    const worker = new Worker(
      new URL('./workers/inference.worker.js', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker

    worker.onmessage = (e) => {
      const msg = e.data
      switch (msg.status) {
        case 'device_detected':
          setModelProgress({ text: 'WebGPU detected — starting download…', progress: 0 })
          break
        case 'phase':
          setModelProgress({
            text: msg.phase === 'compile'
              ? (msg.note ?? 'Compiling WebGPU shaders (cached after first load)…')
              : 'Preparing…',
            progress: msg.phase === 'compile' ? 0.8 : 0,
          })
          break
        case 'downloading':
          setModelProgress({ text: msg.file, progress: (msg.progress ?? 0) / 100 })
          break
        case 'ready':
          setModelStatus('ready')
          setModelProgress(null)
          break
        case 'token':
          fullOutputRef.current += msg.delta
          setStreamingContent(prev => prev + msg.delta)
          break
        case 'success':
          resolveGenRef.current?.('done')
          break
        case 'error':
          resolveGenRef.current?.({ error: msg.error })
          setAgentError(msg.error)
          setModelStatus(s => s === 'loading' ? 'idle' : s)
          break
        case 'cancelled':
        case 'disposed':
          setModelStatus('idle')
          setModelProgress(null)
          break
      }
    }

    worker.onerror = (e) => {
      const err = e.message ?? 'Worker crashed'
      setAgentError(err)
      setModelStatus('idle')
      resolveGenRef.current?.({ error: err })
    }

    return () => worker.terminate()
  }, [])

  const loadModel = useCallback(() => {
    if (gpuStatus !== 'active') return
    setModelStatus('loading')
    workerRef.current.postMessage({ action: 'load', modelId: selectedModel, gen: Date.now() })
  }, [gpuStatus, selectedModel])

  // ── Clone + index ──────────────────────────────────────────────────
  const hasRepoRef = useRef(false)

  const doClone = useCallback(async (url) => {
    if (!url.trim()) return
    setRepoUrl(url.trim())
    setCloneStatus('cloning')
    setFileTree([])
    setSelectedFile(null)
    setDiff(null)
    clearIndex()
    setRagStats(null)
    hasRepoRef.current = false

    try {
      await cloneRepo(url.trim(), () => {})
      const tree = await listFiles()
      setFileTree(tree)
      setCloneStatus('done')
      hasRepoRef.current = true

      // Tell the herd which repo we're on so peers can sync to it
      if (pmRef.current) {
        pmRef.current.myRepo = url.trim()
        pmRef.current.broadcast({ type: 'repo', url: url.trim() })
      }

      // Index all files for RAG in the background
      await indexAllFiles(tree)
      setRagStats(getIndexStats())
    } catch (err) {
      setCloneStatus('error')
      setAgentError(err.message)
    }
  }, [])

  // Latest doClone, callable from PeerManager callbacks created at herd start
  const doCloneRef = useRef(doClone)
  doCloneRef.current = doClone

  const handleClone = useCallback(() => doClone(repoUrl), [doClone, repoUrl])

  async function indexAllFiles(nodes) {
    for (const node of nodes) {
      if (node.type === 'dir') {
        await indexAllFiles(node.children ?? [])
      } else {
        try {
          const content = await readFile(node.path)
          indexFile(node.path, content)
        } catch (_) {}
      }
    }
  }

  const handleSelectFile = useCallback(async (node) => {
    if (node.type !== 'file') return
    const content = await readFile(node.path)
    setSelectedFile({ path: node.path, content })
    setDiff(null)
    setAgentError('')
    setActivePanel('chat')
  }, [])

  // ── Agent run ──────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!selectedFile || !prompt.trim() || modelStatus !== 'ready' || isStreaming) return

    const userText = prompt.trim()
    setPrompt('')
    setMessages(prev => [...prev, { role: 'user', content: userText }])
    pmRef.current?.broadcast({ type: 'chat', content: `🧑 prompt on ${selectedFile.path}: ${userText}` })
    setIsStreaming(true)
    setStreamingContent('')
    setAgentError('')
    fullOutputRef.current = ''

    // Build RAG context
    const contextBlock = buildContextBlock(userText, 4)

    const messages = buildPrompt(selectedFile.path, selectedFile.content, userText, contextBlock)
    workerRef.current.postMessage({ action: 'generate', messages, gen: Date.now() })

    const result = await new Promise(resolve => { resolveGenRef.current = resolve })
    setIsStreaming(false)

    if (result?.error) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠ Error: ${result.error}` }])
      return
    }

    const rawOutput = fullOutputRef.current
    setStreamingContent('')

    try {
      const blocks = parseSearchReplace(rawOutput)
      if (blocks.length === 0) {
        // No patch blocks — treat as a plain answer
        setMessages(prev => [...prev, { role: 'assistant', content: rawOutput }])
        pmRef.current?.broadcast({ type: 'chat', content: `✦ answered: ${rawOutput.slice(0, 500)}` })
        return
      }
      const newContent = applyPatches(selectedFile.content, blocks)
      const patch = generateUnifiedDiff(selectedFile.path, selectedFile.content, newContent)
      setDiff({ path: selectedFile.path, before: selectedFile.content, after: newContent, patch })
      pmRef.current?.broadcast({
        type: 'diff', path: selectedFile.path, patch,
        before: selectedFile.content, after: newContent,
      })
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Generated ${blocks.length} change${blocks.length > 1 ? 's' : ''}. Review the diff →`,
      }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠ Patch error: ${err.message}\n\nRaw output:\n${rawOutput}` }])
    }
  }, [selectedFile, prompt, modelStatus, isStreaming])

  const handleApplyDiff = useCallback(async () => {
    if (!diff) return
    await writeFile(diff.path, diff.after)
    pmRef.current?.broadcast({
      type: 'chat',
      content: `✅ applied ${diff.from ? `${diff.from}'s` : 'a'} patch to ${diff.path}`,
    })
    // Re-index the changed file
    indexFile(diff.path, diff.after)
    setRagStats(getIndexStats())
    setSelectedFile({ path: diff.path, content: diff.after })
    setDiff(null)
  }, [diff])

  // ── Agent herd (AgentHerd-style full-mesh WebRTC) ──────────────────
  const refreshPeers = useCallback(() => {
    const pm = pmRef.current
    setPeers(pm ? [...pm.peers.values()].map(p => ({
      name: p.name, modelLabel: p.modelLabel, repo: p.repo, state: p.state,
    })) : [])
  }, [])

  const startHerd = useCallback(async () => {
    const name = agentName.trim()
    if (!name || pmRef.current) return

    const pm = new PeerManager({
      myName: name,
      myModelLabel: selectedModel,
      myRepo: repoUrl.trim() || null,
      onPeerJoin: (peerName, hello) => {
        refreshPeers()
        setMessages(prev => [...prev, { role: 'system', content: `🤝 ${peerName} joined the herd` }])
        // Sync workspaces: adopt the peer's repo if we don't have one yet
        if (hello?.repo && !hasRepoRef.current) {
          setMessages(prev => [...prev, { role: 'system', content: `📦 Cloning ${peerName}'s repo: ${hello.repo}` }])
          doCloneRef.current(hello.repo)
        }
      },
      onPeerLeave: (peerName) => {
        refreshPeers()
        setMessages(prev => [...prev, { role: 'system', content: `👋 ${peerName} left the herd` }])
      },
      onPeerState: refreshPeers,
      onMessage: (from, msg) => {
        if (msg.type === 'chat') {
          setMessages(prev => [...prev, { role: 'peer', from, content: msg.content }])
        } else if (msg.type === 'repo') {
          // A peer cloned a repo — follow them onto it if we have none
          if (msg.url && !hasRepoRef.current) {
            setMessages(prev => [...prev, { role: 'system', content: `📦 ${from} is on ${msg.url} — cloning…` }])
            doCloneRef.current(msg.url)
          }
        } else if (msg.type === 'diff') {
          setMessages(prev => [...prev, {
            role: 'peer', from,
            content: `proposed a patch for ${msg.path} — review it in the diff viewer →`,
          }])
          // Open the peer's patch in our own diff viewer; Apply writes it to our copy
          if (msg.before != null && msg.after != null) {
            setDiff({ path: msg.path, before: msg.before, after: msg.after, patch: msg.patch, from })
          }
        }
      },
    })
    pmRef.current = pm
    setHerdStarted(true)
    setHerdStatus('')

    // Answerer flow: page opened from an invite link
    if (inboundOffer) {
      try {
        setHerdStatus('Accepting invite…')
        const offer = await decodeSDP(inboundOffer)
        const sdp = await pm.acceptOffer('host', offer)
        setJoinToken(await encodeSDP(sdp))
        setHerdStatus('')
      } catch {
        setHerdStatus('Invalid invite link.')
      }
    }
  }, [agentName, selectedModel, repoUrl, inboundOffer, refreshPeers])

  const handleCreateInvite = useCallback(async () => {
    const pm = pmRef.current
    if (!pm || invite) return
    setHerdStatus('Gathering ICE candidates…')
    const slot = `slot-${++inviteSlotSeq.current}`
    const sdp = await pm.createOffer(slot)
    setInvite({ url: buildInviteURL(await encodeSDP(sdp)), slot })
    setHerdStatus('')
    refreshPeers()
  }, [invite, refreshPeers])

  const handleConnectAnswer = useCallback(async () => {
    const pm = pmRef.current
    if (!pm || !invite || !answerToken.trim()) return
    try {
      await pm.setAnswer(invite.slot, await decodeSDP(answerToken))
      setInvite(null)
      setAnswerToken('')
      setHerdStatus('')
    } catch {
      setHerdStatus('Invalid answer token. Try again.')
    }
  }, [invite, answerToken])

  const handleDownloadPatch = useCallback(() => {
    if (!diff) return
    const blob = new Blob([diff.patch], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `devpal-${Date.now()}.patch`
    a.click()
  }, [diff])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Title bar */}
      <div style={{
        height: 30, background: '#323233', display: 'flex', alignItems: 'center',
        paddingLeft: 12, gap: 8, flexShrink: 0, borderBottom: '1px solid #111',
      }}>
        <span style={{ fontSize: 12, color: '#ccc', userSelect: 'none' }}>DevPal — Local AI Code Editor</span>
        {/* Repo input inline */}
        <div style={{ flex: 1, maxWidth: 500, display: 'flex', gap: 6, marginLeft: 16 }}>
          <input
            style={{
              flex: 1, background: '#3c3c3c', border: '1px solid #555', borderRadius: 3,
              color: '#ccc', fontSize: 12, padding: '2px 8px', outline: 'none',
            }}
            placeholder="https://github.com/user/repo"
            value={repoUrl}
            onChange={e => setRepoUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleClone()}
            onFocus={e => e.target.style.borderColor = 'var(--vsc-accent)'}
            onBlur={e => e.target.style.borderColor = '#555'}
          />
          <button
            onClick={handleClone}
            disabled={cloneStatus === 'cloning'}
            style={{
              background: cloneStatus === 'cloning' ? '#333' : 'var(--vsc-button)',
              border: 'none', borderRadius: 3, color: '#fff', fontSize: 12,
              padding: '2px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {cloneStatus === 'cloning' ? '⟳ Cloning…' : 'Clone'}
          </button>
        </div>

        {gpuStatus === 'active' && (
          <div style={{ marginLeft: 'auto', marginRight: 8 }}>
            <ModelSelector
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              modelStatus={modelStatus}
              onLoadModel={loadModel}
            />
          </div>
        )}
        {gpuStatus === 'unavailable' && (
          <span style={{ marginLeft: 'auto', marginRight: 8, color: '#f0a050', fontSize: 12 }}>
            ⚠ WebGPU unavailable — use Chrome 113+
          </span>
        )}
      </div>

      {/* Model progress banner */}
      {modelStatus === 'loading' && <ModelLoader progress={modelProgress} />}

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Activity bar */}
        <ActivityBar active={activePanel} onChange={setActivePanel} />

        {/* Side panel */}
        <div style={{
          width: 220, flexShrink: 0,
          background: 'var(--vsc-sidebar)',
          borderRight: '1px solid var(--vsc-border)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          {activePanel === 'agents' ? (
            <AgentsPanel
              agentName={agentName}
              setAgentName={setAgentName}
              started={herdStarted}
              onStart={startHerd}
              peers={peers}
              invite={invite}
              onCreateInvite={handleCreateInvite}
              answerToken={answerToken}
              setAnswerToken={setAnswerToken}
              onConnectAnswer={handleConnectAnswer}
              inboundOffer={!!inboundOffer}
              joinToken={joinToken}
              status={herdStatus}
            />
          ) : (
            <Sidebar
              tree={fileTree}
              onSelect={handleSelectFile}
              selected={selectedFile?.path}
              ragStats={ragStats}
            />
          )}
        </div>

        {/* Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {diff ? (
            <DiffViewer
              diff={diff}
              onApply={handleApplyDiff}
              onDownload={handleDownloadPatch}
              onDiscard={() => setDiff(null)}
            />
          ) : (
            <FileViewer file={selectedFile} />
          )}

          {agentError && (
            <div style={{
              padding: '6px 12px', background: '#3a1a1a', borderTop: '1px solid #7a2020',
              color: '#f47777', fontSize: 12, flexShrink: 0,
            }}>
              ⚠ {agentError}
            </div>
          )}
        </div>

        {/* Chat panel */}
        <div style={{
          width: 340, flexShrink: 0,
          borderLeft: '1px solid var(--vsc-border)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <ChatPanel
            messages={messages}
            streamingContent={streamingContent}
            isStreaming={isStreaming}
            prompt={prompt}
            setPrompt={setPrompt}
            onSend={handleSend}
            disabled={isStreaming || modelStatus !== 'ready' || !selectedFile}
            selectedFile={selectedFile}
            ragStats={ragStats}
            modelStatus={modelStatus}
          />
        </div>
      </div>

      {/* Status bar */}
      <StatusBar
        gpuStatus={gpuStatus}
        modelStatus={modelStatus}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        onLoadModel={loadModel}
        cloneStatus={cloneStatus}
        selectedFile={selectedFile}
      />
    </div>
  )
}
