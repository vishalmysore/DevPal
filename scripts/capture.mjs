// Article screenshot capture — drives DevPal end-to-end with puppeteer-core
// against the local vite dev server and saves PNGs to article-assets/.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const URL = 'http://localhost:5182/DevPal/'
const OUT = path.resolve(import.meta.dirname, '..', 'article-assets')
const PROFILE = path.resolve(import.meta.dirname, '..', '.pptr-profile')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const REPO = 'https://github.com/vishalmysore/choturobo'
const MODEL_LABEL = 'Qwen Coder 1.5B'

fs.mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  defaultViewport: null,
  args: ['--window-size=1600,950', '--no-first-run', '--no-default-browser-check'],
})

const page = (await browser.pages())[0] ?? await browser.newPage()
const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, name) })
  log('shot', name)
}

// Poll until fn() is truthy inside the page
async function waitFor(desc, fn, timeoutMs, intervalMs = 2000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try { if (await page.evaluate(fn)) { log('ok:', desc); return true } } catch {}
    await sleep(intervalMs)
  }
  log('TIMEOUT:', desc)
  return false
}

const clickByText = (text) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(t))
  if (b) b.click()
  return !!b
}, text)

try {
  log('goto', URL)
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(1500)
  await shot('01-home.png')

  // ── Clone ──
  await page.click('input[placeholder="https://github.com/user/repo"]')
  await page.type('input[placeholder="https://github.com/user/repo"]', REPO, { delay: 5 })
  await clickByText('Clone')
  await waitFor('repo cloned + indexed', () => document.body.innerText.includes('RAG:'), 90000)
  await sleep(1000)
  await shot('02-clone-rag.png')

  // ── Open a file ──
  await clickByText('choturobo.ts')
  await sleep(1200)
  await shot('03-file-viewer.png')

  // ── Load model (Qwen Coder 1.5B) ──
  // open dropdown and pick model
  await page.evaluate((label) => {
    const dd = [...document.querySelectorAll('button')].find(b => b.textContent.includes('▾') && b.textContent.includes('B —'))
    if (dd) dd.click()
    return true
  }, MODEL_LABEL)
  await sleep(600)
  const picked = await clickByText(MODEL_LABEL)
  log('model picked:', picked)
  await sleep(600)
  await clickByText('Load Engine')

  // mid-download screenshot
  await waitFor('download started', () => document.body.innerText.includes('Loading model'), 30000, 1000)
  await sleep(12000)
  await shot('04-model-loading.png')

  const ready = await waitFor('model ready',
    () => [...document.querySelectorAll('input,textarea')].some(i => (i.placeholder ?? '').startsWith('Ask DevPal')),
    600000, 3000)
  if (!ready) throw new Error('model never became ready')
  await sleep(1000)

  // ── Select package.json and ask for an edit ──
  await clickByText('package.json')
  await sleep(1000)
  const prompt = 'Change the version field from 0.1.0 to 0.2.0'
  await page.evaluate((p) => {
    const input = [...document.querySelectorAll('input,textarea')].find(i => (i.placeholder ?? '').startsWith('Ask DevPal'))
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, p)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  }, prompt)
  log('prompt sent')

  await waitFor('streaming started', () => document.body.innerText.includes('⏹'), 30000, 1000)
  await sleep(6000)
  await shot('05-streaming.png')

  await waitFor('generation done', () => !document.body.innerText.includes('⏹'), 420000, 3000)
  await sleep(1000)
  await shot('06-response.png')

  const hasDiff = await page.evaluate(() => document.body.innerText.includes('✓ Apply'))
  log('diff produced:', hasDiff)
  if (hasDiff) {
    await shot('07-diff-viewer.png')
  }

  // ── Agent Herd panel ──
  await page.click('button[title="Agent Herd"]')
  await sleep(800)
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('input')].find(i => i.placeholder === 'e.g. Alice')
    if (!input) return
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Alice')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(300)
  await clickByText('Start herd')
  await sleep(800)
  await clickByText('Create invite link')
  await waitFor('invite created', () => document.body.innerText.includes('Copy invite link'), 30000, 1000)
  await sleep(500)
  await shot('08-agent-herd.png')

  log('DONE')
} catch (err) {
  log('ERROR:', err.message)
  try { await shot('99-error-state.png') } catch {}
  process.exitCode = 1
} finally {
  await browser.close()
}
