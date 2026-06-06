export default function ModelLoader({ progress }) {
  const text = progress?.text ?? 'Initializing…'
  const pct = progress
    ? progress.progress != null
      ? Math.round(progress.progress * 100)
      : null
    : null

  return (
    <div className="shrink-0 bg-indigo-950 border-b border-indigo-800 px-4 py-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-indigo-300">Downloading model weights (cached after first load)</span>
        {pct != null && <span className="text-xs text-indigo-300">{pct}%</span>}
      </div>
      <div className="h-1.5 bg-indigo-900 rounded overflow-hidden">
        {pct != null && (
          <div
            className="h-full bg-indigo-400 transition-all"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <p className="text-xs text-indigo-400 mt-1 truncate">{text}</p>
    </div>
  )
}
