// Holds the page's drawing to the real captures: for each width and moment, the footer row
// as a real Claude Code drew it (a renamed copy of the new add-on, run/next-frames.json) vs
// the page's drawing of the same numbers, cell by cell: glyph, ink and background.
import { readFileSync } from 'node:fs'
import './entry'
import type { Sample } from './samples'

const ROW = (globalThis as any).ROW
const here = decodeURIComponent(new URL('..', import.meta.url).pathname)
const SHOWN: Record<string, number> = JSON.parse(readFileSync(here + 'terminal-colors.json', 'utf8'))
const shownOf = (color: number) => SHOWN[(color & 0xffffff).toString(16)] ?? color & 0xffffff
// A lit cell a step brighter is the same cell a moment later (breathing, the sweep, a flash).
const BRIGHT: Record<number, number> = { 0x5fafd7: 0xafd7ff, 0x5fd75f: 0x87ff87, 0xffd75f: 0xffff87, 0xff5f5f: 0xff8787 }
const DEF = 0x01000000
const HINTS: Record<string, string> = { w: '(shift+tab to cycle)', work: '(shift+tab to cycle)', bg: '1 shell · ↓ to manage' }

const frames = JSON.parse(readFileSync(here + 'run/next-frames.json', 'utf8'))
const footerOf = (f: any, width: number) => {
  const y = f.rows - 1
  const cells: number[] = []
  for (let x = 0; x < width; x++) { const i = (y * f.columns + x) * 3; cells.push(f.words[i], f.words[i + 1], f.words[i + 2]) }
  const text = Array.from({ length: width }, (_, x) => String.fromCodePoint(cells[x * 3]!)).join('')
  return { cells, text }
}
const tokensOf = (t: string) => (t.endsWith('k') ? Number(t.slice(0, -1)) * 1000 : Number(t))

// The run's moment and numbers, read from the captured line (and a wider one of the same kind for what a narrow one hides).
const sampleOf = (line: string, wide: string): Sample => {
  const pick = (re: RegExp) => line.match(re)?.[1] ?? wide.match(re)?.[1]
  const five = Number(pick(/5h\D*?(\d+)%/))
  const [h, m] = (pick(/5h[^%]*%\s+(\d+h \d+m)/) ?? '2h 31m').split(/h |m/).map(Number)
  const now = Date.parse('2026-10-09T17:50:00Z') - ((h ?? 0) * 60 + (m ?? 0)) * 60_000
  return {
    id: 'run', title: 'the test window', isReal: true, now,
    limits: [
      { kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-09T17:50:00Z' },
      { kind: 'seven_day', percentUsed: Number(pick(/wk\D*?(\d+)%/)), resetsAt: '2026-10-10T10:00:00Z' },
      { kind: 'seven_day_fable', percentUsed: Number(pick(/fable\D*?(\d+)%/)), label: 'fable', resetsAt: '2026-10-10T10:00:00Z' },
    ],
    context: { tokens: tokensOf(pick(/ctx[^%]*%\s+([\d.]+k)/) ?? '0'), window: 200_000, threshold: 167_000 },
  }
}

let problems = 0, checked = 0, cellsChecked = 0
const labels = ['w177', 'w167', 'w151', 'w149', 'w143', 'w142', 'w130', 'w120', 'w110', 'w100', 'work149', 'work120', 'bg177', 'bg149', 'bg130', 'bg120']
for (const label of labels) {
  const f = frames.find((one: any) => one.label === label)
  if (!f) { console.log(label, 'not captured'); problems++; continue }
  const kind = label.replace(/\d+$/, '')
  const width = Number(label.replace(/\D/g, ''))
  const real = footerOf(f, width)
  const wideLabel = kind === 'bg' ? 'bg177' : 'w177'
  const wide = footerOf(frames.find((one: any) => one.label === wideLabel), 177).text
  const scene = ROW.rowScene(sampleOf(real.text, wide), kind === 'work' ? 'working' : 'idle', 0)
  const drawn = ROW.drawNew(scene, width, HINTS[kind])
  const start = width - 2 - drawn.columns
  const want = Array.from({ length: drawn.columns }, (_, x) => String.fromCodePoint(drawn.words[x * 3])).join('')
  const got = real.text.slice(start, width - 2)
  checked++
  let off = 0
  for (let x = 0; x < drawn.columns; x++) {
    const i = (start + x) * 3
    const glyph = String.fromCodePoint(drawn.words[x * 3])
    const fg = drawn.words[x * 3 + 1] === DEF ? undefined : shownOf(drawn.words[x * 3 + 1])
    const bg = drawn.words[x * 3 + 2] === DEF ? DEF : shownOf(drawn.words[x * 3 + 2])
    const realFg = real.cells[i + 1]!, realBg = real.cells[i + 2]!
    const isLit = /[█▏▎▍▌▋▊▉]/.test(glyph)
    const fgOk = glyph === ' ' || fg === undefined || realFg === fg || (isLit && (BRIGHT[fg] === realFg || BRIGHT[realFg] === fg))
    const bgOk = bg === realBg
    cellsChecked++
    if (!fgOk || !bgOk) {
      off++
      if (process.env.SHOW) console.log(`  ${label} x${x} '${glyph}' page ${fg?.toString(16)}/${bg === DEF ? '-' : bg.toString(16)} real ${realFg.toString(16)}/${realBg === DEF ? '-' : realBg.toString(16)}`)
    }
  }
  const sameText = got === want
  const edge = real.text.trimEnd().length === width - 2
  if (!sameText || off > 0 || !edge) {
    problems++
    console.log(`${label}: ${sameText ? '' : 'DIFFERENT TEXT '}${off ? off + ' cells in other colours ' : ''}${edge ? '' : 'NOT AT THE EDGE'}\n  real: [${got}]\n  page: [${want}]  (${drawn.step})`)
  } else console.log(`${label.padEnd(8)} same  ${drawn.step.padEnd(22)} [${want}]`)
}
console.log(`\n${checked} captures compared, ${cellsChecked} cells; ${problems} different`)
process.exit(problems === 0 ? 0 : 1)
