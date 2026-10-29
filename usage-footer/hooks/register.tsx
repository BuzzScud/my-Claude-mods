import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Limit } from '../types'
import type { Frame, Mood, Scene } from './art'
import { gaugeOf } from './limits'
import type { Gauge } from './limits'
import { drawRow, leftOf, roomOf, SHORT_HINTS } from './row'
import type { ContextReading, ContextScene } from './row'

const reading = atom({ plugin: 'usage-footer', key: 'reading' } as const, {
  limits: [],
})
const design = atom({ plugin: 'usage-footer', key: 'design' } as const, 'tiles')
const clock = atom({ plugin: 'usage-footer', key: 'now' } as const, 0)
const scoped = atom({ plugin: 'usage-footer', key: 'scoped' } as const, [])
const designRef = { plugin: 'usage-footer', key: 'design' } as const

// The footer shows the row (Bar tiles since 29 Oct), or nothing.
type Choice = 'tiles' | 'off'

// 4 Oct: they picked Lamps (the context and the limits as one row of equal tiles) over
// Pills, and the older designs (Panel, Strip, Ledger, the cache designs, the context bar)
// were retired. 9 Oct: the row became Mini bars, to keep every gauge down to a 120-column
// window. 29 Oct: Bar tiles (row.ts), picked over Long bars from a page showing both.
// The add-on switches to a new row once; /limits off still hides it.
const BUILT = 'tiles-row'
// A model's own weekly limit (Fable) is read by a second, silent Claude Code. Every window
// of the account shares one reading through the store: a reading this young is used as it
// is, and only one window asks at a time. The store is one file for every account on this
// Mac (~/.claude-2/plugins is ~/.claude/plugins), so a reading is filed under its account,
// told apart by the minute its weekly limit starts over.
const SHARED_MS = 3 * 60_000
const ASKING_MS = 30_000
const SCOPED_QUIET_MS = 30 * 60_000
const MEASURE_MS = 30_000
// Eight frames a second while something moves; two while only the last lit cells breathe.
const FRAME_MS = 125
const REST_MS = 500
const PARTY = 48
const ASLEEP_AFTER = 2400

// A saved choice: an older design's name (lamps, panel, led…) reads as the row.
const choiceOf = (value: unknown): Choice => (value === 'off' ? 'off' : 'tiles')

type Mounted = {
  requestId: string
  key: string
  /** The room the frame was drawn for, and the size it came out at. */
  room: number
  columns: number
  rows: number
  cells: string
}

// What moves: the frame number, the value each meter shows on its way to the real
// one, and what the session is doing. A reload starts these over.
const motion = {
  tick: 0,
  gauges: [] as Gauge[],
  isWorking: false,
  partyLeft: 0,
  idleTicks: 0,
}
const shown = new Map<string, number>()
const sites = new Map<string, Mounted[]>()
// The clock that draws the frames, and its period; none while the picture is still.
const ticking: { timer: Timer | undefined; ms: number | undefined } = { timer: undefined, ms: undefined }
// `isLive`: a person is at the prompt. A `claude -p` run (the usage request itself
// is one) loads the add-on too, and must not ask anything.
const asked = { isOut: false, activeAt: 0, isLive: false, account: '' }
// The width of the left text shown now (see leftOf); `isStale` until the footer is drawn for it.
// It follows the hint, so the row gets its room back when a background shell's pills go.
const hint = { left: 0, isStale: false }

// The context window as Claude Code reports it, and what the gauge shows on its way there:
// `before` is where it stood when the figure last changed, `since` the frames since.
const context = {
  reading: undefined as ContextReading | undefined,
  threshold: undefined as number | undefined,
  shown: 0,
  before: 0,
  since: 1_000_000,
}

const contextScene = (): ContextScene => ({
  reading: context.reading,
  shown: context.shown,
  before: context.before,
  since: context.since,
})

// The context gauge moves while a reply flashes in or a compaction fades out, while the
// figure is on its way, and while it blinks near the compaction point; still otherwise.
const isContextMoving = () => {
  const { reading } = context
  if (reading === undefined) return false
  const near = context.shown / (reading.threshold ?? reading.window)

  return context.since < 30 || Math.abs(context.shown - reading.tokens) >= 500 || near >= 0.95
}

const moodNow = (): Mood => {
  if (motion.partyLeft > 0) return 'party'
  if (motion.isWorking) {
    return motion.gauges.some(gauge => gauge.used >= 90) ? 'alarm' : 'working'
  }

  return motion.idleTicks > ASLEEP_AFTER ? 'asleep' : 'idle'
}

const sceneNow = (): Scene => ({
  gauges: motion.gauges.map(gauge => ({ ...gauge, shown: shown.get(gauge.kind) ?? 0 })),
  mood: moodNow(),
  tick: motion.tick,
})

