import type { Limit } from '../types'

export type PaceKind = 'ok' | 'fast' | 'early' | 'reached'

export type Pace = {
  kind: PaceKind
  text: string
  /** The same in fewer words, for where room is short. */
  short: string
  /** The share of the window (0 to 1) at which the limit is used up at this speed. */
  runsOutAt?: number
  /** How long until it is used up at this speed, in ms; set when it runs out before it resets. */
  leftMs?: number
}

/** One limit, worked out for a moment: what every design draws from. */
export type Gauge = {
  kind: string
  name: string
  /** The real percentage used, 0 once the reset time has passed. */
  used: number
  /** The share of the window that is gone, 0 to 1; absent when unknown. */
  time?: number
  resets?: string
  /** How long until it starts over, in ms; absent when unknown or past. */
  resetsIn?: number
  pace?: Pace
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const MIN_SHARE = 0.1

export const nameOf = ({ kind, label }: Limit) => {
  if (label !== undefined) return label
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return 'week'
  if (kind.startsWith('seven_day_')) return `week ${kind.slice(10)}`

  return kind.replace(/_/g, ' ')
}

const spanOf = (kind: string) => {
  if (kind.startsWith('five_hour')) return 5 * HOUR
  if (kind.startsWith('seven_day')) return 7 * DAY

  return undefined
}

const resetOf = (limit: Limit) => {
  const at = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)

  return Number.isNaN(at) ? undefined : at
}

// A window whose reset time has passed is empty until the next reply.
export const usedOf = (limit: Limit, now: number) => {
  const resets = resetOf(limit)

  return resets !== undefined && now >= resets ? 0 : limit.percentUsed
}

export const percent = (used: number) =>
  `${used >= 100 ? Math.round(used) : Math.min(99, Math.round(used))}%`

export const span = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return 'under 1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`

  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

// A time in six columns at most, for the footer: "<1m", "38m", "3h 7m", "13h", "6d 14h".
export const clockText = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 10) return `${hours}h ${minutes % 60}m`
  if (hours < 24) return `${hours}h`

  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export const resetText = (limit: Limit, now: number) => {
  const resets = resetOf(limit)
  if (resets === undefined) return undefined

  return now >= resets ? 'new window' : `resets in ${span(resets - now)}`
}

const timeOf = (limit: Limit, now: number) => {
  const length = spanOf(limit.kind)
  const resets = resetOf(limit)
  if (length === undefined || resets === undefined || now >= resets) {
    return undefined
  }

  return Math.min(1, Math.max(0, (now - (resets - length)) / length))
}

export const paceOf = (limit: Limit, now: number): Pace | undefined => {
  const used = usedOf(limit, now)
  if (used >= 100) return { kind: 'reached', text: 'limit reached', short: 'used up' }
  const length = spanOf(limit.kind)
  const time = timeOf(limit, now)
  if (length === undefined || time === undefined) return undefined
  if (used <= 0) return { kind: 'ok', text: 'OK at this speed', short: 'OK' }
  if (time < MIN_SHARE) return { kind: 'early', text: 'too early to say', short: 'too early' }
  // A straight line from the start of the window through now.
  const runsOutAt = (time * 100) / used

  const leftMs = (runsOutAt - time) * length
  const left = span(leftMs)

  return runsOutAt >= 1
    ? { kind: 'ok', text: 'OK at this speed', short: 'OK' }
    : { kind: 'fast', text: `runs out in ${left} at this speed`, short: `runs out in ${left}`, runsOutAt, leftMs }
}

export const gaugeOf = (limit: Limit, now: number): Gauge => {
  const time = timeOf(limit, now)
  const resets = resetText(limit, now)
  const at = resetOf(limit)
  const pace = paceOf(limit, now)

  return {
    kind: limit.kind,
    name: nameOf(limit),
    used: usedOf(limit, now),
    ...(time === undefined ? {} : { time }),
    ...(resets === undefined ? {} : { resets }),
    ...(at === undefined || now >= at ? {} : { resetsIn: at - now }),
    ...(pace === undefined ? {} : { pace }),
  }
}
