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
import { parseSearchReplace, applyPatches, buildPrompt, generateUnifiedDiff, buildProjectPrompt, parseFilePatches } from './lib/orchestrator'
import { MODELS } from './lib/models'
import { indexFile, clearIndex, getIndexStats, retrieveContextHybrid, setEmbedder, embedIndex } from './lib/codeRag'
import { buildContext } from './lib/contextStrategies'
import { initTokenizer } from './lib/tokenizer'
import { buildIgnore } from './lib/ignoreFilter'
import AgentsPanel from './components/AgentsPanel'
import { PeerManager, encodeSDP, decodeSDP, buildInviteURL, getInviteOfferFromHash } from './lib/peerManager'
import './index.css'

// Index the tree, skipping paths the ignore filter rejects (dependency/build
// noise + the repo's own .gitignore). `root` is the absolute repo dir so paths
// can be made repo-relative for matching; ignored directories aren't descended.
async function indexAllFiles(nodes, ig, root) {
  for (const node of nodes) {
    const rel = root && node.path.startsWith(`${root}/`) ? node.path.slice(root.length + 1) : node.path
    if (ig?.ignores(rel)) continue
    if (node.type === 'dir') {
      await indexAllFiles(node.children ?? [], ig, root)
    } else {
      try {
        const content = await readFile(node.path)
        indexFile(node.path, content)
      } catch {
        // unreadable file — skip indexing it
      }
    }
  }
}

