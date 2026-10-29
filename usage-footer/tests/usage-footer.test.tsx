import type { On, SessionRateLimit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-03T17:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

// 5h window: 34% used, 2h 14m left. Week: 21% used, 3d 4h left.
const CALM: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 34, resetsAt: iso(NOW + 2 * HOUR + 14 * 60_000) },
  { kind: 'seven_day', percentUsed: 21, resetsAt: iso(NOW + 76 * HOUR) },
]

// 5h window: 80% used with half the window gone, so it runs out early.
const FAST: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 80, resetsAt: iso(NOW + 2.5 * HOUR) },
]

const TERMINAL = { surface: 'terminal', viewport: { columns: 180, rows: 50 } } as const
const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const
const FOOTER = { plugin: 'usage-footer', component: 'SessionMode', props: { modes: [] }, ...TERMINAL } as const
const HINT = {
  plugin: 'usage-footer',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  ...TERMINAL,
} as const

type Blit = { requestId: string; key: string; cells: string }

// The engine beneath the mod: a clock, a store, the usage figures, the footer.
const world = (
  on: On,
  limits: SessionRateLimit[],
  saved?: Record<string, unknown>,
  answer?: Record<string, unknown>,
  window: { tokens?: number; window: number; threshold?: number } = { window: 200_000 },
) => {
  // Tests start with Lamps already switched on once, unless they say otherwise.
  const store: Record<string, unknown> = { built: 'lamps-row', ...saved }
  // Claude Code's own usage request, answered as it answers: Fable at 38%.
  const usage = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: 'usage-footer',
      response: {
        rate_limits: answer ?? {
          five_hour: { utilization: 34, resets_at: iso(NOW + 2 * HOUR + 14 * 60_000).replace('Z', '456+00:00') },
          seven_day: { utilization: 21, resets_at: iso(NOW + 76 * HOUR).replace('Z', '789+00:00') },
          model_scoped: [{ display_name: 'Fable', utilization: 38, resets_at: iso(NOW + 76 * HOUR).replace('Z', '123+00:00') }],
        },
      },
    },
  }
  // Each ask for Fable's number is a second Claude Code started: counted.
  const asks = { count: 0 }
  on('process.run', () => {
    asks.count += 1

    return {
      value: { exitCode: 0, stdout: `${JSON.stringify(usage)}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  const blits: Blit[] = []
  const clock = mock.clock(on, { now: NOW })
  on('store.get', ($, e) => ({ value: store[e.key] }))
  on('store.set', ($, e) => {
    store[e.key] = e.value

    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: {
        window: window.window,
        ...(window.tokens === undefined ? {} : { tokens: window.tokens }),
        // /context's breakdown, as far as the add-on reads it: where auto-compact runs.
        ...(window.threshold === undefined ? {} : { breakdown: { autoCompactThreshold: window.threshold, isAutoCompactEnabled: true } as never }),
      },
      rateLimits: limits,
    },
  }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.blit', ($, e) => {
    if ('cells' in e) blits.push({ requestId: e.requestId, key: e.key, cells: e.cells })

    return { value: {} }
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    // The terminal joins the tail to its own line with a dot.
    return (
      <Text>
        {e.props.tail === undefined ? e.props.hint : `${e.props.hint} · ${e.props.tail}`}
      </Text>
    )
  })
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{`engine modes: ${e.props.modes.join(' & ')}`}</Text>
  })
  return { store, blits, clock, asks }
}

const run = (args: string) => ({
  command: 'limits',
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: true, columns: 180 },
})

// A Raster's cells as the lines of text a terminal would show.
const linesOf = (cells: string, columns: number) => {
  const bytes = (Uint8Array as unknown as { fromBase64: (text: string) => Uint8Array }).fromBase64(cells)
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  const lines: string[] = []
  for (let at = 0; at < words.length / 3; at += columns) {
    let line = ''
    for (let x = 0; x < columns; x++) line += String.fromCodePoint(words[(at + x) * 3] ?? 32)
    lines.push(line.trimEnd())
  }

  return lines
}

const lastOf = (blits: Blit[], key: string) => blits.filter(blit => blit.key === key).at(-1)

// A Raster's cells as [glyph, colour] for each cell of a row.
const colorsOf = (cells: string, columns: number, row = 0) => {
  const bytes = (Uint8Array as unknown as { fromBase64: (text: string) => Uint8Array }).fromBase64(cells)
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  const out: [string, number][] = []
  for (let x = 0; x < columns; x++) {
    const at = (row * columns + x) * 3
    out.push([String.fromCodePoint(words[at] ?? 32), words[at + 1] ?? 0])
  }

  return out
}

// A Raster's backgrounds for each cell of a row (a bar's track).
const backsOf = (cells: string, columns: number, row = 0) => {
  const bytes = (Uint8Array as unknown as { fromBase64: (text: string) => Uint8Array }).fromBase64(cells)
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  const out: number[] = []
  for (let x = 0; x < columns; x++) out.push(words[(row * columns + x) * 3 + 2] ?? 0)

  return out
}

// The left of your footer in bypass mode, as the engine hands it to the add-on.
const BYPASS = { ...HINT, props: { ...HINT.props, hint: '(shift+tab to cycle)' } } as const
const at = (columns: number) => ({ ...FOOTER, viewport: { columns, rows: 40 } })
// An account in the store: the minute its week starts over.
const ACCOUNT = String(Math.round((NOW + 76 * HOUR) / 60_000))
// Tile fills, base and bright (the last lit cell breathes), and the words off the fill.
const GREEN = 0x5faf5f
const YELLOW = 0xd7af5f
const ORANGE = 0xd7875f
const RED = 0xd75f5f
const BLUE = 0x5f87af
const TRACK = 0x3a3a3a
const BUFFER = 0x5f0000
const INK = 0x1c1c1c
const calm = (color: number) =>
  ({ 0x87d787: GREEN, 0xffd787: YELLOW, 0xffaf87: ORANGE, 0xff8787: RED, 0x87afd7: BLUE } as Record<number, number>)[color] ?? color
type Test$ = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
const rowOf = async ($: Test$, columns: number) =>
  (await $.ui.mount(at(columns))).find({ type: 'Raster', key: 'row' })
const lineAt = async ($: Test$, columns: number) => {
  const raster = await rowOf($, columns)
  return raster === undefined ? '' : (linesOf(String(raster.props.cells), Number(raster.props.columns))[0] ?? '')
}
// A row's fills, cell by cell, the breathing cell read as its plain colour.
const fillsAt = async ($: Test$, columns: number) => {
  const raster = await rowOf($, columns)
  return backsOf(String(raster?.props.cells), Number(raster?.props.columns)).map(calm)
}
const hintOf = async ($: Test$, mount: typeof BYPASS | { [key: string]: unknown }) => {
  const text = await (await $.ui.mount(mount as typeof BYPASS)).find({ type: 'Text' })
  return text?.text ?? ''
}
const WORKING = { ...BYPASS, props: { ...BYPASS.props, isWorking: true, hint: '(shift+tab to cycle) · esc to interrupt' } } as const
const SHELL = { ...BYPASS, props: { ...BYPASS.props, isWorking: true, hint: '1 shell · esc to interrupt · ↓ to manage' } } as const
// Your numbers on 29 Oct: 5h at 79% with 1h 12m left, the week at 24% with 4d 6h left.
const BUSY: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 79, resetsAt: iso(NOW + HOUR + 12 * 60_000) },
  { kind: 'seven_day', percentUsed: 24, resetsAt: iso(NOW + 4 * 24 * HOUR + 6 * HOUR) },
]

test('one row of four tiles, the same parts in the same places; ctx waits as "--" for its first figure', async ($, on) => {
  const { clock } = world(on, CALM)
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  const raster = await rowOf($, 180)
  expect(raster?.props.rows).toBe(1)
  await clock.advance(6000)
  // 180 columns in bypass mode: 132 to the right of the left text; the 24-cell tiles and every
  // time fit. ctx has no time until its first figure.
  expect(await lineAt($, 180)).toBe(' ctx --                   5h 34%           2h14m   wk 21%            3d4h   fable 38%         3d4h')
  // 34% of 24 cells is 8 lit, green, the words on them dark; then the track.
  const drawn = await rowOf($, 180)
  const cells = String(drawn?.props.cells), columns = Number(drawn?.props.columns)
  expect(backsOf(cells, columns).slice(25, 49).map(calm)).toEqual([...Array(8).fill(GREEN), ...Array(16).fill(TRACK)])
  expect(colorsOf(cells, columns).slice(26, 28)).toEqual([['5', INK], ['h', INK]])
})

test('the context tile: its tokens for a time, the track past where it compacts dark red', async ($, on) => {
  const { clock } = world(on, CALM, {}, undefined, { tokens: 130_000, window: 200_000, threshold: 167_000 })
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  await $.ui.mount(at(200))
  await clock.advance(6000)
  // 130k of 200k: 65% of 24 cells is 16 lit, yellow (78% of the way to compacting); compaction
  // at 83.5%: the last four cells are past it.
  expect(await lineAt($, 200)).toMatch(/^ ctx 65% +130k {3}5h /)
  expect((await fillsAt($, 200)).slice(0, 24)).toEqual([...Array(16).fill(YELLOW), ...Array(4).fill(TRACK), ...Array(4).fill(BUFFER)])
})

test('as the window narrows the tiles shrink together, then the times go, then gauges go, calmest first', async ($, on) => {
  const { clock } = world(on, CALM)
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  await $.ui.mount(at(200))
  await clock.advance(6000)
  const lines: [number, string][] = []
  for (const columns of [200, 150, 140, 125, 120, 110, 100, 90, 80, 70]) lines.push([columns, await lineAt($, columns)])
  expect(lines).toEqual([
    [200, ' ctx --                   5h 34%           2h14m   wk 21%            3d4h   fable 38%         3d4h'],
    [150, ' ctx --                   5h 34%           2h14m   wk 21%            3d4h   fable 38%         3d4h'],
    [140, ' ctx --               5h 34%       2h14m   wk 21%        3d4h   fable 38%     3d4h'],
    // 16-cell tiles, made 17 for Fable's words: every tile the same width.
    [125, ' ctx --            5h 34%    2h14m   wk 21%     3d4h   fable 38%  3d4h'],
    [120, ' ctx --            5h 34%    2h14m   wk 21%     3d4h   fable 38%  3d4h'],
    [110, ' ctx --         5h 34% 2h14m   wk 21%  3d4h   fable 38%  3d4h'],
    [100, ' ctx --   5h 34%   wk 21%   fable 38%'],
    [90, ' ctx --   5h 34%   wk 21%   fable 38%'],
    [80, ' 5h 34%   wk 21%   fable 38%  +1'],
    [70, ' fable 38%  +3'],
  ])
})

test('the hint: "(shift+tab to cycle)" is shortened while the row shows; a hint with pills, or no row, keeps the engine\'s', async ($, on) => {
  world(on, BUSY)
  await $.session.start(START)
  expect(await hintOf($, BYPASS)).toBe('⇧tab to cycle')
  expect(await hintOf($, WORKING)).toBe('esc to interrupt')
  expect(await hintOf($, SHELL)).toBe('1 shell · esc to interrupt · ↓ to manage')
  expect(await hintOf($, HINT)).toBe('? for shortcuts')
  await $.command.run(run('off'))
  expect(await hintOf($, BYPASS)).toBe('(shift+tab to cycle)')
  await $.command.run(run('on'))
  expect(await hintOf($, BYPASS)).toBe('⇧tab to cycle')
})

test('the room follows the hint shown now: one size through a turn, smaller while a shell\'s pills show, back after', async ($, on) => {
  const { clock } = world(on, CALM)
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  await $.ui.mount(at(200))
  await clock.advance(6000)
  const before = await lineAt($, 140)
  await $.ui.mount(WORKING)
  await clock.advance(1000)
  expect(await lineAt($, 140)).toBe(before)
  // A background shell: 140 − 3 − 69 = 68 columns; the 17-cell tiles take 71, so the snug ones.
  await $.ui.mount(SHELL)
  await clock.advance(1000)
  expect(Number((await rowOf($, 140))?.props.columns)).toBeLessThanOrEqual(140 - 3 - (2 + 24 + 3 + 40))
  expect(await lineAt($, 140)).toBe(' ctx --         5h 34% 2h14m   wk 21%  3d4h   fable 38%  3d4h')
  // The shell is done: the row gets its room back.
  await $.ui.mount(BYPASS)
  await clock.advance(1000)
  expect(await lineAt($, 140)).toBe(before)
})

test('never wider than the room, at every width, at rest, while working and with a shell', async ($, on) => {
  const { clock } = world(on, BUSY, {}, undefined, { tokens: 64_000, window: 200_000 })
  await $.session.start(START)
  await $.ui.mount(at(200))
  await clock.advance(6000)
  for (const [hint, left] of [[BYPASS, 2 + 24 + 3 + 16], [WORKING, 2 + 24 + 3 + 16], [SHELL, 2 + 24 + 3 + 40]] as const) {
    await $.ui.mount(hint)
    await clock.advance(500)
    for (const columns of [200, 177, 160, 149, 140, 124, 120, 110, 100, 90, 80]) {
      const one = await rowOf($, columns)
      expect(Number(one?.props.columns ?? 0)).toBeLessThanOrEqual(columns - 3 - left)
    }
  }
})

test('120 columns, your smallest window: all four tiles keep their reset times', async ($, on) => {
  const { clock } = world(on, BUSY, {}, undefined, { tokens: 64_000, window: 200_000 })
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  await $.ui.mount(at(200))
  await clock.advance(6000)
  // 120 − 3 − 45 = 72 columns: the 17-cell tiles take 71.
  expect(await lineAt($, 120)).toBe(' ctx 32%     64k   5h 79%    1h12m   wk 24%     4d6h   fable 38%  3d4h')
})

test('the colour says how full: 79% orange (it was green when the colour followed pace), 24% green', async ($, on) => {
  const { clock } = world(on, BUSY)
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  await $.ui.mount(at(200))
  await clock.advance(6000)
  // 79% of 24 cells: 19 orange; 24%: 6 green.
  const fills = await fillsAt($, 200)
  expect(fills.slice(25, 49)).toEqual([...Array(19).fill(ORANGE), ...Array(5).fill(TRACK)])
  expect(fills.slice(50, 74)).toEqual([...Array(6).fill(GREEN), ...Array(18).fill(TRACK)])
})

test('used up: "max", the whole tile red and blinking', async ($, on) => {
  const { clock } = world(on, [{ kind: 'five_hour', percentUsed: 100, resetsAt: iso(NOW + HOUR) }], {}, {
    five_hour: { utilization: 100, resets_at: iso(NOW + HOUR) },
    model_scoped: null,
  })
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  await $.ui.mount(at(160))
  await clock.advance(6000)
  expect(await lineAt($, 160)).toBe(' ctx --                   5h max              1h')
  expect((await fillsAt($, 160)).slice(25, 49)).toEqual(Array(24).fill(RED))
})

test('a gauge in trouble is never the one hidden; "+n" says how many calmer ones are', async ($, on) => {
  const HOT: SessionRateLimit[] = [
    { kind: 'five_hour', percentUsed: 95, resetsAt: iso(NOW + HOUR) },
    { kind: 'seven_day', percentUsed: 21, resetsAt: iso(NOW + 76 * HOUR) },
  ]
  const { clock } = world(on, HOT, {}, {
    five_hour: { utilization: 95, resets_at: iso(NOW + HOUR) },
    seven_day: { utilization: 21, resets_at: iso(NOW + 76 * HOUR) },
    model_scoped: null,
  })
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  await $.ui.mount(at(200))
  await clock.advance(6000)
  // 80 columns: the three fit without their times. 70: room for two, so the calm ctx goes;
  // 60: room for one, the red 5h stays.
  expect(await lineAt($, 80)).toBe(' ctx --   5h 95%   wk 21%')
  expect(await lineAt($, 70)).toBe(' 5h 95%   wk 21%  +1')
  expect(await lineAt($, 60)).toBe(' 5h 95%  +2')
  const raster = await rowOf($, 60)
  const colors = colorsOf(String(raster?.props.cells), Number(raster?.props.columns))
  // The hidden ones are calm: "+2" in grey.
  expect(colors.at(-2)).toEqual(['+', 0x949494])
})


test('frames: many while Claude works, a breath a second at rest, none asleep', async ($, on) => {
  const { blits, clock } = world(on, CALM)
  await $.session.start(START)
  await $.ui.mount(at(180))
  await clock.advance(6000)
  const settled = blits.length

  // At rest: the last lit lamps breathe once a second, nothing else moves.
  await clock.advance(4000)
  expect(blits.length - settled).toBeLessThanOrEqual(5)

  // Working: a light runs up the lit lamps.
  const resting = blits.length
  await $.turn.start({ text: 'go', turnId: 'turn-1' })
  await clock.advance(2000)
  expect(blits.length - resting).toBeGreaterThanOrEqual(6)

  // Five quiet minutes after the reply: asleep, and still.
  await $.turn.complete({ turnId: 'turn-1', isAborted: false, answer: 'done', durationMs: 2000, reason: 'answer' })
  await clock.advance(6 * 60_000)
  const asleep = blits.length
  await clock.advance(10_000)
  expect(blits.length).toBe(asleep)
})

test('no white on the fills at rest or while working (white is only a reply\'s new part flashing in)', async ($, on) => {
  const { blits, clock } = world(on, BUSY)
  await $.session.start(START)
  await $.ui.mount(at(180))
  await $.turn.start({ text: 'go', turnId: 'turn-1' })
  await clock.advance(3000)
  expect(blits.filter(one => one.key === 'row').length).toBeGreaterThan(4)
  for (const blit of blits.filter(one => one.key === 'row')) {
    const bytes = (Uint8Array as unknown as { fromBase64: (text: string) => Uint8Array }).fromBase64(blit.cells)
    expect(backsOf(blit.cells, bytes.byteLength / 12)).not.toContain(0xeeeeee)
  }
})

test('/limits off hides the row, /limits on brings it back, a retired design\'s name explains', async ($, on) => {
  const { store } = world(on, CALM)
  await $.session.start(START)
  expect((await $.command.run(run('off'))).text).toMatch('hidden')
  expect(store.design).toBe('off')
  expect(await (await $.ui.mount(at(180))).findAll({ type: 'Raster' })).toHaveLength(0)
  expect((await $.command.run(run(''))).text).toMatch('/limits on')
  expect((await $.command.run(run('lamps'))).text).toMatch('retired')
  expect(store.design).toBe('off')
  expect((await $.command.run(run('on'))).text).toBe('Now showing the footer row.')
  expect(store.design).toBe('tiles')
  expect(await (await $.ui.mount(at(180))).find({ type: 'Raster', key: 'row' })).toBeDefined()
})

test('the row switches on once when it is new: a saved Mini bars, a trial design or off becomes Bar tiles', async ($, on) => {
  const { store } = world(on, CALM, { design: 'off', built: 'lamps-row' })
  await $.session.start(START)
  expect(store.design).toBe('tiles')
  expect(store.built).toBe('tiles-row')
  expect(await (await $.ui.mount(at(180))).find({ type: 'Raster', key: 'row' })).toBeDefined()
})

test('a window past its reset time reads 0% and "new"', async ($, on) => {
  world(on, [{ kind: 'five_hour', percentUsed: 97, resetsAt: iso(NOW - 60_000) }], {}, {
    five_hour: { utilization: 97, resets_at: iso(NOW - 60_000) },
    model_scoped: null,
  })
  await $.session.start(START)
  expect(await lineAt($, 200)).toMatch(/ 5h 0% +new$/)
})

test('on a surface without the terminal grid, the footer is the engine\'s own', async ($, on) => {
  world(on, CALM)
  await $.session.start({ ...START, surface: 'desktop' })
  const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })

  expect((await footer.drawn()) as unknown).toMatchObject({ children: ['engine modes: '] })
})

test('a window whose engine has no numbers yet shows the answer\'s 5 hours and week at once, and files them', async ($, on) => {
  const { clock, store } = world(on, [])
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  await $.ui.mount(at(200))
  await clock.advance(6000)
  expect(await lineAt($, 200)).toBe(' ctx --                   5h 34%           2h14m   wk 21%            3d4h   fable 38%         3d4h')
  expect(store[`usage:${ACCOUNT}`]).toBeDefined()
})

test('an account with no Fable week (model_scoped null) gets three tiles: ctx, 5h, wk', async ($, on) => {
  const { clock, store } = world(on, [], {}, {
    five_hour: { utilization: 0, resets_at: iso(NOW + 3 * HOUR) },
    seven_day: { utilization: 44, resets_at: iso(NOW + 4 * HOUR) },
    model_scoped: null,
  })
  await $.session.start(START)
  await $.ui.mount(at(200))
  await clock.advance(6000)
  expect(await lineAt($, 200)).toBe(' ctx --                   5h 0%               3h   wk 44%              4h')
  expect(Object.keys(store).filter(key => key.startsWith('usage:'))).toEqual([`usage:${Math.round((NOW + 4 * HOUR) / 60_000)}`])
})

test('Fable: every window shares one reading; a fresh one is used as it is, an old one asked for once', async ($, on) => {
  const kept = [{ kind: 'seven_day_fable', label: 'fable', percentUsed: 41, resetsAt: iso(NOW + 76 * HOUR) }]
  // Filed under the account: the minute its week starts over.
  const { asks, clock, store } = world(on, CALM, { [`usage:${ACCOUNT}`]: { limits: kept, at: NOW - 60_000 } })
  await $.session.start(START)
  // Another window read it a minute ago: nothing is asked, its 41% is shown.
  expect(asks.count).toBe(0)
  await $.ui.mount(at(200))
  await clock.advance(6000)
  expect(await lineAt($, 200)).toMatch(/ fable 41% +3d4h$/)
  expect(asks.count).toBe(0)

  // Three minutes after that reading it is old: one window asks, and stores the answer for the rest.
  await clock.advance(144_000)
  expect(asks.count).toBe(1)
  const fresh = store[`usage:${ACCOUNT}`] as { at: number; limits: { label?: string; percentUsed: number }[] }
  expect(fresh.at).toBeGreaterThan(NOW)
  expect(fresh.limits.find(limit => limit.label === 'fable')?.percentUsed).toBe(38)
  // Ten minutes of the clock: one ask every three minutes at most.
  await clock.advance(10 * 60_000)
  expect(asks.count).toBeLessThanOrEqual(5)
})

test('Fable: while another window is asking, this one waits; after 30 quiet minutes nobody asks', async ($, on) => {
  const { asks, clock, store } = world(on, CALM, { [`asking:${ACCOUNT}`]: NOW - 5_000 })
  await $.session.start(START)
  await clock.advance(1000)
  expect(asks.count).toBe(0)
  store[`asking:${ACCOUNT}`] = 0
  await clock.advance(31 * 60_000)
  const before = asks.count
  expect(before).toBeGreaterThan(0)
  await clock.advance(20 * 60_000)
  expect(asks.count).toBe(before)
})

test('Fable: a reading filed under another account is not taken; this account asks its own', async ($, on) => {
  const other = [{ kind: 'seven_day_fable', label: 'fable', percentUsed: 99, resetsAt: iso(NOW + 9 * HOUR) }]
  const { asks, clock, store } = world(on, CALM, { 'usage:29326260': { limits: other, at: NOW - 60_000 } })
  await $.session.start(START)
  await clock.advance(1000)
  expect(asks.count).toBe(1)
  const own = store[`usage:${ACCOUNT}`] as { limits: { label?: string; percentUsed: number }[] }
  expect(own.limits.find(limit => limit.label === 'fable')?.percentUsed).toBe(38)
})

