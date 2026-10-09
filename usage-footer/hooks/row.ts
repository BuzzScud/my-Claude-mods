// The footer's one row, Mini bars (picked 9 Oct 2026 after "make it more compact and smaller
// … to accommodate small terminals", the smallest being 120 columns; it replaced Lamps, picked
// 4 Oct): the context and the usage limits as one set of gauges, each its name, a short smooth
// bar, the percent and, when there is room, a time. Pure: a scene and the room go in, a frame
// comes out, with the place of every part so a check can hold them to one grid.
//
// The rules, at every width:
// - one row, never wider than the room the left of the footer leaves;
// - the gauges in one order (ctx, 5h, wk, a model's week), never moved;
// - every gauge drawn at the same step: when the room shrinks they all let go of the same
//   part at once (the bars shorten, then the times go, then the bars); names never change;
// - a narrower window never shows more than a wider one;
// - only past the last step does a gauge go, the calmest first, and "+n" says how many,
//   in the colour of the worst one hidden.
import { DEFAULT, encode, grid, put } from './art'
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
  kind: 'name' | 'meter' | 'percent' | 'fact' | 'more'
  /** Which gauge, from 0 in the row's order; "+n" has none. */
  item?: number
  x: number
  width: number
}

/** A frame, where each part sits, which step the room allowed, and how many gauges it shows. */
export type RowFrame = { columns: number; rows: number; cells: string; parts: RowPart[]; step: string; shown: number; of: number }

// Colours of the 256-colour palette. (Claude Code puts a few greys on screen a step off:
// 0x3a3a3a shows as 0x303030, 0x4e4e4e as 0x585858, 0x6c6c6c as 0x626262, 0x949494 as
// 0x9e9e9e. Measured 4 Oct; the design was judged on what shows.)
const WHITE = 0xeeeeee
const LABEL = 0xbcbcbc
const WORDS = 0x949494
const GREEN = 0x5fd75f
const GREEN_HI = 0x87ff87
const YELLOW = 0xffd75f
const YELLOW_HI = 0xffff87
const RED = 0xff5f5f
const RED_HI = 0xff8787
const BLUE = 0x5fafd7
const BLUE_HI = 0xafd7ff
const ORANGE = 0xffaf00
const ORANGE_HI = 0xffd787
const PURPLE = 0xaf87ff
const PURPLE_HI = 0xd7afff
// The bar's track: time gone that was not used, time still to come, and past the
// compaction point.
const SPARE = 0x6c6c6c
const AHEAD = 0x3a3a3a
const BUFFER = 0x5f0000

type Tone = 'calm' | 'fast' | 'out' | 'context' | 'near' | 'nearer' | 'compacted'

const COLOR: Record<Tone, readonly [base: number, high: number]> = {
  calm: [GREEN, GREEN_HI],
  fast: [YELLOW, YELLOW_HI],
  out: [RED, RED_HI],
  context: [BLUE, BLUE_HI],
  near: [YELLOW, YELLOW_HI],
  nearer: [ORANGE, ORANGE_HI],
  compacted: [PURPLE, PURPLE_HI],
}

