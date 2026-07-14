/**
 * Tree-sitter signature extraction — AST-precise replacement for the regex
 * skeleton in codeCompressor. Parses real grammars, so it correctly handles
 * multi-line signatures, generics, decorators, nested classes/methods, and
 * language quirks the regex can't. Everything is lazy: the runtime wasm and
 * each grammar are only fetched the first time a file of that language is seen,
 * and results are cached. Any failure (unsupported language, parse error,
 * wasm blocked) returns null so callers fall back to the regex extractor.
 *
 * The `?url` imports let Vite fingerprint the wasm assets and serve them under
 * the app's base path (`/DevPal/…`), so this works in dev and on GitHub Pages
 * without hardcoding any URLs.
 */
// web-tree-sitter is pinned to 0.20.8 so its runtime ABI matches the
// tree-sitter-wasms grammars (built with tree-sitter-cli 0.20.8). Newer
// runtimes (0.22+) expect a `dylink.0` section these grammars don't carry.
// 0.20.8 is CommonJS: default export is the Parser class, Language.load is a
// static on it, and the runtime wasm ships as tree-sitter.wasm.
import Parser from 'web-tree-sitter'
import runtimeWasmUrl from 'web-tree-sitter/tree-sitter.wasm?url'

import jsWasm      from 'tree-sitter-wasms/out/tree-sitter-javascript.wasm?url'
import tsWasm      from 'tree-sitter-wasms/out/tree-sitter-typescript.wasm?url'
import tsxWasm     from 'tree-sitter-wasms/out/tree-sitter-tsx.wasm?url'
import pyWasm      from 'tree-sitter-wasms/out/tree-sitter-python.wasm?url'
import javaWasm    from 'tree-sitter-wasms/out/tree-sitter-java.wasm?url'
import goWasm      from 'tree-sitter-wasms/out/tree-sitter-go.wasm?url'
import rustWasm    from 'tree-sitter-wasms/out/tree-sitter-rust.wasm?url'
import rubyWasm    from 'tree-sitter-wasms/out/tree-sitter-ruby.wasm?url'
import cppWasm     from 'tree-sitter-wasms/out/tree-sitter-cpp.wasm?url'
import cWasm       from 'tree-sitter-wasms/out/tree-sitter-c.wasm?url'
import csWasm      from 'tree-sitter-wasms/out/tree-sitter-c_sharp.wasm?url'
import phpWasm     from 'tree-sitter-wasms/out/tree-sitter-php.wasm?url'

const GRAMMARS = {
  javascript: jsWasm, typescript: tsWasm, tsx: tsxWasm, python: pyWasm,
  java: javaWasm, go: goWasm, rust: rustWasm, ruby: rubyWasm,
  cpp: cppWasm, c: cWasm, c_sharp: csWasm, php: phpWasm,
}

const EXT_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  py: 'python', pyi: 'python', java: 'java', go: 'go', rs: 'rust',
  rb: 'ruby', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  c: 'c', h: 'c', cs: 'c_sharp', php: 'php',
}

export function tsLangForPath(path) {
  const ext = path.split('.').pop()?.toLowerCase()
  return EXT_LANG[ext] ?? null
}

export function isTreeSitterSupported(path) {
  return tsLangForPath(path) !== null
}

let _initPromise = null
const _langCache = new Map() // lang -> Promise<Language>

async function ensureParser() {
  if (!_initPromise) {
    _initPromise = Parser.init({ locateFile: () => runtimeWasmUrl })
  }
  await _initPromise
}

function loadLang(lang) {
  if (_langCache.has(lang)) return _langCache.get(lang)
  const url = GRAMMARS[lang]
  if (!url) return null
  // Parser.Language is only populated after Parser.init(); callers await
  // ensureParser() first, so it's available by the time we get here.
  const p = Parser.Language.load(url).catch(() => null)
  _langCache.set(lang, p)
  return p
}

// Node types that carry a callable signature; emitted, but not descended into.
const FUNC_TYPES = new Set([
  'function_declaration', 'function_definition', 'function_item',
  'method_definition', 'method_declaration', 'constructor_declaration',
  'arrow_function', 'function_expression', 'method', 'function',
])

// Container types whose bodies hold more declarations (list their members).
const CONTAINER_TYPES = new Set([
  'class_declaration', 'class_definition', 'class_specifier', 'class',
  'interface_declaration', 'struct_item', 'struct_specifier',
  'enum_declaration', 'enum_specifier', 'enum_item', 'enum_item_list',
  'impl_item', 'trait_item', 'module', 'namespace_definition',
  'type_alias_declaration',
])

const MAX_SIGS = 80

// The signature = node text up to where its body begins, whitespace-collapsed.
function signatureOf(node, source) {
  const body =
    node.childForFieldName?.('body') ??
    node.namedChildren.find(c => /body|block|declaration_list|field_declaration_list/.test(c.type))
  const raw = body
    ? source.slice(node.startIndex, body.startIndex)
    : node.text.split('\n')[0]
  return raw.replace(/\s+/g, ' ').replace(/[{([:]\s*$/, '').trim()
}

// Anonymous function assigned to a name (e.g. `const f = () => …`) — recover
// the name from the enclosing declarator so the map reads usefully.
function namedSignature(node, source) {
  let sig = signatureOf(node, source)
  if (/^(async\s+)?(function\s*)?\(/.test(sig) || sig.startsWith('=>') || sig === 'async' || !sig) {
    let a = node.parent
    while (a && !['variable_declarator', 'assignment', 'pair', 'field_definition', 'public_field_definition'].includes(a.type)) {
      a = a.parent
    }
    const nameNode = a?.childForFieldName?.('name') ?? a?.childForFieldName?.('left') ?? a?.namedChildren?.[0]
    if (nameNode) sig = `${nameNode.text} = ${sig || '() => …'}`
  }
  return sig
}

function collect(node, source, out, depth) {
  for (const child of node.namedChildren) {
    if (out.length >= MAX_SIGS) return
    const t = child.type
    if (FUNC_TYPES.has(t)) {
      if (depth <= 1) {
        const sig = namedSignature(child, source)
        if (sig) out.push('  '.repeat(depth) + sig)
      }
      continue // never descend into a function body
    }
    if (CONTAINER_TYPES.has(t)) {
      if (depth <= 1) {
        const sig = signatureOf(child, source)
        if (sig) out.push('  '.repeat(depth) + sig)
      }
      collect(child, source, out, depth + 1)
      continue
    }
    // Wrappers/statements (export, decorated, declarations): descend to reach
    // the declaration inside, without going deeper structurally.
    if (depth <= 1) collect(child, source, out, depth)
  }
}

/**
 * Extract a signature skeleton via tree-sitter. Returns an array of one-line
 * signatures (methods indented under their class), or null if the language
 * isn't supported or parsing fails — callers should fall back to the regex
 * extractor in that case.
 */
export async function extractSignaturesAST(path, source) {
  const lang = tsLangForPath(path)
  if (!lang || !source) return null
  let parser = null
  try {
    await ensureParser()
    const language = await loadLang(lang)
    if (!language) return null
    parser = new Parser()
    parser.setLanguage(language)
    const tree = parser.parse(source)
    if (!tree) return null
    const out = []
    collect(tree.rootNode, source, out, 0)
    tree.delete?.()
    return out
  } catch {
    return null
  } finally {
    parser?.delete?.()
  }
}
