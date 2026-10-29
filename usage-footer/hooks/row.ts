// The footer's one row, Bar tiles (picked 29 Oct 2026 over Long bars, after "redesign the bottom
// usage area": the bars were too small to read, the reset times went first, and a bar's colour
// said pace, so 79% of the 5 hours showed green; it replaced Mini bars, picked 9 Oct). Each gauge
// is a tile whose background fills like a bar, its name, percent and reset time printed on it,
// so the bar is as wide as the tile. Pure: a scene and the room go in, a frame comes out, with
// the place of every part so a check can hold them to one grid.
//
// The rules, at every width:
// - one row, never wider than the room the left of the footer leaves;
// - the gauges in one order (ctx, 5h, wk, a model's week), never moved;
// - the colour says how full: past half yellow, past three quarters orange, from 90 red; the
//   context blue until it nears the point where it compacts;
// - the tiles shrink together (24, 20, 16 cells, then each as wide as its words), then the times
//   go; only past that does a gauge go, the calmest first, and "+n" says how many, in the colour
//   of the worst one hidden.
import { encode, grid, put } from './art'
import type { Grid, Mood, Scene } from './art'
import { clockText, percent } from './limits'

/** What Claude Code reports about the live window: its figures and /context's threshold. */
export type ContextReading = {
  /** Tokens the last request was answered over. */
  tokens: number
  /** The model's window. */
  window: number
  /** Where auto-compact runs; absent when it is off. */
  threshold?: number
}

export type ContextScene = {
  reading: ContextReading | undefined
  /** The tokens the gauge shows on its way to the real figure. */
  shown: number
  /** What the chat took up before the last reply grew it (or before a compaction shrank it). */
  before: number
  /** Frames since the figure last changed; large when it has not. */
  since: number
}

export type RowScene = { limits: Scene; context: ContextScene }

export type RowPart = {
  kind: 'tile' | 'name' | 'percent' | 'fact' | 'more'
  /** Which gauge, from 0 in the row's order; "+n" has none. */
  item?: number
  x: number
  width: number
}

/** A frame, where each part sits, which step the room allowed, and how many gauges it shows. */
export type RowFrame = { columns: number; rows: number; cells: string; parts: RowPart[]; step: string; shown: number; of: number }

// Colours of the 256-colour palette. (Claude Code puts a few greys on screen a step off:
// 0x3a3a3a shows as 0x303030, 0x949494 as 0x9e9e9e. Measured 4 Oct; the design was judged on
// what shows.)
const WHITE = 0xeeeeee
const LABEL = 0xbcbcbc
const WORDS = 0x949494
// The words on a tile's fill.
const INK = 0x1c1c1c
// A tile's track, and past the point where the context compacts.
const TRACK = 0x3a3a3a
const BUFFER = 0x5f0000

type Level = 'green' | 'yellow' | 'orange' | 'red' | 'blue' | 'purple'

// [base, high] of a tile's fill: a step darker than the words' colours, so the dark words on it
// stay readable.
const FILL: Record<Level, readonly [base: number, high: number]> = {
  green: [0x5faf5f, 0x87d787],
  yellow: [0xd7af5f, 0xffd787],
  orange: [0xd7875f, 0xffaf87],
  red: [0xd75f5f, 0xff8787],
  blue: [0x5f87af, 0x87afd7],
  purple: [0x8787d7, 0xafafff],
}
// A percent off the fill, when it is not calm; "+n" in the worst hidden one's.
const WORD: Record<Level, number> = {
  green: WHITE,
  yellow: 0xffd75f,
  orange: 0xffaf00,
  red: 0xff5f5f,
  blue: WHITE,
  purple: 0xaf87ff,
}

/** One gauge as the row draws it, whichever it is. */
type Item = {
  /** Its name, the same at every width: ctx, 5h, wk, fable. */
  name: string
  /** The share shown, 0 to 1, on its way to the real one. */
  share: number
  percent: string
  /** Where compaction starts, 0 to 1 (the context). */
  mark?: number
  /** The share the context stood at before the last reply grew it, and frames since. */
  grewFrom?: number
  since: number
  level: Level
  /** Blinks: used up or nearly, or about to compact. */
  isAlarm: boolean
  /** The time until it starts over, or the context's tokens. */
  fact?: readonly [text: string, color: number]
  /** Higher stays longer when gauges have to go. */
  urgency: number
}

