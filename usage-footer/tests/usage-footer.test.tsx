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
const GREEN = 0x5fd75f
const YELLOW = 0xffd75f
const SPARE = 0x6c6c6c
const AHEAD = 0x3a3a3a

const BLUE = 0x5fafd7
const BUFFER = 0x5f0000
const RED = 0xff5f5f
// A meter's lamps, with the breathing last lamp read as its plain colour.
const calm = (color: number) =>
  ({ 0xffff87: YELLOW, 0x87ff87: GREEN, 0xafd7ff: BLUE, 0xff8787: RED } as Record<number, number>)[color] ?? color
type Test$ = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
const rowOf = async ($: Test$, columns: number) =>
  (await $.ui.mount(at(columns))).find({ type: 'Raster', key: 'row' })
const lineAt = async ($: Test$, columns: number) => {
  const raster = await rowOf($, columns)
  return raster === undefined ? '' : (linesOf(String(raster.props.cells), Number(raster.props.columns))[0] ?? '')
}

test('one row of four gauges, same parts in the same places; ctx waits as "--" for its first figure', async ($, on) => {
  const { clock } = world(on, CALM)
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  const raster = await rowOf($, 180)
  expect(raster?.props.rows).toBe(1)
  await clock.advance(6000)
  // 180 columns in bypass mode: 111 to the right of the left text; 8-cell bars and the times fit.
  // 34% of 8 cells is 22 eighths: two full cells and ▊; 21% is 13 (█▋); 38% is 24 (███).
  expect(await lineAt($, 180)).toBe('ctx           --         5h ██▊      34% 2h 14m  wk █▋       21%  3d 4h  fable ███      38%  3d 4h')
})

test('the context is a gauge like the limits: tokens as its time, the track past where it compacts dark red', async ($, on) => {
  const { clock } = world(on, CALM, {}, undefined, { tokens: 130_000, window: 200_000, threshold: 167_000 })
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  // The meters glide up while the row is on screen.
  await $.ui.mount(at(200))
  await clock.advance(6000)
  // 200 columns: 8-cell bars. 130k of 200k: 65%, 42 eighths (█████▎), yellow (78% of the way
  // to compacting); compaction at 83.5%: the last cell is past it.
  const raster = await rowOf($, 200)
  const cells = String(raster?.props.cells)
  const columns = Number(raster?.props.columns)
  expect(linesOf(cells, columns)[0]).toMatch(/^ctx █████▎   65%   130k  5h ██▊      34% 2h 14m  wk /)
  const bar = colorsOf(cells, columns).slice(4, 12)
  expect(bar.map(([glyph]) => glyph)).toEqual(['█', '█', '█', '█', '█', '▎', ' ', ' '])
  expect(bar.slice(0, 6).map(([, color]) => calm(color))).toEqual(Array(6).fill(YELLOW))
  expect(backsOf(cells, columns).slice(4, 12)).toEqual([AHEAD, AHEAD, AHEAD, AHEAD, AHEAD, AHEAD, AHEAD, BUFFER])
})

test('as the window narrows the gauges shrink together, never come back, and gauges go last, calmest first', async ($, on) => {
  const { clock } = world(on, CALM)
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  await $.ui.mount(at(200))
  await clock.advance(6000)
  const lines: [number, string][] = []
  for (const columns of [200, 180, 149, 124, 110, 100, 90, 80, 70]) lines.push([columns, await lineAt($, columns)])
  expect(lines).toEqual([
    [200, 'ctx           --         5h ██▊      34% 2h 14m  wk █▋       21%  3d 4h  fable ███      38%  3d 4h'],
    [180, 'ctx           --         5h ██▊      34% 2h 14m  wk █▋       21%  3d 4h  fable ███      38%  3d 4h'],
    [149, 'ctx     --         5h ▋  34% 2h 14m  wk ▍  21%  3d 4h  fable ▊  38%  3d 4h'],
    [124, 'ctx     --  5h ▋  34%  wk ▍  21%  fable ▊  38%'],
    [110, 'ctx  --  5h 34%  wk 21%  fable 38%'],
    [100, '5h 34%  wk 21%  fable 38% +1'],
    [90, '5h 34%  fable 38% +2'],
    [80, 'fable 38%'],
    // No room at all next to the left text: the engine's own footer, nothing pushed to a second row.
    [70, ''],
  ])
})

