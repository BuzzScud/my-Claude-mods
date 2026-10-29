/** One limit as read. `label` names a limit the engine has no name for (a model's own weekly limit: "fable"). */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string; label?: string }

export type Reading = { limits: Limit[] }

declare module 'claude-code' {
  interface PluginState {
    'usage-footer': {
      reading: Reading
      /** "tiles" or "off"; an older design's name (lamps, panel, led…) or a number reads as "tiles". */
      design: string | number
      now: number
      /** The usage answer from Claude Code's own usage request: a model's own week (Fable), and the 5 hours and week until the engine has its own. */
      scoped: Limit[]
    }
  }
}