const paint = (one: Mounted): Frame => drawRow({ limits: sceneNow(), context: contextScene() }, one.room)

const follow = (limits: Limit[], now: number) => {
  motion.gauges = limits.map(limit => gaugeOf(limit, now))
}

// How often a frame is needed now: every 125 ms while something moves (a turn, a reply's
// wave, numbers on their way, the context flashing), every 500 ms while only the last
// cells breathe at rest, never while nothing is shown or asleep.
const periodNow = (): number | undefined => {
  const all = [...sites.values()].flat()
  if (all.length === 0) return undefined
  const mood = moodNow()
  const isGliding = motion.gauges.some(gauge => Math.abs((shown.get(gauge.kind) ?? 0) - gauge.used) >= 0.4)
  if (mood === 'working' || mood === 'party' || mood === 'alarm' || isGliding || isContextMoving()) return FRAME_MS
  if (mood === 'idle') return REST_MS

  return undefined
}

// Starts, changes or stops the frame clock to suit what is on screen.
const schedule = ($: EngineInterface) => {
  const ms = periodNow()
  if (ms === ticking.ms) return
  ticking.timer?.cancel()
  ticking.ms = ms
  ticking.timer = ms === undefined ? undefined : $.clock.every(ms, () => frame($, ms / FRAME_MS))
}

// One frame, `step` eighths of a second after the last: move the meters a quarter of the
// way, repaint what changed.
const frame = ($: EngineInterface, step: number) => {
  motion.tick += step
  motion.partyLeft = Math.max(0, motion.partyLeft - step)
  motion.idleTicks = motion.isWorking ? 0 : motion.idleTicks + step
  for (const gauge of motion.gauges) {
    const at = shown.get(gauge.kind) ?? 0
    const gap = gauge.used - at
    shown.set(gauge.kind, Math.abs(gap) < 0.4 ? gauge.used : at + gap * 0.25)
  }
  if (context.since < 1_000_000) context.since += step
  const target = context.reading?.tokens ?? 0
  context.shown = Math.abs(target - context.shown) < 500 ? target : context.shown + (target - context.shown) * 0.22

  for (const list of sites.values()) {
    for (const one of list) {
      const next = paint(one)
      const isSame = next.cells === one.cells
      // Another size means the numbers changed: the redraw on its way mounts it.
      if (isSame || next.columns !== one.columns || next.rows !== one.rows) continue
      one.cells = next.cells
      void $.ui
        .blit({ requestId: one.requestId, key: one.key, cells: next.cells })
        .catch(() => undefined)
    }
  }
  redrawForHint($)
  schedule($)
}

// The left text grew wider than the footer was drawn for: draw it again to the new room.
const redrawForHint = ($: EngineInterface) => {
  if (!hint.isStale) return
  hint.isStale = false
  $.ui.invalidate('ui.render')
}

// An account, as the minute its week starts over; '' when not known yet.
const accountOf = (resetsAt: string | undefined) => {
  const at = resetsAt === undefined ? NaN : Date.parse(resetsAt.replace(/\.\d+/, ''))

  return Number.isNaN(at) ? '' : String(Math.round(at / 60_000))
}

// A new figure for the window: the gauge flashes in what a reply added, or fades out what
// a compaction let go of. The first figure of a session is shown as it is.
const readContext = (tokens: number | undefined, window: number) => {
  if (tokens === undefined || window <= 0) return
  const last = context.reading?.tokens
  if (last === undefined) context.shown = tokens
  else if (last !== tokens) {
    context.before = context.shown
    context.since = 0
  }
  context.reading = { tokens, window, ...(context.threshold === undefined ? {} : { threshold: context.threshold }) }
}

// Where auto-compact runs, from /context's breakdown counted locally (no request is sent):
// asked at the start and after each reply, as it follows the model.
const measureThreshold = async ($: EngineInterface) => {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const breakdown = usage.context.breakdown
    context.threshold = breakdown?.isAutoCompactEnabled === true ? breakdown.autoCompactThreshold : undefined
    if (context.reading !== undefined) {
      const { tokens, window } = context.reading
      context.reading = { tokens, window, ...(context.threshold === undefined ? {} : { threshold: context.threshold }) }
    }
  } catch {
    // No breakdown on this build: the gauge shows the window without the compaction mark.
  }
}

const measure = async ($: EngineInterface) => {
  const usage = await $.session.usage()
  const engine: Limit[] = usage.rateLimits.map(limit => ({
    kind: limit.kind,
    percentUsed: limit.percentUsed,
    ...(limit.resetsAt === undefined ? {} : { resetsAt: limit.resetsAt }),
  }))
  const account = accountOf(engine.find(limit => limit.kind === 'seven_day')?.resetsAt)
  if (account !== '') asked.account = account
  // The engine's own numbers first; the usage answer fills in what it has not got (a model's
  // week always, the 5 hours and the week too in a window that has not had its first reply).
  const limits: Limit[] = [
    ...engine,
    ...(await read($, scoped)).filter(limit => !engine.some(one => one.kind === limit.kind)),
  ]
  const now = await $.clock.now()
  follow(limits, now)
  readContext(usage.context.tokens, usage.context.window)
  schedule($)
  await update($, reading, () => ({ limits }))
  await update($, clock, () => now)
}