test('never wider than the room: the row keeps one size while Claude works, and makes room for wider left text once seen', async ($, on) => {
  const { clock } = world(on, CALM)
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  // The meters glide up while the row is on screen.
  await $.ui.mount(at(200))
  await clock.advance(6000)
  const before = await lineAt($, 149)
  // Working: the left gains "· esc to interrupt". The row was already sized for it.
  await $.ui.mount({ ...BYPASS, props: { ...BYPASS.props, isWorking: true, hint: '(shift+tab to cycle) · esc to interrupt' } })
  await clock.advance(1000)
  expect(await lineAt($, 149)).toBe(before)
  // A background task while Claude works: three columns wider than that. From then on the row
  // takes it into account: 149 − 3 − 69 = 77 columns, still the 2-cell bars with times (74).
  await $.ui.mount({ ...BYPASS, props: { ...BYPASS.props, hint: '1 shell · esc to interrupt · ↓ to manage' } })
  await clock.advance(1000)
  const raster = await rowOf($, 149)
  expect(Number(raster?.props.columns)).toBeLessThanOrEqual(149 - 3 - (2 + 24 + 3 + 40))
  for (const columns of [200, 177, 160, 149, 140, 124, 110, 100, 90, 80]) {
    const one = await rowOf($, columns)
    expect(Number(one?.props.columns ?? 0)).toBeLessThanOrEqual(columns - 3 - (2 + 24 + 3 + 40))
  }
})

test('120 columns, your smallest window: all four gauges keep their bars, even with a background shell while Claude works', async ($, on) => {
  const { clock } = world(on, CALM)
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  await $.ui.mount(at(200))
  await clock.advance(6000)
  // At rest: 120 − 3 − 66 = 51 columns of room; the 2-cell bars take 46.
  expect(await lineAt($, 120)).toBe('ctx     --  5h ▋  34%  wk ▍  21%  fable ▊  38%')
  // The widest left text Claude Code draws: 120 − 3 − 69 = 48. The row does not change.
  await $.ui.mount({ ...BYPASS, props: { ...BYPASS.props, isWorking: true, hint: '1 shell · esc to interrupt · ↓ to manage' } })
  await clock.advance(1000)
  const raster = await rowOf($, 120)
  expect(Number(raster?.props.columns)).toBe(46)
  expect(await lineAt($, 120)).toBe('ctx     --  5h ▋  34%  wk ▍  21%  fable ▊  38%')
})

test('used up: a full bar, "max" in red in the percent\'s three columns', async ($, on) => {
  const { clock } = world(on, [{ kind: 'five_hour', percentUsed: 100, resetsAt: iso(NOW + HOUR) }], {}, {
    five_hour: { utilization: 100, resets_at: iso(NOW + HOUR) },
    model_scoped: null,
  })
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  // The meter glides up while the row is on screen. Two gauges: the long bars fit at 124.
  await $.ui.mount(at(124))
  await clock.advance(6000)
  expect(await lineAt($, 124)).toBe('ctx           --         5h ████████ max  1h 0m')
  const raster = await rowOf($, 124)
  const colors = colorsOf(String(raster?.props.cells), Number(raster?.props.columns))
  expect(colors.slice(37, 40)).toEqual([['m', RED], ['a', RED], ['x', RED]])
})

test('running fast: the gauge turns yellow, and its time says when it runs out (as previewed on 4 Oct)', async ($, on) => {
  const { blits, clock } = world(on, FAST)
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  const raster = await rowOf($, 200)
  await clock.advance(6000)
  const cells = lastOf(blits, 'row')?.cells ?? String(raster?.props.cells)
  const row = colorsOf(cells, Number(raster?.props.columns))
  // The 5h gauge is the second (ctx takes 23 columns and 2 between): 80% used with half the
  // window gone, so it runs out first: 51 eighths yellow (██████▍), one cell of dark track;
  // out in 38m, in yellow.
  const at5h = 23 + 2
  expect(row.slice(at5h + 3, at5h + 10).map(([, color]) => calm(color))).toEqual(Array(7).fill(YELLOW))
  expect(backsOf(cells, Number(raster?.props.columns))[at5h + 10]).toBe(AHEAD)
  expect(row[at5h + 12]).toEqual(['8', YELLOW])
  expect(linesOf(cells, Number(raster?.props.columns))[0]).toMatch(/ {2}5h ██████▍ {2}80% {4}38m {2}wk /)
  expect(row[at5h + 19]).toEqual(['3', YELLOW])
})

