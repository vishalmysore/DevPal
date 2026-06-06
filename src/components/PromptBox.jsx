export default function PromptBox({ prompt, setPrompt, onRun, disabled, agentStatus, selectedFile, modelStatus }) {
  const hint = !selectedFile
    ? 'Select a file to edit.'
    : modelStatus !== 'ready'
    ? 'Load the AI engine first.'
    : 'Describe the change you want.'

  return (
    <div className="flex flex-col flex-1 p-3 gap-3">
      <p className="text-xs text-gray-500 uppercase tracking-wider">Prompt</p>
      {selectedFile && (
        <div className="text-xs text-purple-400 truncate">📄 {selectedFile.path.split('/').pop()}</div>
      )}
      <textarea
        className="flex-1 resize-none bg-gray-800 border border-gray-700 rounded p-2 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500"
        placeholder={hint}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={disabled && agentStatus === 'running'}
      />
      <button
        onClick={onRun}
        disabled={disabled}
        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-bold transition-colors"
      >
        {agentStatus === 'running' ? '⚡ Running…' : '⚡ Run Local Agent'}
      </button>
      <p className="text-xs text-gray-600 text-center">
        All inference runs locally via WebGPU.
        <br />Your code never leaves this browser.
      </p>
    </div>
  )
}
