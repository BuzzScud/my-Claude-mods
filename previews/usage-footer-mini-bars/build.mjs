// Bundles the drawing code (today's 0.5.0 and the new 0.6.0), adds the real Claude Code
// captures, writes the page. `bun build.mjs`
import { readFileSync, writeFileSync } from 'node:fs'
const here = decodeURIComponent(new URL('.', import.meta.url).pathname)
const out = await Bun.build({ entrypoints: [here + 'src/entry.ts'], format: 'iife', target: 'browser', minify: false })
if (!out.success) { console.log(out.logs); process.exit(1) }
const code = await out.outputs[0].text()
// Each capture: the footer row (the last row), cut to the window's width.
const frames = JSON.parse(readFileSync(here + 'run/next-frames.json', 'utf8'))
const real = frames.filter(f => /^(w|work|bg)\d+$/.test(f.label) && Number(f.label.replace(/\D/g, '')) <= f.columns).map(f => {
  const width = Number(f.label.replace(/\D/g, ''))
  const y = f.rows - 1
  const row = []
  for (let x = 0; x < width; x++) { const i = (y * f.columns + x) * 3; row.push(f.words[i], f.words[i + 1], f.words[i + 2]) }
  return { label: f.label, columns: width, row }
})
const note = 'Claude Code v2.1.295 · Haiku (200k window) · bypass mode · a renamed copy of the new add-on · 9 Oct 11:15'
const template = readFileSync(here + 'page.template.html', 'utf8')
const page = template
  .replace('/*ROW*/', () => code)
  .replace('/*REAL*/', () => `window.REAL = ${JSON.stringify(real)};\nwindow.REAL_NOTE = ${JSON.stringify(note)};\nwindow.SHOWN = ${readFileSync(here + 'terminal-colors.json', 'utf8')};`)
const target = process.env.OUT ?? here + 'footer-mini-bars-2026-10-09.html'
writeFileSync(target, page)
console.log('wrote', target, (page.length / 1024).toFixed(0) + ' KB,', real.length, 'captures')
