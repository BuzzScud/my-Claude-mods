# my-Claude-mods

Add-ons ("mods") that change Claude Code's own terminal interface, built on Claude Code's mod API (hooks on `ui.render`, `session.*`, `turn.*`, `command.run`).

## usage-footer (v0.6.0)

One row at the right of the prompt footer: the context window and your usage limits (5-hour, week, and a model's own week such as Fable) as **mini bars**, shrinking together as the window narrows.

```
177 cols   ctx █▍       17%  34.1k  5h ▊         9% 2h 31m  wk ███████▋ 95%    18h  fable █████▋   71%    18h
149 cols   ctx ▍  17%  34.1k  5h ▏   9% 2h 31m  wk █▉ 95%    18h  fable █▍ 71%    18h
120 cols   ctx ▍  17%  5h ▏   9%  wk █▉ 95%  fable █▍ 71%
```

- **Each gauge:** its name, a bar cut to the eighth of a cell (▏▎▍▌▋▊▉█), a 3-column percent (`max` at 100%), and the time until it resets (tokens for the context) when there is room.
- **Colours:** ctx is blue, limits are green, yellow when used faster than the clock, red at 90% or more. On the bar's track, grey is time gone that was not used, dark is time still to come, and dark red is past the point where the context auto-compacts.
- **Always one row.** The row is never wider than the room Claude Code's left text leaves, so it never wraps under it. It keeps the same size whether Claude is working or not.
- **How it shrinks:** all gauges take the same step at once. Bars go 8 → 4 → 2 cells, then the times go, then the bars (98 / 82 / 74 / 46 / 34 columns for four gauges). Only after that does a gauge go, the calmest first, with `+n`. At 120 columns in bypass mode all four keep their bars, even with a background shell running.
- **Motion:** a light runs along the bars while Claude works; the last cell breathes at rest; a reply's new part flashes in.
- **A model's own week (Fable):** the engine does not hand this to a mod. The add-on asks a second, silent `claude -p` with Claude Code's `get_usage` control request. That costs no tokens and answers in about a second. Every window of the account shares one reading through the mod store, at most 20 asks an hour, and none after 30 quiet minutes.
- `/limits on | off` shows or hides the row.

**Load it:** point Claude Code at the folder in `settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/my-Claude-mods/usage-footer" } }
```

**Check it:**

```sh
claude plugin test usage-footer       # 20 tests
claude plugin validate usage-footer
```

Claude Code writes its mod API types into `usage-footer/.claude-plugin/types/`, which is kept out of this repo. Once they are there, `tsc -p usage-footer/tsconfig.json` type-checks the add-on.

**History:** 0.5.0 *Lamps* (4 Oct 2026, ten or five ▊ lamps per gauge in padded tiles) → 0.6.0 *Mini bars* (9 Oct 2026, made compact so every gauge keeps its meter down to a 120-column window).

## previews/usage-footer-mini-bars

The design preview for 0.6.0. Open `footer-mini-bars-2026-10-09.html`. Its tabs are: before → after (Lamps vs Mini bars at 120 / 149 / 177), any width with a slider and moments (working, background shell, reply, compaction), captures from a real Claude Code, and how it shrinks.

```sh
bun build.mjs        # bundles the add-on's own drawing code (today's and 0.5.0's from lamps-0.5.0/) into the page
bun src/check.ts     # the page's drawing vs the real captures, cell by cell: glyph, ink, background
node shoot.mjs       # fit checks in WebKit and Chromium (needs Playwright: PLAYWRIGHT_FROM=<a package.json that has it>)
```

`run/` holds the real-terminal harness. `probe.mjs` drives a real Claude Code in a pty with a steps file (`steps-next.mjs`: every width at rest, mid-reply and with a background shell). `run/next-frames.json` keeps only the footer row of each capture. The pty driver comes from the Agentic Coder repo (`PTY_HARNESS`).
