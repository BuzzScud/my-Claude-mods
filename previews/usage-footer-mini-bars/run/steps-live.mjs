// A fresh Claude Code with no overrides: the live add-on as every window loads it.
import { execSync } from 'node:child_process'
const MARK = process.env.MARK
const resize = cols => ({ fn: async () => {
  const line = execSync('ps -axo tty,command').toString().split('\n').find(l => l.includes(MARK) && !l.includes('zsh') && !l.includes('script') && !l.includes('node '))
  const tty = line?.trim().split(/\s+/)[0]
  if (!tty || tty === '??') { console.log('no tty found'); return }
  execSync(`stty -f /dev/${tty} cols ${cols} rows 64`)
  await new Promise(r => setTimeout(r, 1800))
} })
const dialogs = { fn: async ({ text, write }) => {
  if (/external CLAUDE\.md|imports\?/.test(text)) { write('\r'); await new Promise(r => setTimeout(r, 1500)) }
  if (/trust this folder|trust the files|Do you trust/.test(text)) { write('\x1b[B'); await new Promise(r => setTimeout(r, 300)); write('\r'); await new Promise(r => setTimeout(r, 2000)) }
} }
export default [
  { sleep: 5000 }, dialogs, { sleep: 2500 }, dialogs,
  { wait: 'shift+tab', ms: 40000 }, { sleep: 3000 },
  { type: 'reply with the two words: all good' }, { sleep: 400 }, { type: '\r' },
  { sleep: 4000 }, { wait: 'good', ms: 90000 }, { sleep: 5000 },
  resize(177), { snapshot: 'live177' }, resize(149), { snapshot: 'live149' }, resize(120), { snapshot: 'live120' },
  { type: '/limits' }, { sleep: 300 }, { type: '\r' }, { sleep: 2500 }, { snapshot: 'limits' },
  { type: '/exit' }, { sleep: 500 }, { type: '\r' }, { sleep: 2000 },
]
