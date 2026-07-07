// Second pass: get the diff viewer screenshot with Qwen Coder 1.5B (cached in profile)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const URL = 'http://localhost:5182/DevPal/'
const OUT = path.resolve(import.meta.dirname, '..', 'article-assets')
const PROFILE = path.resolve(import.meta.dirname, '..', '.pptr-profile')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const REPO = 'https://github.com/vishalmysore/choturobo'

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false, userDataDir: PROFILE, defaultViewport: null,
  args: ['--window-size=1600,950', '--no-first-run', '--no-default-browser-check'],
})
const page = (await browser.pages())[0] ?? await browser.newPage()
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name) }); log('shot', name) }
async function waitFor(desc, fn, timeoutMs, intervalMs = 2000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try { if (await page.evaluate(fn)) { log('ok:', desc); return true } } catch {}
    await sleep(intervalMs)
  }
  log('TIMEOUT:', desc); return false
}
const clickByText = (text) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(t))
  if (b) b.click(); return !!b
}, text)

try {
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(1200)
  await page.click('input[placeholder="https://github.com/user/repo"]')
  await page.type('input[placeholder="https://github.com/user/repo"]', REPO, { delay: 5 })
  await clickByText('Clone')
  await waitFor('cloned', () => document.body.innerText.includes('RAG:'), 90000)

  await page.evaluate(() => {
    const dd = [...document.querySelectorAll('button')].find(b => b.textContent.includes('▾') && b.textContent.includes('B —'))
    dd?.click()
  })
  await sleep(500)
  await clickByText('Qwen Coder 1.5B')
  await sleep(500)
  await clickByText('Load Engine')
  const ready = await waitFor('model ready',
    () => [...document.querySelectorAll('input,textarea')].some(i => (i.placeholder ?? '').startsWith('Ask DevPal')),
    600000, 3000)
  if (!ready) throw new Error('model not ready')

  await clickByText('package.json')
  await sleep(800)
  const prompt = [
    'Bump the version to 0.2.0. Respond with exactly this and nothing else:',
    '<<<<<<< SEARCH',
    '  "version": "0.1.0",',
    '=======',
    '  "version": "0.2.0",',
    '>>>>>>> REPLACE',
  ].join('\n')
  await page.evaluate((p) => {
    const input = [...document.querySelectorAll('input,textarea')].find(i => (i.placeholder ?? '').startsWith('Ask DevPal'))
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, p)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  }, prompt)
  log('prompt sent')
  await waitFor('done', () => {
    const t = document.body.innerText
    return !t.includes('⏹') && (t.includes('Generated changes') || t.match(/✦/))
  }, 420000, 3000)
  await sleep(1500)
  const hasDiff = await page.evaluate(() => document.body.innerText.includes('✓ Apply'))
  log('diff produced:', hasDiff)
  if (hasDiff) {
    await shot('07-diff-viewer.png')
    await clickByText('✓ Apply')
    await sleep(1500)
    await shot('07b-applied.png')
  } else {
    await shot('07-no-diff.png')
    const t = await page.evaluate(() => { const b = document.body.innerText; const i = b.lastIndexOf('✦'); return b.slice(i, i + 400) })
    log('model output tail:', JSON.stringify(t))
  }
  log('DONE')
} catch (err) {
  log('ERROR:', err.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
