// A real Claude Code in a pty, driven by a steps file. The pty harness comes from the Agentic Coder repo
// (PTY_HARNESS, by default ~/Desktop/agentic-coder/terminal/test/pty.mjs).
import { homedir } from 'node:os';
import { join } from 'node:path';
const { runInPty } = await import(process.env.PTY_HARNESS ?? join(homedir(), 'Desktop/agentic-coder/terminal/test/pty.mjs'));
const S = process.env.S;
const cols = Number(process.env.COLS ?? 180), rows = Number(process.env.ROWS ?? 45);
const steps = (process.env.STEPS ? JSON.parse(process.env.STEPS) : (await import(process.env.STEPS_FILE)).default).map((s) => s.click ? { fn: async ({ screen, write }) => {
  // A real mouse click (SGR report) on the first cell of the text.
  const term = await screen(); const b = term.buffer.active;
  for (let y = b.baseY; y < b.baseY + rows; y++) { const t = b.getLine(y)?.translateToString(true) ?? ''; const x = t.indexOf(s.click); if (x >= 0) { const col = x + 2, row = y - b.baseY + 1; write(`\x1b[<0;${col};${row}M`); await new Promise((r) => setTimeout(r, 60)); write(`\x1b[<0;${col};${row}m`); console.log(`clicked "${s.click}" at col ${col} row ${row}`); return; } }
  console.log(`click target "${s.click}" not on screen`);
} } : s);
const r = await runInPty({ bin: process.env.CLAUDE_BIN ?? join(homedir(), '.local/bin/claude'), args: process.env.ARGS ? JSON.parse(process.env.ARGS) : ['--plugin-dir', process.env.MODDIR, '--model', 'haiku'], cwd: process.env.RUNDIR, cols, rows, steps, timeoutMs: Number(process.env.T ?? 120000) }).catch((e) => ({ error: String(e) }));
if (r.error) { console.log('ERROR', r.error); process.exit(1); }
// One line with its colours: [fg] before each run of cells that share one.
const colored = (term, y) => {
  const line = term.buffer.active.getLine(y); if (!line) return '';
  let out = '', last = null;
  for (let x = 0; x < cols; x++) {
    const c = line.getCell(x); if (!c) break;
    const ch = c.getChars() || ' ';
    const tag = (c.isFgDefault() ? 'def' : c.isFgPalette() ? `p${c.getFgColor()}` : `#${c.getFgColor().toString(16).padStart(6, '0')}`) + (c.isDim() ? ',dim' : '') + (c.isBold() ? ',bold' : '') + (c.isInverse() ? ',inv' : '');
    if (ch.trim() && tag !== last) { out += `[${tag}]`; last = tag; }
    out += ch;
  }
  return out.trimEnd();
};
for (const [name, text] of Object.entries(r.snapshots)) {
  const lines = text.split('\n').map((l) => l.trimEnd());
  while (lines.length && !lines.at(-1)) lines.pop();
  console.log(`\n===== ${name} =====`);
  console.log(lines.slice(-Number(process.env.TAIL ?? 22)).join('\n'));
  if (process.env.COLOR) {
    const term = r.terms[name]; const b = term.buffer.active;
    const want = (process.env.COLOR_HAS ?? '5h').split('|');
    for (let y = b.baseY; y < b.baseY + rows; y++) { const t = b.getLine(y)?.translateToString(true) ?? ''; if (want.some((w) => t.includes(w))) console.log('  colours> ' + colored(term, y)); }
  }
}
if (process.env.DUMP) {
  // The visible window of each snapshot as cells, for the picture maker.
  const BASE = [0x000000, 0x990000, 0x00a600, 0x999900, 0x0000b2, 0xb200b2, 0x00a6b2, 0xbfbfbf, 0x666666, 0xe50000, 0x00d900, 0xe5e500, 0x0000ff, 0xe500e5, 0x00e5e5, 0xe5e5e5];
  const PAL = BASE.slice(); const lv = [0, 95, 135, 175, 215, 255];
  for (let a = 0; a < 6; a++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) PAL.push((lv[a] << 16) | (lv[g] << 8) | lv[b]);
  for (let i = 0; i < 24; i++) { const v = 8 + i * 10; PAL.push((v << 16) | (v << 8) | v); }
  const DEF = 0x01000000;
  const mix = (c) => { const k = 0.55, bg = 0x1c; return ((Math.round(((c >> 16) & 255) * k + bg * (1 - k)) << 16) | (Math.round(((c >> 8) & 255) * k + bg * (1 - k)) << 8) | Math.round((c & 255) * k + bg * (1 - k))); };
  const frames = [];
  const { writeFileSync } = await import('node:fs');
  for (const [name, term] of Object.entries(r.terms)) {
    const b = term.buffer.active; const words = []; const top = Number(process.env.TOP ?? 0);
    let first = b.baseY + top, last = b.baseY + rows - 1;
    while (last > first && !(b.getLine(last)?.translateToString(true).trim())) last--;
    const keep = Number(process.env.KEEP ?? 26); first = Math.max(first, last - keep + 1);
    for (let y = first; y <= last; y++) { const line = b.getLine(y); for (let x = 0; x < cols; x++) { const c = line.getCell(x); const ch = c.getChars() || ' ';
      let fg = c.isFgDefault() ? 0xcfcfcf : c.isFgPalette() ? PAL[c.getFgColor()] : c.getFgColor(); let bg = c.isBgDefault() ? DEF : c.isBgPalette() ? PAL[c.getBgColor()] : c.getBgColor();
      if (c.isInverse()) { const t = fg; fg = bg === DEF ? 0x1c1c1c : bg; bg = t; }
      if (c.isDim()) fg = mix(fg);
      words.push(ch.codePointAt(0), fg, bg); } }
    frames.push({ label: name, columns: cols, rows: last - first + 1, words });
  }
  writeFileSync(process.env.DUMP, JSON.stringify(frames));
}
console.log('exit code', r.code);
