// A real Claude Code with the renamed copy (usage-footer-next): the footer at each width at
// rest, mid-reply, and with a background shell running. Run by probe.mjs.
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
  if (/Bypass Permissions mode/i.test(text) && /Yes, I accept/.test(text)) { write('\x1b[B'); await new Promise(r => setTimeout(r, 300)); write('\r'); await new Promise(r => setTimeout(r, 2000)) }
  if (/trust this folder|trust the files|Do you trust/.test(text)) { write('\x1b[B'); await new Promise(r => setTimeout(r, 300)); write('\r'); await new Promise(r => setTimeout(r, 2000)) }
} }
const widths = [200, 177, 167, 151, 149, 143, 142, 130, 120, 110, 100]
export default [
  { sleep: 5000 }, dialogs, { sleep: 2500 }, dialogs, { sleep: 2500 }, dialogs,
  { wait: 'shift+tab', ms: 40000 }, { sleep: 2500 },
  resize(120), { snapshot: 'fresh120' },
  { type: 'reply with the two words: all good' }, { sleep: 400 }, { type: '\r' },
  { sleep: 3000 }, { wait: 'good', ms: 90000 }, { sleep: 5000 },
  ...widths.flatMap(w => [resize(w), { snapshot: `w${w}` }]),
  // Mid-reply: the left gains "· esc to interrupt"; the row must keep its size.
  resize(149),
  { type: 'write the numbers 1 to 300 separated by spaces, nothing else' }, { sleep: 300 }, { type: '\r' },
  { sleep: 2500 }, { snapshot: 'work149' }, resize(120), { snapshot: 'work120' },
  { wait: '300', ms: 90000 }, { sleep: 3000 },
  // A background shell: the widest left text Claude Code draws.
  resize(177),
  { type: 'use the Bash tool with run_in_background true to run: sleep 60 . then reply with one word: started' }, { sleep: 400 }, { type: '\r' },
  { sleep: 3000 }, { wait: 'started', ms: 90000 }, { sleep: 4000 },
  ...[177, 149, 130, 120].flatMap(w => [resize(w), { snapshot: `bg${w}` }]),
  resize(177),
  { type: '/limits' }, { sleep: 300 }, { type: '\r' }, { sleep: 2500 }, { snapshot: 'limits177' },
  { type: '/exit' }, { sleep: 500 }, { type: '\r' }, { sleep: 2000 },
]