const FLASH = 10

/** "84k", "33.8k", "1.2M": a count of tokens in a few columns. */
export const tokens = (n: number) => {
  if (n < 1000) return String(Math.round(n))
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`

  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

// A limit by how full it really is (not the figure on its way there, so it does not flicker).
const limitItems = (scene: Scene): Item[] =>
  scene.gauges.map(gauge => {
    const isReached = gauge.pace?.kind === 'reached'
    const level: Level = gauge.used >= 90 || isReached ? 'red' : gauge.used >= 75 ? 'orange' : gauge.used >= 50 ? 'yellow' : 'green'
    const fact = gauge.resets === 'new window' ? (['new', WORDS] as const) : gauge.resetsIn === undefined ? undefined : ([clockText(gauge.resetsIn), WORDS] as const)

    return {
      name: gauge.name,
      share: Math.min(100, Math.max(0, gauge.shown)) / 100,
      percent: percent(gauge.shown),
      since: 1_000_000,
      level,
      isAlarm: level === 'red',
      ...(fact === undefined ? {} : { fact }),
      urgency: isReached ? 3000 : level === 'red' ? 2000 + gauge.used : level === 'orange' ? 1500 + gauge.used : level === 'yellow' ? 1000 + gauge.used : gauge.used,
    }
  })

// Before the first reply there is no figure yet: the gauge is there, empty, so the row has
// its four gauges from the start and nothing moves in when the figure comes.
const UNKNOWN: Item = { name: 'ctx', share: 0, percent: '--', since: 1_000_000, level: 'blue', isAlarm: false, urgency: -1 }

const contextItem = (scene: ContextScene): Item => {
  const { reading } = scene
  if (reading === undefined) return UNKNOWN
  const threshold = reading.threshold ?? reading.window
  const near = scene.shown / threshold
  const isShrunk = scene.since < FLASH * 3 && scene.shown < scene.before * 0.6
  const level: Level = isShrunk ? 'purple' : near >= 0.95 ? 'red' : near >= 0.85 ? 'orange' : near >= 0.7 ? 'yellow' : 'blue'
  const share = Math.min(1, scene.shown / reading.window)

  return {
    name: 'ctx',
    share,
    percent: `${Math.min(100, Math.floor(share * 100))}%`,
    ...(reading.threshold === undefined ? {} : { mark: reading.threshold / reading.window }),
    ...(scene.before < scene.shown ? { grewFrom: scene.before / reading.window } : {}),
    since: scene.since,
    level,
    isAlarm: near >= 0.95,
    fact: [isShrunk ? 'new' : tokens(scene.shown), isShrunk ? WORD.purple : WORDS],
    urgency: near >= 0.95 ? 2500 : near >= 0.85 ? 1500 + near * 100 : near >= 0.7 ? 1000 + near * 100 : near * 100,
  }
}

/** Every gauge in the row's order: the context first, then the limits as Claude Code lists them. */
export const itemsOf = (scene: RowScene): Item[] => [contextItem(scene.context), ...limitItems(scene.limits)]

// Motion.
const isBusy = (mood: Mood) => mood === 'working' || mood === 'party'
// A light runs along the lit part while Claude works; every tile's at the same place.
const sweepOf = (mood: Mood, tick: number, length: number) => (isBusy(mood) && length > 0 ? (tick % (length + 6)) - 1 : -9)

type Ctx = { mood: Mood; tick: number }

// A lit cell's fill. A reply's new part flashes in (white, then bright); the sweep, the party
// sparkle and the alarm blink brighten it; the last lit cell breathes.
const fillOf = (item: Item, i: number, lit: number, grewFrom: number, ctx: Ctx, sweep: number) => {
  const [base, high] = FILL[item.level]
  if (item.since < FLASH && i >= grewFrom) return item.since < FLASH / 2 ? WHITE : high
  if (i === sweep || i === sweep - 1) return high
  if (ctx.mood === 'party' && (i + ctx.tick) % 4 < 2) return high
  // Used up, or about to compact: brighter every other quarter second.
  if (item.isAlarm && (ctx.tick & 2) === 0) return high
  // Slowly at rest, a little faster while Claude works, not at all asleep.
  if (i === lit - 1 && ctx.mood !== 'asleep' && ((ctx.tick >> (isBusy(ctx.mood) ? 1 : 3)) & 1) === 1) return high

  return base
}

// A grid that also records each part's place.
type RowGrid = Grid & { parts: RowPart[] }

const rowGrid = (columns: number): RowGrid => Object.assign(grid(columns, 1), { parts: [] as RowPart[] })

const text = (g: RowGrid, part: Omit<RowPart, 'width'>, words: string, color: number) => {
  const glyphs = [...words]
  glyphs.forEach((glyph, i) => put(g, part.x + i, 0, glyph, color))
  g.parts.push({ ...part, width: glyphs.length })
}

const done = (g: RowGrid, step: string, shown: number, of: number): RowFrame => ({ ...encode(g), parts: g.parts, step, shown, of })

// ─── The steps ────────────────────────────────────────────────────────────────────────
// Richest first. The row takes the first step at which every gauge fits; past the last,
// it shows fewer gauges at the last step.

/** The longest time drawn: "6d14h". */
const TIME = 5
const GAP = 1

type Step = { id: string; width: number; hasTime: boolean }

// Every tile the same width while there is room (the bar 24, 20 or 16 cells long), then each as
// wide as its words; then the times go. With the hint shortened, 120 columns in bypass mode
// leaves 72: the 17-cell tiles with every time.
export const STEPS: readonly Step[] = [
  { id: '24-cell tiles', width: 24, hasTime: true },
  { id: '20-cell tiles', width: 20, hasTime: true },
  { id: '16-cell tiles', width: 16, hasTime: true },
  { id: 'snug tiles', width: 0, hasTime: true },
  { id: 'snug tiles without times', width: 0, hasTime: false },
]

// The percent in its three columns: "100%" and over is "max".
const percentText = (item: Item) => (item.percent.length > 3 ? 'max' : item.percent)

const headOf = (item: Item) => `${item.name} ${percentText(item)}`

// The words and a space each side; a tile with a time keeps room for the longest one.
const snugOf = (item: Item, hasTime: boolean) => [...headOf(item)].length + (hasTime ? 1 + TIME : 0) + 2

/** One tile's width at a step: the step's, unless a gauge's words need more. */
export const tileOf = (step: Step, item: Item, all: readonly Item[]) =>
  step.width === 0 ? snugOf(item, step.hasTime) : Math.max(step.width, ...all.map(one => snugOf(one, step.hasTime)))

const widthOf = (step: Step, items: readonly Item[], hidden: number) =>
  items.reduce((sum, item) => sum + tileOf(step, item, items), 0) + Math.max(0, items.length - 1) * GAP + (hidden > 0 ? 1 + `+${hidden}`.length : 0)

// A tile: lit cells on the gauge's fill with dark words, the rest on the track. Whole cells:
// a cell holds a letter or the space between two words, so it cannot be cut.
const tile = (g: RowGrid, x: number, width: number, step: Step, item: Item, index: number, ctx: Ctx) => {
  const head = headOf(item)
  const tail = step.hasTime && item.fact ? item.fact[0].slice(0, TIME) : ''
  const cells = [...` ${head}`.padEnd(width - 1 - tail.length) + tail + ' ']
  const nameEnd = 1 + [...item.name].length
  const percentEnd = 1 + [...head].length
  const tailStart = width - 1 - [...tail].length
  const lit = item.share > 0.005 ? Math.min(width, Math.max(1, Math.round(item.share * width))) : 0
  const mark = item.mark === undefined ? width : Math.min(width, Math.ceil(item.mark * width - 0.5))
  const grewFrom = item.grewFrom === undefined ? width : Math.floor(item.grewFrom * width)
  const sweep = sweepOf(ctx.mood, ctx.tick, lit)
  cells.forEach((glyph, i) => {
    if (i < lit) {
      put(g, x + i, 0, glyph, INK, fillOf(item, i, lit, grewFrom, ctx, sweep))
      return
    }
    const color = i < nameEnd ? LABEL : i >= tailStart ? (item.fact?.[1] ?? WORDS) : WORD[item.level]
    put(g, x + i, 0, glyph, color, i >= mark ? BUFFER : TRACK)
  })
  g.parts.push({ kind: 'tile', item: index, x, width })
  g.parts.push({ kind: 'name', item: index, x: x + 1, width: nameEnd - 1 })
  g.parts.push({ kind: 'percent', item: index, x: x + nameEnd + 1, width: percentEnd - nameEnd - 1 })
  if (tail !== '') g.parts.push({ kind: 'fact', item: index, x: x + tailStart, width: [...tail].length })
}

const moreColor = (hidden: readonly Item[]) =>
  hidden.some(item => item.level === 'red') ? WORD.red : hidden.some(item => item.level === 'orange' || item.level === 'yellow') ? WORD.yellow : WORDS

export const drawRow = (scene: RowScene, room: number): RowFrame => {
  const items = itemsOf(scene)
  const ctx: Ctx = { mood: scene.limits.mood, tick: scene.limits.tick }
  const last = STEPS[STEPS.length - 1] as Step
  const step = STEPS.find(one => widthOf(one, items, 0) <= room)
  const all = items.map((item, index) => ({ item, index }))
  let shown = all
  if (step === undefined) {
    // Past the last step: the calmest go first; the rest keep their order.
    const keep = [...all].sort((a, b) => b.item.urgency - a.item.urgency)
    const keptOf = (count: number) => {
      const kept = new Set(keep.slice(0, Math.max(1, count)).map(one => one.index))

      return all.filter(one => kept.has(one.index))
    }
    let count = items.length - 1
    while (count > 1 && widthOf(last, keptOf(count).map(one => one.item), items.length - count) > room) count--
    shown = keptOf(count)
  }
  const at = step ?? last
  const shownItems = shown.map(one => one.item)
  const hidden = items.filter((_, index) => !shown.some(one => one.index === index))
  const hasMore = hidden.length > 0 && widthOf(at, shownItems, hidden.length) <= room
  const g = rowGrid(widthOf(at, shownItems, hasMore ? hidden.length : 0))
  let x = 0
  shown.forEach(({ item }, slot) => {
    const width = tileOf(at, item, shownItems)
    tile(g, x, width, at, item, slot, ctx)
    x += width + GAP
  })
  if (hasMore) text(g, { kind: 'more', x: g.columns - `+${hidden.length}`.length }, `+${hidden.length}`, moreColor(hidden))
  // Not even one gauge fits: nothing, rather than a row the engine would move under the left.
  if (g.columns > room) return done(rowGrid(0), 'none', 0, items.length)

  return done(g, step === undefined ? `${at.id}, ${shown.length} of ${items.length}` : at.id, shown.length, items.length)
}

// ─── The room ─────────────────────────────────────────────────────────────────────────
// Measured in a real Claude Code (4 Oct): the right of the footer stays on the row while it
// is at most columns − 3 − the left text's width; one column more and the engine moves it
// under the left. The left is "  " + the mode's label + the hint. The hint hook is handed the
// hint alone, never the label ("⏵⏵ bypass permissions on", the widest, is 24, and no mod can
// change it), so room is kept for the widest label.
//
// The add-on shortens the plain hints: "(shift+tab to cycle)" took 20 columns the gauges want.
// A hint with pills in it (a background shell) is left as the engine draws it, so its pills
// stay live. The engine joins its own hint to the label by a space when it starts "(", and by
// " · " otherwise; a rewritten one always by " · " (measured 29 Oct, Claude Code 2.1.312).

export const MODE_LABEL = 24
export const SHORT_HINTS: Readonly<Record<string, string>> = {
  '(shift+tab to cycle)': '⇧tab to cycle',
  '(shift+tab to cycle) · esc to interrupt': 'esc to interrupt',
}
const WORKING_HINT = 'esc to interrupt'

/** The left text's width for the hint drawn: the indent, the widest label, the joiner, the hint. */
export const leftOf = (hint: string, isRewritten: boolean) =>
  2 + MODE_LABEL + (!isRewritten && hint.startsWith('(') ? 1 : 3) + [...hint].length

/**
 * The room for the row: the width, less the left text shown now (kept wide enough for the hint
 * shown while Claude works, so the row keeps its size through a turn) and any modes after the row.
 */
export const roomOf = (columns: number, left: number, modes = '') =>
  Math.max(1, columns - 3 - Math.max(left, leftOf(WORKING_HINT, true)) - (modes === '' ? 0 : modes.length + 3))
