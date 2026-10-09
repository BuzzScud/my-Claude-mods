// The numbers the previews draw: your screenshot's reading, and labelled examples.
import type { Limit } from '../../../usage-footer/types'
import { gaugeOf } from '../../../usage-footer/hooks/limits'
import type { Mood, Scene } from '../../../usage-footer/hooks/art'
import type { ContextScene, RowScene } from '../../../usage-footer/hooks/row'

export type Sample = { id: string; title: string; isReal: boolean; now: number; limits: Limit[]; context: { tokens: number; window: number; threshold?: number; before?: number } }

// Your screenshot, 9 Oct 11:04 ET: ctx 46%, 5h 7%, week 95%, fable 71%. The reset times are
// the add-on's own reading from the store that morning; the context's token count is not in
// the screenshot (46% of a 1M window is assumed).
const SHOT = Date.parse('2026-10-09T15:04:00Z')
const H = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()

export const SAMPLES: Sample[] = [
  {
    id: 'shot', title: 'Your screenshot, 9 Oct 11:04', isReal: true, now: SHOT,
    limits: [
      { kind: 'five_hour', percentUsed: 7, resetsAt: '2026-10-09T17:50:00Z' },
      { kind: 'seven_day', percentUsed: 95, resetsAt: '2026-10-10T10:00:00Z' },
      { kind: 'seven_day_fable', percentUsed: 71, label: 'fable', resetsAt: '2026-10-10T10:00:00Z' },
    ],
    context: { tokens: 460_000, window: 1_000_000 },
  },
  {
    id: 'busy', title: 'Example: a busy afternoon', isReal: false, now: SHOT,
    limits: [
      { kind: 'five_hour', percentUsed: 71, resetsAt: iso(SHOT + 2.2 * H) },
      { kind: 'seven_day', percentUsed: 58, resetsAt: iso(SHOT + 70 * H) },
      { kind: 'seven_day_fable', percentUsed: 64, label: 'fable', resetsAt: iso(SHOT + 70 * H) },
    ],
    context: { tokens: 612_000, window: 1_000_000, threshold: 967_000 },
  },
  {
    id: 'edge', title: 'Example: near the edges', isReal: false, now: SHOT,
    limits: [
      { kind: 'five_hour', percentUsed: 100, resetsAt: iso(SHOT + 1.1 * H) },
      { kind: 'seven_day', percentUsed: 81, resetsAt: iso(SHOT + 30 * H) },
      { kind: 'seven_day_fable', percentUsed: 88, label: 'fable', resetsAt: iso(SHOT + 30 * H) },
    ],
    context: { tokens: 905_000, window: 1_000_000, threshold: 967_000 },
  },
  {
    id: 'main', title: 'Example: your main account (no model week)', isReal: false, now: SHOT,
    limits: [
      { kind: 'five_hour', percentUsed: 12, resetsAt: iso(SHOT + 3.4 * H) },
      { kind: 'seven_day', percentUsed: 44, resetsAt: iso(SHOT + 90 * H) },
    ],
    context: { tokens: 98_000, window: 200_000, threshold: 167_000 },
  },
]

export const rowScene = (sample: Sample, mood: Mood, tick: number, extra: Partial<ContextScene> = {}): RowScene => {
  const gauges = sample.limits.map(limit => gaugeOf(limit, sample.now)).map(gauge => ({ ...gauge, shown: gauge.used }))
  const { tokens, window, threshold } = sample.context
  const limits: Scene = { gauges, mood, tick }
  const context: ContextScene = {
    reading: { tokens, window, ...(threshold === undefined ? {} : { threshold }) },
    shown: tokens,
    before: sample.context.before ?? tokens,
    since: 1_000_000,
    ...extra,
  }

  return { limits, context }
}