/** One gauge as the row draws it, whichever it is. */
type Item = {
  /** Its name, the same at every width: ctx, 5h, wk, fable. */
  name: string
  /** The share shown, 0 to 1, on its way to the real one. */
  share: number
  percent: string
  /** The share of the window's time gone (limits); 0 for the context. */
  clock: number
  /** Where compaction starts, 0 to 1 (the context). */
  mark?: number
  /** The share the context stood at before the last reply grew it, and frames since. */
  grewFrom?: number
  since: number
  tone: Tone
  /** Blinks: used up or nearly, or about to compact. */
  isAlarm: boolean
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

const limitItems = (scene: Scene): Item[] =>
  scene.gauges.map(gauge => {
    const kind = gauge.pace?.kind
    const isOut = gauge.used >= 90 || kind === 'reached'
    const isFast = !isOut && kind === 'fast'
    const tone: Tone = isOut ? 'out' : isFast ? 'fast' : 'calm'
    const color = isOut ? RED : isFast ? YELLOW : WORDS
    // When it starts over (grey), or, when it runs out first, when it runs out (yellow).
    const ms = isFast && gauge.pace?.leftMs !== undefined ? gauge.pace.leftMs : gauge.resetsIn
    const fact = gauge.resets === 'new window' ? (['new', WORDS] as const) : ms === undefined ? undefined : ([clockText(ms), color] as const)

    return {
      name: gauge.name,
      share: Math.min(100, Math.max(0, gauge.shown)) / 100,
      percent: percent(gauge.shown),
      clock: gauge.time ?? 0,
      since: 1_000_000,
      tone,
      isAlarm: isOut,
      ...(fact === undefined ? {} : { fact }),
      urgency: kind === 'reached' ? 3000 : isOut ? 2000 + gauge.used : isFast ? 1000 + gauge.used : gauge.used,
    }
  })

// Before the first reply there is no figure yet: the gauge is there, empty, so the row has
// its four gauges from the start and nothing moves in when the figure comes.
const UNKNOWN: Item = { name: 'ctx', share: 0, percent: '--', clock: 0, since: 1_000_000, tone: 'context', isAlarm: false, urgency: -1 }

const contextItem = (scene: ContextScene): Item => {
  const { reading } = scene
  if (reading === undefined) return UNKNOWN
  const threshold = reading.threshold ?? reading.window
  const near = scene.shown / threshold
  const isShrunk = scene.since < FLASH * 3 && scene.shown < scene.before * 0.6
  const tone: Tone = isShrunk ? 'compacted' : near >= 0.95 ? 'out' : near >= 0.85 ? 'nearer' : near >= 0.7 ? 'near' : 'context'
  const share = Math.min(1, scene.shown / reading.window)
  const factColor = tone === 'context' ? WORDS : tone === 'compacted' ? PURPLE : COLOR[tone][0]

  return {
    name: 'ctx',
    share,
    percent: `${Math.min(100, Math.floor(share * 100))}%`,
    clock: 0,
    ...(reading.threshold === undefined ? {} : { mark: reading.threshold / reading.window }),
    ...(scene.before < scene.shown ? { grewFrom: scene.before / reading.window } : {}),
    since: scene.since,
    tone,
    isAlarm: near >= 0.95,
    fact: [isShrunk ? 'new' : tokens(scene.shown), factColor],
    urgency: near >= 0.95 ? 2500 : near >= 0.85 ? 1500 + near * 100 : near >= 0.7 ? 1000 + near * 100 : near * 100,
  }
}

/** Every gauge in the row's order: the context first, then the limits as Claude Code lists them. */
export const itemsOf = (scene: RowScene): Item[] => [contextItem(scene.context), ...limitItems(scene.limits)]

// Motion.
const isBusy = (mood: Mood) => mood === 'working' || mood === 'party'
// A light runs along the lit part while Claude works; every gauge's at the same place.
const sweepOf = (mood: Mood, tick: number, length: number) => (isBusy(mood) && length > 0 ? (tick % (length + 6)) - 1 : -9)
// Used up, or about to compact: brighter every other quarter second.
const isBlink = (item: Item, tick: number) => item.isAlarm && (tick & 2) === 0

type Ctx = { mood: Mood; tick: number }

// A grid that also records each part's place.
type RowGrid = Grid & { parts: RowPart[] }

const rowGrid = (columns: number): RowGrid => Object.assign(grid(columns, 1), { parts: [] as RowPart[] })

const text = (g: RowGrid, part: Omit<RowPart, 'width'>, words: string, color: number) => {
  const glyphs = [...words]
  glyphs.forEach((glyph, i) => put(g, part.x + i, 0, glyph, color))
  g.parts.push({ ...part, width: glyphs.length })
}

const done = (g: RowGrid, step: string, shown: number, of: number): RowFrame => ({ ...encode(g), parts: g.parts, step, shown, of })

// The left part of a cell, in eighths: a bar ends inside a cell as finely as the font allows.
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const

/** A bar of `cells`: how many eighths are lit, where the clock has got to, where compaction starts. */
const barOf = (item: Item, cells: number) => {
  const eighths = item.share > 0.005 ? Math.min(cells * 8, Math.max(1, Math.round(item.share * cells * 8))) : 0

  return {
    full: Math.floor(eighths / 8),
    part: eighths % 8,
    lit: Math.ceil(eighths / 8),
    clock: Math.round(item.clock * cells),
    // A cell is past the compaction point when most of it is (its middle is past it).
    mark: item.mark === undefined ? cells : Math.min(cells, Math.ceil(item.mark * cells - 0.5)),
    grewFrom: item.grewFrom === undefined ? cells : Math.floor(item.grewFrom * cells),
  }
}

// A lit cell's colour. A reply's new part flashes in (white, then bright); the sweep, the
// party sparkle and the alarm blink brighten it; the last lit cell breathes.
const litColor = (item: Item, i: number, lit: number, grewFrom: number, ctx: Ctx, sweep: number) => {
  const [base, high] = COLOR[item.tone]
  if (item.since < FLASH && i >= grewFrom) return item.since < FLASH / 2 ? WHITE : high
  if (i === sweep || i === sweep - 1) return high
  if (ctx.mood === 'party' && (i + ctx.tick) % 4 < 2) return high
  if (isBlink(item, ctx.tick)) return high
  // Slowly at rest, a little faster while Claude works, not at all asleep.
  if (i === lit - 1 && ctx.mood !== 'asleep' && ((ctx.tick >> (isBusy(ctx.mood) ? 1 : 3)) & 1) === 1) return high

  return base
}

// ─── The steps ────────────────────────────────────────────────────────────────────────
// Richest first. The row takes the first step at which every gauge fits; past the last,
// it shows fewer gauges at the last step.

/** The longest name drawn; a longer model name is cut. */
const NAME = 5
const PERCENT = 3
const TIME = 6
const GAP = 2

type Step = { id: string; cells: number; hasTime: boolean }

// 98, 82, 74, 46, 34 columns for ctx, 5h, wk and fable: the bars shorten first, then the
// times go, then the bars. 46 fits a 120-column window in bypass mode with the widest left
// text Claude Code draws (a background shell while it works).
export const STEPS: readonly Step[] = [
  { id: 'long bars and times', cells: 8, hasTime: true },
  { id: 'bars and times', cells: 4, hasTime: true },
  { id: 'short bars and times', cells: 2, hasTime: true },
  { id: 'short bars', cells: 2, hasTime: false },
  { id: 'numbers', cells: 0, hasTime: false },
]

const nameOf = (item: Item) => [...item.name].slice(0, NAME).join('')

/** One gauge's width at a step: its name, the bar, the percent, the time. */
export const tileOf = (step: Step, name: string) =>
  [...name].slice(0, NAME).length + 1 + (step.cells > 0 ? step.cells + 1 : 0) + PERCENT + (step.hasTime ? 1 + TIME : 0)

const widthOf = (step: Step, items: readonly Item[], hidden: number) =>
  items.reduce((sum, item) => sum + tileOf(step, item.name), 0) + Math.max(0, items.length - 1) * GAP + (hidden > 0 ? 1 + `+${hidden}`.length : 0)

const percentColor = (item: Item) => (item.tone === 'calm' || item.tone === 'context' ? WHITE : COLOR[item.tone][0])

// The percent in its three columns: "100%" and over is "max".
const percentText = (item: Item) => (item.percent.length > PERCENT ? 'max' : item.percent.padStart(PERCENT))

// The bar: lit cells in the gauge's colour, the last one cut to the eighth, on a track that
// is grey for time gone unused, dark for time to come, dark red past the compaction point.
const bar = (g: RowGrid, x: number, cells: number, item: Item, index: number, ctx: Ctx) => {
  const b = barOf(item, cells)
  const sweep = sweepOf(ctx.mood, ctx.tick, b.lit)
  for (let i = 0; i < cells; i++) {
    const track = i >= b.mark ? BUFFER : i < b.clock ? SPARE : AHEAD
    if (i < b.full) put(g, x + i, 0, '█', litColor(item, i, b.lit, b.grewFrom, ctx, sweep), track)
    else if (i === b.full && b.part > 0) put(g, x + i, 0, EIGHTHS[b.part] as string, litColor(item, i, b.lit, b.grewFrom, ctx, sweep), track)
    else put(g, x + i, 0, ' ', DEFAULT, track)
  }
  g.parts.push({ kind: 'meter', item: index, x, width: cells })
}

// Every gauge: its name, its bar, the percent, the time.
const tile = (g: RowGrid, x: number, step: Step, item: Item, index: number, ctx: Ctx) => {
  const name = nameOf(item)
  text(g, { kind: 'name', item: index, x }, name, LABEL)
  let at = x + [...name].length + 1
  if (step.cells > 0) {
    bar(g, at, step.cells, item, index, ctx)
    at += step.cells + 1
  }
  text(g, { kind: 'percent', item: index, x: at }, percentText(item), percentColor(item))
  // The time ends where the gauge ends, so it takes the same room whatever it says.
  if (step.hasTime && item.fact) {
    const words = item.fact[0].slice(0, TIME)
    text(g, { kind: 'fact', item: index, x: at + PERCENT + 1 + TIME - words.length }, words, item.fact[1])
  }
}

const moreColor = (hidden: readonly Item[]) =>
  hidden.some(item => item.tone === 'out') ? RED : hidden.some(item => item.tone !== 'calm' && item.tone !== 'context') ? YELLOW : WORDS

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
    tile(g, x, at, item, slot, ctx)
    x += tileOf(at, item.name) + GAP
  })
  if (hasMore) text(g, { kind: 'more', x: g.columns - `+${hidden.length}`.length }, `+${hidden.length}`, moreColor(hidden))
  // Not even one gauge fits: nothing, rather than a row the engine would move under the left.
  if (g.columns > room) return done(rowGrid(0), 'none', 0, items.length)

  return done(g, step === undefined ? `${at.id}, ${shown.length} of ${items.length}` : at.id, shown.length, items.length)
}