// Claude Code's own usage request, as its SDK sends it: the answer lists every
// limit of the plan, a model's own weekly limit among them.
const USAGE_ASK = `${JSON.stringify({
  type: 'control_request',
  request_id: 'usage-footer',
  request: { subtype: 'get_usage', skip_behaviors: true },
})}\n`
const USAGE_ARGS = [
  '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands', '--model', 'haiku',
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isLimit = (value: unknown): value is Limit =>
  isRecord(value) && typeof value.kind === 'string' && typeof value.percentUsed === 'number'

// A limit in the answer: `{ utilization: 37, resets_at }`. The time comes with six
// decimals of a second; three is what every Date.parse reads.
const limitOf = (kind: string, one: unknown, label?: string): Limit[] => {
  if (!isRecord(one) || typeof one.utilization !== 'number') return []
  const resetsAt = typeof one.resets_at === 'string' ? one.resets_at.replace(/\.\d+/, '') : undefined

  return [{ kind, percentUsed: one.utilization, ...(label === undefined ? {} : { label }), ...(resetsAt === undefined ? {} : { resetsAt }) }]
}

// The usage answer: whose it is, its 5 hours and week, and each model's own week
// (`model_scoped: [{ display_name: "Fable", utilization: 37, resets_at }]`).
const answerOf = (stdout: string): { account: string; limits: Limit[] } | undefined => {
  for (const line of stdout.split('\n')) {
    if (!line.includes('"control_response"')) continue
    let answer: unknown
    try {
      answer = JSON.parse(line)
    } catch {
      continue
    }
    const outer = isRecord(answer) && isRecord(answer.response) ? answer.response.response : undefined
    const all = isRecord(outer) && isRecord(outer.rate_limits) ? outer.rate_limits : undefined
    if (all === undefined) return undefined
    const week = limitOf('seven_day', all.seven_day)
    // An account with no model of its own week (your main one) answers null here.
    const models: unknown[] = Array.isArray(all.model_scoped) ? all.model_scoped : []

    return {
      account: accountOf(week[0]?.resetsAt),
      limits: [
        ...limitOf('five_hour', all.five_hour),
        ...week,
        ...models.flatMap((one: unknown): Limit[] => {
          if (!isRecord(one) || typeof one.display_name !== 'string') return []
          const label = one.display_name.toLowerCase()

          return limitOf(`seven_day_${label.replace(/[^a-z0-9]+/g, '_')}`, one, label)
        }),
      ],
    }
  }

  return undefined
}

const takeScoped = async ($: EngineInterface, found: Limit[]) => {
  if (JSON.stringify(found) === JSON.stringify(await read($, scoped))) return
  await update($, scoped, () => found)
  await measure($)
}

// The engine hands a plugin the 5-hour and the weekly limit, not a model's own weekly
// limit (Fable). So a second Claude Code is asked, silently: it gets the usage request
// and no prompt, uses nothing up, and answers in about a second. A reading another
// window of the account took in the last 3 minutes is used instead, and nothing is asked
// after 30 quiet minutes: at most 20 asks an hour, however many windows are open.
const askScoped = async ($: EngineInterface) => {
  if (!asked.isLive || asked.isOut) return
  const now = await $.clock.now()
  // Not known in a window whose engine has no numbers yet: then it asks for its own.
  const account = asked.account
  if (account !== '') {
    const kept = await $.store.get(`usage:${account}`)
    if (isRecord(kept) && now - Number(kept.at) < SHARED_MS && Array.isArray(kept.limits)) {
      await takeScoped($, kept.limits.filter(isLimit))
      return
    }
    if (now - Number((await $.store.get(`asking:${account}`)) ?? 0) < ASKING_MS) return
  }
  if (now - asked.activeAt > SCOPED_QUIET_MS) return
  asked.isOut = true
  if (account !== '') await $.store.set(`asking:${account}`, now)
  try {
    const ran = await $.process.run(['claude', ...USAGE_ARGS], { stdin: USAGE_ASK, timeoutMs: 20_000 })
    const answer = answerOf(ran.stdout)
    if (answer !== undefined) {
      if (asked.account === '') asked.account = answer.account
      if (answer.account !== '') await $.store.set(`usage:${answer.account}`, { limits: answer.limits, at: await $.clock.now() })
      await takeScoped($, answer.limits)
    }
  } catch {
    // No `claude` on the path, or it did not answer in time: the row keeps what it had.
  } finally {
    asked.isOut = false
    if (account !== '') await $.store.set(`asking:${account}`, 0)
  }
}

// Every half minute: the limits the engine has, and the model's own when they are due.
const refresh = async ($: EngineInterface) => {
  await measure($)
  if (choiceOf(await read($, design)) !== 'off') await askScoped($)
  redrawForHint($)
}

const choose = async ($: EngineInterface, pick: Choice) => {
  await update($, design, () => pick)
  await $.store.set('design', pick)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    asked.isLive = e.isInteractive
    if (!e.isInteractive) return next(e)

    await $.command.register({
      name: 'limits',
      description: 'The footer row of mini bars: context, 5h, week and a model\'s week. /limits off hides it',
      argumentHint: 'on | off',
    })

    // First load of the session: take the saved choice.
    if ((await $.state.get(designRef)).version === 0) {
      const saved = choiceOf(await $.store.get('design'))
      await update($, design, () => saved)
    }
    if ((await $.store.get('built')) !== BUILT) {
      await choose($, 'tiles')
      await $.store.set('built', BUILT)
    }

    await measure($)
    await measureThreshold($)
    asked.activeAt = await $.clock.now()
    // Background work: a reload or the end of the session may cut it short, and that is fine.
    void askScoped($).catch(() => undefined)
    $.clock.every(MEASURE_MS, () => void refresh($).catch(() => undefined))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await measure($)
    schedule($)

    return next(e)
  })

  on('turn.start', ($, e, next) => {
    motion.isWorking = true
    motion.partyLeft = 0
    motion.idleTicks = 0
    schedule($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      motion.isWorking = false
      motion.partyLeft = e.isAborted ? 0 : PARTY
      asked.activeAt = await $.clock.now()
      schedule($)
      void askScoped($).catch(() => undefined)
      void measureThreshold($)
    }

    return next(e)
  })

  on('command.run', { command: 'limits' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()

    if (word === '') {
      return {
        text:
          choiceOf(await read($, design)) === 'off'
            ? 'The footer row is hidden. /limits on brings it back.'
            : 'The footer row shows ctx, 5h, wk and a model\'s week as tiles that fill like bars, each with its reset time, shrinking together as the window narrows. /limits off hides it.',
      }
    }
    if (word === 'on' || word === 'tiles') {
      await choose($, 'tiles')

      return { text: 'Now showing the footer row.' }
    }
    if (word === 'off') {
      await choose($, 'off')

      return { text: 'The footer row is hidden. /limits on brings it back.' }
    }

    return { text: 'Type /limits on or /limits off. (Bar tiles replaced Mini bars on 29 Oct; Lamps, Panel, Strip, Ledger and the cache designs were retired before.)' }
  })

  // The right of the footer: one row of tiles, as wide as the room the left text leaves.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const choice = choiceOf(await read($, design))
    const { limits } = await read($, reading)
    const now = await read($, clock)
    const columns = e.viewport?.columns ?? 80
    const modes = e.props.modes.join(' & ')
    follow(limits, now)
    const mounted: Mounted[] = []
    sites.set(e.requestId, mounted)
    // Pictures are a terminal's: elsewhere the engine draws its own footer.
    if (choice === 'off' || e.surface !== 'terminal') {
      schedule($)

      return next(e)
    }
    const room = roomOf(columns, hint.left, modes)
    const row = drawRow({ limits: sceneNow(), context: contextScene() }, room)
    if (row.columns === 0) {
      schedule($)

      return next(e)
    }
    mounted.push({ requestId: e.requestId, key: 'row', room, columns: row.columns, rows: row.rows, cells: row.cells })
    schedule($)
    const { Box, Raster, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Raster key="row" columns={row.columns} rows={row.rows} cells={row.cells} />
        {modes !== '' && <Text dimColor>{`   ${modes}`}</Text>}
      </Box>
    )
  })

  // The hint line: while the row is shown, a plain hint is shortened (row.ts), and the left
  // text's width as drawn is what the row measures its room by. (The terminal joins a tail to
  // the line with a dot.)
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (choiceOf(await read($, design)) === 'off' || e.surface !== 'terminal') return next(e)
    const tail = e.props.tail
    const short = tail === undefined ? SHORT_HINTS[e.props.hint] : undefined
    const left = short === undefined ? leftOf(tail === undefined ? e.props.hint : `${e.props.hint} · ${tail}`, false) : leftOf(short, true)
    if (left !== hint.left) {
      hint.left = left
      hint.isStale = true
      // The frame clock may be still (asleep): draw the row for its new room now.
      redrawForHint($)
    }

    return short === undefined ? next(e) : next({ ...e, props: { ...e.props, hint: short } })
  })
}