test('on the track, time gone that was not used is grey and time to come dark, at every width that has bars', async ($, on) => {
  const { clock } = world(on, CALM)
  await $.session.start(START)
  await $.ui.mount(BYPASS)
  // The meters glide up while the row is on screen.
  await $.ui.mount(at(200))
  await clock.advance(6000)
  // 5h (the second gauge): 34% used, 55% of the window gone. Eight cells: 2¾ lit green, the
  // track grey to cell 4 and dark after; two cells: ▋ lit, grey under it, the second dark.
  // ctx takes 23 columns with 8-cell bars and 17 with 2, then 2 between.
  const eight = await rowOf($, 200)
  const eightCells = String(eight?.props.cells), eightColumns = Number(eight?.props.columns)
  expect(colorsOf(eightCells, eightColumns).slice(28, 31).map(([, c]) => calm(c))).toEqual([GREEN, GREEN, GREEN])
  expect(backsOf(eightCells, eightColumns).slice(28, 36)).toEqual([SPARE, SPARE, SPARE, SPARE, AHEAD, AHEAD, AHEAD, AHEAD])
  const two = await rowOf($, 149)
  const twoCells = String(two?.props.cells), twoColumns = Number(two?.props.columns)
  expect(colorsOf(twoCells, twoColumns).slice(22, 24).map(([glyph, c]) => [glyph, calm(c)])).toEqual([['▋', GREEN], [' ', 0x01000000]])
  expect(backsOf(twoCells, twoColumns).slice(22, 24)).toEqual([SPARE, AHEAD])
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
  // The meters glide up while the row is on screen.
  await $.ui.mount(at(200))
  await clock.advance(6000)
  // 90 columns: room for two, so the calm ctx goes; 80: room for one, the red 5h stays.
  expect(await lineAt($, 90)).toBe('5h 95%  wk 21% +1')
  expect(await lineAt($, 80)).toBe('5h 95% +2')
  const raster = await rowOf($, 80)
  const colors = colorsOf(String(raster?.props.cells), Number(raster?.props.columns))
  expect(colors[3]).toEqual(['9', RED])
  // The hidden ones are calm: "+2" in grey.
  expect(colors[7]).toEqual(['+', 0x949494])
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

test('no white in the bars at rest or while working (white is only a reply\'s new part flashing in)', async ($, on) => {
  const { blits, clock } = world(on, FAST)
  await $.session.start(START)
  await $.ui.mount(at(180))
  await $.turn.start({ text: 'go', turnId: 'turn-1' })
  await clock.advance(3000)
  for (const blit of blits.filter(one => one.key === 'row')) {
    for (const [glyph, color] of colorsOf(blit.cells, blit.cells.length)) {
      if (!/[█▏▎▍▌▋▊▉]/.test(glyph)) continue
      expect(color).not.toBe(0xeeeeee)
    }
  }
})

test('/limits off hides the row, /limits on brings it back, a retired design\'s name explains', async ($, on) => {
  const { store } = world(on, CALM)
  await $.session.start(START)
  expect((await $.command.run(run('off'))).text).toMatch('hidden')
  expect(store.design).toBe('off')
  expect(await (await $.ui.mount(at(180))).findAll({ type: 'Raster' })).toHaveLength(0)
  expect((await $.command.run(run(''))).text).toMatch('/limits on')
  expect((await $.command.run(run('panel'))).text).toMatch('retired')
  expect(store.design).toBe('off')
  expect((await $.command.run(run('on'))).text).toBe('Now showing the footer row.')
  expect(store.design).toBe('lamps')
  expect(await (await $.ui.mount(at(180))).find({ type: 'Raster', key: 'row' })).toBeDefined()
})

test('a saved older design (Panel, LED, off) becomes Lamps once, as picked on 4 Oct', async ($, on) => {
  const { store } = world(on, CALM, { design: 'off', built: 'panel-one-row', cache: 'context', cacheBuilt: 'context-fill' })
  await $.session.start(START)
  expect(store.design).toBe('lamps')
  expect(store.built).toBe('lamps-row')
  expect(await (await $.ui.mount(at(180))).find({ type: 'Raster', key: 'row' })).toBeDefined()
})

test('a window past its reset time reads 0% and "new"', async ($, on) => {
  world(on, [{ kind: 'five_hour', percentUsed: 97, resetsAt: iso(NOW - 60_000) }], {}, {
    five_hour: { utilization: 97, resets_at: iso(NOW - 60_000) },
    model_scoped: null,
  })
  await $.session.start(START)
  expect(await lineAt($, 200)).toMatch(/ {2}5h {11}0% {4}new$/)
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
  expect(await lineAt($, 200)).toBe('ctx           --         5h ██▊      34% 2h 14m  wk █▋       21%  3d 4h  fable ███      38%  3d 4h')
  expect(store[`usage:${ACCOUNT}`]).toBeDefined()
})

test('an account with no Fable week (model_scoped null) gets three gauges: ctx, 5h, wk', async ($, on) => {
  const { clock, store } = world(on, [], {}, {
    five_hour: { utilization: 0, resets_at: iso(NOW + 3 * HOUR) },
    seven_day: { utilization: 44, resets_at: iso(NOW + 4 * HOUR) },
    model_scoped: null,
  })
  await $.session.start(START)
  await $.ui.mount(at(200))
  await clock.advance(6000)
  expect(await lineAt($, 200)).toBe('ctx           --         5h           0%  3h 0m  wk ███▌     44%  4h 0m')
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
  expect(await lineAt($, 200)).toMatch(/fable ███▎ {5}41%/)
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