// ─── The room ─────────────────────────────────────────────────────────────────────────
// Measured in a real Claude Code (4 Oct): the right of the footer stays on the row while it
// is at most columns − 3 − the left text's width; one column more and the engine moves it
// under the left. The left is "  " + the mode's label + the hint, joined by a space when
// the hint is "(shift+tab to cycle)…" and by " · " otherwise. The hint hook is handed the
// hint alone, never the label ("⏵⏵ bypass permissions on", the widest, is 24), so room is
// kept for the widest label; and for the hint while Claude works ("(shift+tab to cycle) ·
// esc to interrupt"), so the row keeps one size whether Claude works or not.

export const MODE_LABEL = 24
export const WORKING_HINT = '(shift+tab to cycle) · esc to interrupt'

/** The left text's width for a hint: the indent, the widest label, the joiner, the hint. */
export const leftOf = (hint: string) => {
  const widthOf = (one: string) => 2 + MODE_LABEL + (one.startsWith('(') ? 1 : 3) + [...one].length

  return Math.max(widthOf(hint), widthOf(WORKING_HINT))
}

/** The room for the row: the width, less the left (for the widest hint seen) and any modes after the row. */
export const roomOf = (columns: number, hint: string, modes = '') =>
  Math.max(1, columns - 3 - leftOf(hint) - (modes === '' ? 0 : modes.length + 3))
