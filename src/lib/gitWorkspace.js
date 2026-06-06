import LightningFS from '@isomorphic-git/lightning-fs'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'

const CORS_PROXY = 'https://cors.isomorphic-git.org'

let fs = null
let dir = '/'

export function initFS(repoName) {
  fs = new LightningFS(repoName)
  dir = `/${repoName}`
}

export async function cloneRepo(url, onProgress) {
  const repoName = url.split('/').filter(Boolean).pop().replace(/\.git$/, '')
  initFS(repoName)

  await git.clone({
    fs,
    http,
    dir,
    url,
    corsProxy: CORS_PROXY,
    singleBranch: true,
    depth: 1,
    onProgress,
  })

  return repoName
}

export async function listFiles(path = dir) {
  const entries = await fs.promises.readdir(path)
  const result = []

  for (const name of entries) {
    if (name === '.git') continue
    const fullPath = `${path}/${name}`
    const stat = await fs.promises.stat(fullPath)
    if (stat.isDirectory()) {
      const children = await listFiles(fullPath)
      result.push({ name, path: fullPath, type: 'dir', children })
    } else {
      result.push({ name, path: fullPath, type: 'file' })
    }
  }

  return result
}

export async function readFile(path) {
  const buf = await fs.promises.readFile(path)
  return new TextDecoder().decode(buf)
}

export async function writeFile(path, content) {
  await fs.promises.writeFile(path, content)
}

export async function getDiff() {
  const FILE = 0, WORKDIR = 2, STAGE = 3
  const matrix = await git.walk({
    fs,
    dir,
    trees: [git.TREE({ ref: 'HEAD' }), git.WORKDIR(), git.STAGE()],
    map: async (filepath, [head, workdir]) => {
      if (!workdir) return null
      const headContent = head ? await head.content() : null
      const workContent = await workdir.content()
      if (headContent && Buffer.from(headContent).equals(Buffer.from(workContent))) return null
      return {
        path: filepath,
        before: headContent ? new TextDecoder().decode(headContent) : '',
        after: new TextDecoder().decode(workContent),
      }
    },
  })

  return matrix.filter(Boolean)
}

export async function buildPatch(diffs) {
  const lines = []
  for (const { path, before, after } of diffs) {
    lines.push(`--- a/${path}`)
    lines.push(`+++ b/${path}`)
    const beforeLines = before.split('\n')
    const afterLines = after.split('\n')
    lines.push(`@@ -1,${beforeLines.length} +1,${afterLines.length} @@`)
    for (const l of beforeLines) lines.push(`-${l}`)
    for (const l of afterLines) lines.push(`+${l}`)
  }
  return lines.join('\n')
}
