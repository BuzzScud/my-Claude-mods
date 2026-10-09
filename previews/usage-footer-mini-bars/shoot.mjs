// Each tab at the owner's window size, a smaller one and a phone, in WebKit and Chromium:
// fit checks, script errors, requests outside the file, and pictures.
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
// Playwright from any project that has it installed (PLAYWRIGHT_FROM = that project's package.json).
const require = createRequire(process.env.PLAYWRIGHT_FROM ?? join(homedir(), 'Desktop/MAIN2026/package.json'))
const { webkit, chromium } = require('playwright')
const here = decodeURIComponent(new URL('.', import.meta.url).pathname)
const page = process.argv[2] ?? here + 'footer-mini-bars-2026-10-09.html'
let problems = 0
for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) {
  const browser = await engine.launch()
  for (const [w, h] of [[1803, 890], [1466, 890], [390, 844]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h } })
    const errors = [], outside = []
    p.on('pageerror', e => errors.push(String(e)))
    p.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) outside.push(r.url()) })
    await p.goto('file://' + page)
    await p.waitForTimeout(500)
    if (name === 'webkit' && w === 1803) console.log('charset', await p.evaluate(() => document.characterSet))
    for (const tab of ['before', 'bars', 'real', 'rules']) {
      await p.click(`nav [data-tab="${tab}"]`)
      await p.waitForTimeout(300)
      const fit = await p.evaluate(() => {
        const main = document.querySelector('main')
        const cut = [...document.querySelectorAll('.term')].filter(t => t.offsetParent && t.scrollWidth > t.clientWidth + 1).length
        return { main: main.scrollHeight - main.clientHeight, page: document.documentElement.scrollWidth - innerWidth, cut }
      })
      const bad = w >= 1400 ? fit.main > 0 || fit.page > 0 || fit.cut > 0 : fit.page > 0
      if (bad) problems++
      console.log(`${name} ${w}x${h} ${tab}: main overflow ${fit.main}, sideways ${fit.page}, cut rows ${fit.cut}${bad ? '  << PROBLEM' : ''}`)
      if (name === 'webkit' && w !== 1466) await p.screenshot({ path: `${here}shots/${tab}-${w}.png` })
    }
    if (errors.length) { problems++; console.log('page errors', errors) }
    if (outside.length) { problems++; console.log('requests outside the file', outside) }
    await p.close()
  }
  await browser.close()
}
console.log(problems === 0 ? 'all fit' : `${problems} problems`)
process.exit(problems === 0 ? 0 : 1)
