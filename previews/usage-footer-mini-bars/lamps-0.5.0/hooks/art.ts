// What the footer's picture is made of: a grid of terminal cells (a glyph, its colour, its
// background), and the moment it is drawn for. The row itself is in row.ts. (The older
// designs that lived beside it, Panel to the cache Fuse, were retired on 4 Oct 2026 for
// Lamps.)
import type { Gauge } from './limits'

export type Mood = 'idle' | 'working' | 'party' | 'alarm' | 'asleep'

export type Scene = {
  /** Each limit, with the value its meter shows now (it glides to the real one). */
  gauges: (Gauge & { shown: number })[]
  mood: Mood
  /** The frame number, eight to a second. */
  tick: number
}

export type Frame = { columns: number; rows: number; cells: string }

/** The terminal's own colour, for a cell that sets none. */
export const DEFAULT = 0x01000000

export type Grid = { columns: number; rows: number; words: Uint32Array }

export const grid = (columns: number, rows: number): Grid => {
  const words = new Uint32Array(columns * rows * 3)
  for (let i = 0; i < columns * rows; i++) {
    words[i * 3] = 0x20
    words[i * 3 + 1] = DEFAULT
    words[i * 3 + 2] = DEFAULT
  }

  return { columns, rows, words }
}

export const put = (g: Grid, x: number, y: number, glyph: string, color: number, back = DEFAULT) => {
  if (x < 0 || y < 0 || x >= g.columns || y >= g.rows) return
  const at = (y * g.columns + x) * 3
  g.words[at] = glyph.codePointAt(0) ?? 0x20
  g.words[at + 1] = color
  g.words[at + 2] = back
}

export const encode = (g: Grid): Frame => ({
  columns: g.columns,
  rows: g.rows,
  cells: (new Uint8Array(g.words.buffer) as unknown as { toBase64: () => string }).toBase64(),
})
