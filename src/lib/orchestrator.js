import { compressCode, detectContentType } from './codeCompressor.js'

const SEARCH_REPLACE_RE = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g

export function parseSearchReplace(output) {
  const blocks = []
  let match
  const re = new RegExp(SEARCH_REPLACE_RE.source, 'g')
  while ((match = re.exec(output)) !== null) {
    blocks.push({ search: match[1], replace: match[2] })
  }
  return blocks
}

export function applyPatches(source, blocks) {
  let result = source
  for (const { search, replace } of blocks) {
    if (!result.includes(search)) {
      throw new Error(
        `SEARCH block not found in file:\n---\n${search.slice(0, 120)}\n---`
      )
    }
    result = result.replace(search, replace)
  }
  return result
}

// Rough token estimate: 1 token ≈ 4 chars
const rough = (s) => Math.ceil(s.length / 4)

// Budget constants (leave ~1200 tokens for output)
const CTX_BUDGET   = 4096
const SYS_RESERVE  = 300   // system prompt tokens
const OUT_RESERVE  = 1200  // headroom for generation
const USER_BUDGET  = CTX_BUDGET - SYS_RESERVE - OUT_RESERVE  // ~2596 tokens ≈ ~10384 chars

export function buildPrompt(filePath, fileContent, userPrompt, contextBlock = '') {
  // 1. Always compress the file — keep signatures/imports, stub bodies
  const fileSection = fitFileContent(filePath, fileContent, userPrompt, contextBlock)

  return [
    {
      role: 'system',
      content: `You are DevPal, an expert AI coding agent. Output ONLY SEARCH/REPLACE blocks:

<<<<<<< SEARCH
[exact lines from file]
=======
[replacement]
>>>>>>> REPLACE

Rules: SEARCH must match exactly (whitespace matters). No prose. Multiple changes = multiple blocks.`,
    },
    { role: 'user', content: fileSection },
  ]
}

function fitFileContent(filePath, fileContent, userPrompt, contextBlock) {
  const taskLine = `Task: ${userPrompt}`
  const taskTokens = rough(taskLine)

  // Try full file first
  let fileBlock = `File: ${filePath}\n\`\`\`\n${fileContent}\n\`\`\``
  let contextSection = ''

  const available = USER_BUDGET - taskTokens - 20

  // Fit context block (use up to 30% of budget)
  if (contextBlock) {
    const ctxBudget = Math.floor(available * 0.3)
    const truncated = truncateToTokens(contextBlock, ctxBudget)
    if (truncated) contextSection = `\n\n${truncated}\n---`
  }

  const contextTokens = rough(contextSection)
  const fileBudget = available - contextTokens

  // If file fits, use as-is
  if (rough(fileBlock) <= fileBudget) {
    return `${fileBlock}${contextSection}\n\n${taskLine}`
  }

  // Try compressed version of the file
  const type = detectContentType(fileContent)
  const compressed = type === 'code' ? compressCode(fileContent) : fileContent
  fileBlock = `File: ${filePath} (compressed)\n\`\`\`\n${compressed}\n\`\`\``

  if (rough(fileBlock) <= fileBudget) {
    return `${fileBlock}${contextSection}\n\n${taskLine}`
  }

  // Last resort: truncate file to budget
  const maxChars = fileBudget * 4 - filePath.length - 30
  const truncatedFile = (type === 'code' ? compressed : fileContent).slice(0, maxChars)
  fileBlock = `File: ${filePath} (truncated)\n\`\`\`\n${truncatedFile}\n… [truncated]\n\`\`\``
  return `${fileBlock}${contextSection}\n\n${taskLine}`
}

function truncateToTokens(text, maxTokens) {
  const maxChars = maxTokens * 4
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n… [context truncated]'
}

export function generateUnifiedDiff(filePath, before, after) {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const patch = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((l) => `-${l}`),
    ...afterLines.map((l) => `+${l}`),
  ].join('\n')
  return patch
}
