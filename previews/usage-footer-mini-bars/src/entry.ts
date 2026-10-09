// What the page runs: the add-on's own drawing code, today's (0.5.0, Lamps) and the new one
// (0.6.0, Mini bars), with the same numbers and the same room rule.
import * as today from '../lamps-0.5.0/hooks/row'
import * as next from '../../../usage-footer/hooks/row'
import type { RowScene } from '../../../usage-footer/hooks/row'
import { SAMPLES, rowScene } from './samples'

const decode = (cells: string) => {
  const bytes = Uint8Array.from(atob(cells), c => c.charCodeAt(0))
  return new Uint32Array(bytes.buffer)
}

export type Cells = { columns: number; words: number[]; step: string; room: number }

// `hint`: the widest hint seen (the left text the room is kept for).
const drawWith = (code: typeof next, scene: RowScene, columns: number, hint: string): Cells => {
  const room = code.roomOf(columns, hint)
  const frame = code.drawRow(scene as never, room)
  return { columns: frame.columns, words: frame.columns === 0 ? [] : [...decode(frame.cells)], step: frame.step, room }
}

// Today's names: the week was "week" before Mini bars.
const todayNames = (scene: RowScene): RowScene => ({
  ...scene,
  limits: { ...scene.limits, gauges: scene.limits.gauges.map(gauge => ({ ...gauge, name: gauge.name.replace(/^wk\b/, 'week') })) },
})

export const drawToday = (scene: RowScene, columns: number, hint = '(shift+tab to cycle)') => drawWith(today as unknown as typeof next, todayNames(scene), columns, hint)
export const drawNew = (scene: RowScene, columns: number, hint = '(shift+tab to cycle)') => drawWith(next, scene, columns, hint)

;(globalThis as unknown as { ROW: unknown }).ROW = { drawToday, drawNew, SAMPLES, rowScene, STEPS: next.STEPS, TODAY_STEPS: today.STEPS }