export default function App() {
  // Engine
  const [gpuStatus]                     = useState(() => navigator.gpu ? 'active' : 'unavailable')
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id)
  const [modelStatus, setModelStatus]   = useState('idle')
  const [modelProgress, setModelProgress] = useState(null)

  // Repo
  const [repoUrl, setRepoUrl]     = useState('')
  const [cloneStatus, setCloneStatus] = useState('idle')
  const [fileTree, setFileTree]   = useState([])
  const [ragStats, setRagStats]   = useState(null)
  const [embedStatus, setEmbedStatus] = useState(null) // { done, total } | 'ready' | null

  // Context crunch strategy — how the repo is compressed before it hits the
  // model. Mirrored to a ref so peer-driven runTask calls see the live choice.
  const [contextStrategy, setContextStrategy] = useState('rag')
  const contextStrategyRef = useRef('rag')
  useEffect(() => { contextStrategyRef.current = contextStrategy }, [contextStrategy])
  const [crunchStats, setCrunchStats] = useState(null) // { method, originalTokens, crunchedTokens, savedPct }

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
  // Arrived via an AgentHerd invite link — open the Agents panel
  const [activePanel, setActivePanel]   = useState(() => getInviteOfferFromHash() ? 'agents' : 'explorer')

  // Agent herd (multi-agent mesh)
  const [agentName, setAgentName]   = useState('')
  const [myRole, setMyRole]         = useState('generalist')
  const myRoleRef = useRef('generalist')
  useEffect(() => { myRoleRef.current = myRole }, [myRole])
  const [herdStarted, setHerdStarted] = useState(false)
  const [peers, setPeers]           = useState([])
  const [invite, setInvite]         = useState(null)   // { url, slot }
  const [answerToken, setAnswerToken] = useState('')
  const [joinToken, setJoinToken]   = useState('')     // our answer token (answerer flow)
  const [herdStatus, setHerdStatus] = useState('')
  const [autoCollab, setAutoCollab] = useState(true)
  const autoCollabRef = useRef(true)
  useEffect(() => { autoCollabRef.current = autoCollab }, [autoCollab])
  const [inboundOffer]              = useState(() => getInviteOfferFromHash())

  const workerRef      = useRef(null)
  const resolveGenRef  = useRef(null)
  const fullOutputRef  = useRef('')
  const summaryReqSeq  = useRef(0)
  const summaryPending = useRef(new Map()) // id -> { resolve, reject }
  const pmRef          = useRef(null)
  const inviteSlotSeq  = useRef(0)

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
        case 'summary': {
          const p = summaryPending.current.get(msg.id)
          if (p) { summaryPending.current.delete(msg.id); p.resolve(msg.text) }
          break
        }
        case 'summary_error': {
          const p = summaryPending.current.get(msg.id)
          if (p) { summaryPending.current.delete(msg.id); p.reject(new Error(msg.error)) }
          break
        }
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

  // ── Embedding worker (semantic RAG) ────────────────────────────────
  // Separate worker so embedding the codebase never contends with the LLM.
  const embedWorkerRef = useRef(null)
  const embedReqSeq    = useRef(0)
  const embedPending   = useRef(new Map())

  useEffect(() => {
    const worker = new Worker(
      new URL('./workers/embedding.worker.js', import.meta.url),
      { type: 'module' }
    )
    embedWorkerRef.current = worker

    worker.onmessage = (e) => {
      const msg = e.data
      if (msg.status === 'model-progress') return // first-load weight download
      const pend = embedPending.current.get(msg.id)
      if (!pend) return
      embedPending.current.delete(msg.id)
      if (msg.status === 'embedded') pend.resolve(msg.vectors)
      else pend.reject(new Error(msg.error || 'embed failed'))
    }
    worker.onerror = (e) => {
      const err = new Error(e.message || 'embedding worker crashed')
      for (const pend of embedPending.current.values()) pend.reject(err)
      embedPending.current.clear()
    }

    // Wire codeRag's embedder to round-trip through this worker.
    setEmbedder((texts) => new Promise((resolve, reject) => {
      const id = ++embedReqSeq.current
      embedPending.current.set(id, { resolve, reject })
      worker.postMessage({ id, action: 'embed', texts })
    }))

    return () => worker.terminate()
  }, [])

  // Embed the current index in the background, surfacing progress for the UI.
  const runEmbedding = useCallback(() => {
    setEmbedStatus({ done: 0, total: getIndexStats().files })
    embedIndex((done, total) => setEmbedStatus({ done, total }))
      .then(() => {
        setEmbedStatus('ready')
        setRagStats(getIndexStats())
      })
      .catch(() => setEmbedStatus(null))
  }, [])

  // Lazy-load the real tokenizer once so the savings badge is accurate.
  useEffect(() => { initTokenizer() }, [])

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
      const repoName = await cloneRepo(url.trim(), () => {})
      const root = `/${repoName}`
      const tree = await listFiles()
      setFileTree(tree)
      setCloneStatus('done')
      hasRepoRef.current = true

      // Build a .gitignore-aware filter so noise (deps, build output, binaries)
      // stays out of the index. Absent .gitignore → defaults still apply.
      let gitignoreText = ''
      try { gitignoreText = await readFile(`${root}/.gitignore`) } catch { /* no .gitignore */ }
      const ig = buildIgnore(gitignoreText)

      // Tell the herd which repo we're on so peers can sync to it
      if (pmRef.current) {
        pmRef.current.myRepo = url.trim()
        pmRef.current.broadcast({ type: 'repo', url: url.trim() })
      }

      // Index all files for RAG in the background
      await indexAllFiles(tree, ig, root)
      setRagStats(getIndexStats())
      // Compute semantic embeddings in the background (non-blocking).
      runEmbedding()
    } catch (err) {
      setCloneStatus('error')
      setAgentError(err.message)
    }
  }, [runEmbedding])

  // Latest doClone, callable from PeerManager callbacks created at herd start
  const doCloneRef = useRef(doClone)
  useEffect(() => { doCloneRef.current = doClone }, [doClone])

  const handleClone = useCallback(() => doClone(repoUrl), [doClone, repoUrl])

  const handleSelectFile = useCallback(async (node) => {
    if (node.type !== 'file') return
    const content = await readFile(node.path)
    setSelectedFile({ path: node.path, content })
    setDiff(null)
    setAgentError('')
    setActivePanel('chat')
  }, [])

  // ── Agent run ──────────────────────────────────────────────────────
  // Refs mirroring state so PeerManager callbacks (created once) see live values
  const selectedFileRef = useRef(null)
  useEffect(() => { selectedFileRef.current = selectedFile }, [selectedFile])
  const modelReadyRef = useRef(false)
  useEffect(() => { modelReadyRef.current = modelStatus === 'ready' }, [modelStatus])
  const busyRef = useRef(false)

  const generate = useCallback(async (msgs) => {
    setIsStreaming(true)
    setStreamingContent('')
    setAgentError('')
    fullOutputRef.current = ''
    workerRef.current.postMessage({ action: 'generate', messages: msgs, gen: Date.now() })
    const result = await new Promise(resolve => { resolveGenRef.current = resolve })
    setIsStreaming(false)
    setStreamingContent('')
    return result
  }, [])

  // One-shot summarization via the local model, for the "summary" context
  // strategy. Resolves with the model's plain-text summary of `promptText`.
  const summarize = useCallback((promptText) => new Promise((resolve, reject) => {
    const id = ++summaryReqSeq.current
    summaryPending.current.set(id, { resolve, reject })
    workerRef.current.postMessage({
      action: 'summarize',
      id,
      messages: [
        { role: 'system', content: 'You summarize source files for a coding agent. Reply with 2–3 plain sentences describing what the file does and its key functions/exports. No code, no preamble.' },
        { role: 'user', content: promptText },
      ],
    })
  }), [])

  // Run a task with the local model. File mode if a file is selected (and not
  // forced to project scope); otherwise project mode: RAG picks target files
  // and the model emits FILE:-headed patches that may span several files.
  // Returns { answer } or { diffObj } or { error }.
  const runTask = useCallback(async (userText, { projectScope = false } = {}) => {
    if (busyRef.current || !modelReadyRef.current) return { error: 'busy or model not ready' }
    busyRef.current = true
    try {
      const file = projectScope ? null : selectedFileRef.current
      const crunch = await buildContext(contextStrategyRef.current, userText, { topK: 4, summarize })
      const contextBlock = crunch.block
      setCrunchStats({ strategy: contextStrategyRef.current, ...crunch })
      let msgs
      if (file) {
        msgs = buildPrompt(file.path, file.content, userText, contextBlock, myRoleRef.current)
      } else {
        // Project mode: feed top-2 RAG hits in full, rest stays in context block
        const hits = await retrieveContextHybrid(userText, 3)
        const sections = []
        for (const h of hits.slice(0, 2)) {
          try { sections.push({ path: h.path, content: await readFile(h.path) }) } catch { /* deleted */ }
        }
        msgs = buildProjectPrompt(userText, sections, contextBlock, myRoleRef.current)
      }

      const result = await generate(msgs)
      if (result?.error) return { error: result.error }
      const rawOutput = fullOutputRef.current

      if (file) {
        const blocks = parseSearchReplace(rawOutput)
        if (blocks.length === 0) return { answer: rawOutput }
        const newContent = applyPatches(file.content, blocks)
        const patch = generateUnifiedDiff(file.path, file.content, newContent)
        return { diffObj: { path: file.path, before: file.content, after: newContent, patch, files: [{ path: file.path, before: file.content, after: newContent }] } }
      }

      const filePatches = parseFilePatches(rawOutput)
      if (filePatches.length === 0) return { answer: rawOutput }
      const files = []
      for (const fp of filePatches) {
        const before = await readFile(fp.path)
        const after = applyPatches(before, fp.blocks)
        files.push({ path: fp.path, before, after })
      }
      const patch = files.map(f => generateUnifiedDiff(f.path, f.before, f.after)).join('\n')
      return { diffObj: { path: files.map(f => f.path).join(', '), patch, files } }
    } catch (err) {
      return { error: err.message, raw: fullOutputRef.current }
    } finally {
      busyRef.current = false
    }
  }, [generate, summarize])

  const presentResult = useCallback((res, { broadcast = true } = {}) => {
    if (res.error) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠ ${res.error}${res.raw ? `\n\nRaw output:\n${res.raw}` : ''}` }])
      return
    }
    if (res.answer) {
      setMessages(prev => [...prev, { role: 'assistant', content: res.answer }])
      if (broadcast) pmRef.current?.broadcast({ type: 'chat', content: `✦ answered: ${res.answer.slice(0, 500)}` })
      return
    }
    const d = res.diffObj
    setDiff(d)
    setMessages(prev => [...prev, { role: 'assistant', content: `Generated changes to ${d.path}. Review the diff →` }])
    if (broadcast) pmRef.current?.broadcast({ type: 'diff', path: d.path, patch: d.patch, files: d.files })
  }, [])

  // Collaborate on a peer's task: run it locally (project scope), reply with
  // the result, and hand the conversation back with one fewer round left.
  const collabRef = useRef(() => {})
  async function collaborate(from, task, rounds) {
    if (!modelReadyRef.current || busyRef.current || !hasRepoRef.current) return
    setMessages(prev => [...prev, { role: 'system', content: `🤖 collaborating on ${from}'s task (${rounds} rounds left)…` }])
    const res = await runTask(task, { projectScope: true })
    if (res.error) return
    presentResult(res, { broadcast: false })
    const summary = res.answer
      ? res.answer.slice(0, 500)
      : `proposed a patch to ${res.diffObj.path}`
    pmRef.current?.broadcast({
      type: 'chat',
      content: `✦ on ${from}'s task: ${summary}`,
      task: rounds > 1
        ? `Task: ${task}\nPeer ${from} progress: ${summary}\nContinue the task, improve the result, or reply DONE if complete.`
        : undefined,
      rounds: rounds - 1,
    })
    if (res.diffObj) {
      pmRef.current?.broadcast({ type: 'diff', path: res.diffObj.path, patch: res.diffObj.patch, files: res.diffObj.files })
    }
  }
  useEffect(() => { collabRef.current = collaborate })

  // Human assigns a herd task: broadcast it to every agent (each works it
  // from its own role's perspective) and run it locally with our role too.
  const assignHerdTask = useCallback(async (taskText) => {
    const text = taskText.trim()
    if (!text || !hasRepoRef.current) return
    setActivePanel('chat')
    setMessages(prev => [...prev, { role: 'user', content: `🎯 Herd task: ${text}` }])
    pmRef.current?.broadcast({
      type: 'chat',
      content: `🎯 assigned a herd task: ${text}`,
      task: text,
      rounds: 4,
    })
    if (modelReadyRef.current && !busyRef.current) {
      presentResult(await runTask(text, { projectScope: true }))
    } else {
      setMessages(prev => [...prev, { role: 'system', content: '⏳ Task sent to the herd — load a model to contribute locally too.' }])
    }
  }, [runTask, presentResult])

  const handleSend = useCallback(async () => {
    const hasWorkspace = selectedFile || hasRepoRef.current
    if (!hasWorkspace || !prompt.trim() || modelStatus !== 'ready' || isStreaming) return

    const userText = prompt.trim()
    setPrompt('')
    setMessages(prev => [...prev, { role: 'user', content: userText }])
    pmRef.current?.broadcast({
      type: 'chat',
      content: `🧑 task${selectedFile ? ` on ${selectedFile.path}` : ''}: ${userText}`,
      task: userText,
      rounds: 4,
    })
    presentResult(await runTask(userText))
  }, [selectedFile, prompt, modelStatus, isStreaming, runTask, presentResult])

  const handleApplyDiff = useCallback(async () => {
    if (!diff) return
    const files = diff.files ?? [{ path: diff.path, after: diff.after }]
    for (const f of files) {
      await writeFile(f.path, f.after)
      indexFile(f.path, f.after)
    }
    pmRef.current?.broadcast({
      type: 'chat',
      content: `✅ applied ${diff.from ? `${diff.from}'s` : 'a'} patch to ${diff.path}`,
    })
    setRagStats(getIndexStats())
    runEmbedding() // re-embed the patched files (cache covers the unchanged rest)
    const last = files[files.length - 1]
    setSelectedFile({ path: last.path, content: last.after })
    setDiff(null)
  }, [diff, runEmbedding])

  // ── Agent herd (AgentHerd-style full-mesh WebRTC) ──────────────────
  const refreshPeers = useCallback(() => {
    const pm = pmRef.current
    setPeers(pm ? [...pm.peers.values()].map(p => ({
      name: p.name, role: p.role, modelLabel: p.modelLabel, repo: p.repo, state: p.state,
    })) : [])
  }, [])

  const startHerd = useCallback(async () => {
    const name = agentName.trim()
    if (!name || pmRef.current) return

    const pm = new PeerManager({
      myName: name,
      myRole: myRole,
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
          // Collaborate: run the peer's task on our local model and reply.
          // rounds caps the back-and-forth so two agents can't loop forever.
          if (msg.task && msg.rounds > 0 && autoCollabRef.current) {
            collabRef.current(from, msg.task, msg.rounds)
          }
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
          if (msg.files?.length) {
            setDiff({ path: msg.path, patch: msg.patch, files: msg.files, from })
          } else if (msg.before != null && msg.after != null) {
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
  }, [agentName, myRole, selectedModel, repoUrl, inboundOffer, refreshPeers])

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
              myRole={myRole}
              setMyRole={setMyRole}
              onAssignTask={assignHerdTask}
              taskReady={cloneStatus === 'done'}
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
              autoCollab={autoCollab}
              setAutoCollab={setAutoCollab}
              status={herdStatus}
            />
          ) : (
            <Sidebar
              tree={fileTree}
              onSelect={handleSelectFile}
              selected={selectedFile?.path}
              ragStats={ragStats}
              embedStatus={embedStatus}
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
            disabled={isStreaming || modelStatus !== 'ready' || (!selectedFile && cloneStatus !== 'done')}
            selectedFile={selectedFile}
            ragStats={ragStats}
            embedStatus={embedStatus}
            modelStatus={modelStatus}
            contextStrategy={contextStrategy}
            setContextStrategy={setContextStrategy}
            crunchStats={crunchStats}
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
