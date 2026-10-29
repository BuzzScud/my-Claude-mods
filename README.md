# my-Claude-mods

Add-ons ("mods") that change Claude Code's own terminal interface, built on Claude Code's mod API (hooks on `ui.render`, `session.*`, `turn.*`, `command.run`).

## usage-footer (v0.7.0)

One row at the right of the prompt footer: the context window and your usage limits (5-hour, week, and a model's own week such as Fable) as **bar tiles**. Each gauge is a tile whose background fills like a bar, with its name, percent and reset time printed on it.

```
160 cols   ⏵⏵ bypass permissions on · ⇧tab to cycle     [ctx 32%            64k] [5h 79%           1h12m] [wk 24%            4d6h] [fable 0%          4d6h]
120 cols   ⏵⏵ bypass permissions on · ⇧tab to cycle     [ctx 32%     64k] [5h 79%    1h12m] [wk 24%     4d6h] [fable 0%   4d6h]
```

(The brackets stand for the tiles. In the terminal the lit part of a tile is its fill colour with dark words on it, and the rest is a dark track.)

- **Each tile:** the name, the percent (`max` at 100%), and the time until it resets (`1h12m`, `4d6h`, `new` after a reset), or the tokens for the context. The bar is the whole tile, 16 to 24 cells.
- **Colours say how full:** limits are green, yellow from 50%, orange from 75%, and red (blinking) from 90%. The context is blue, then yellow, orange and red as it nears the point where it auto-compacts. The track past that point is dark red.
- **More room:** while the row shows, the hint after the mode's label is shortened. `(shift+tab to cycle)` becomes `⇧tab to cycle`, and `(shift+tab to cycle) · esc to interrupt` becomes `esc to interrupt`. A hint with pills in it (a background shell) is left as the engine draws it, so its pills stay live. The mode's label itself (`⏵⏵ bypass permissions on`) can't be changed by a mod.
- **Always one row.** The row is never wider than the room the left text leaves, so it never wraps under it. It keeps one size whether Claude is working or not. It shrinks while a background shell's pills show and gets its room back after.
- **How it shrinks:** all tiles take the same step at once: 24 → 20 → 16 cells, then each as wide as its words, then the times go. Only after that does a gauge go, the calmest first, with `+n`. At 120 columns in bypass mode all four keep their times.
- **Motion:** a light runs along the fills while Claude works; the last lit cell breathes at rest; a reply's new part flashes in.
- **A model's own week (Fable):** the engine does not hand this to a mod. The add-on asks a second, silent `claude -p` with Claude Code's `get_usage` control request. That costs no tokens and answers in about a second. Every window of the account shares one reading through the mod store, at most 20 asks an hour, and none after 30 quiet minutes.
- `/limits on | off` shows or hides the row.

**Load it:** point Claude Code at the folder in `settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/my-Claude-mods/usage-footer" } }
```

**Check it:**

```sh
claude plugin test usage-footer       # 21 tests
claude plugin validate usage-footer
```

Claude Code writes its mod API types into `usage-footer/.claude-plugin/types/`, which is kept out of this repo. Once they are there, `tsc -p usage-footer/tsconfig.json` type-checks the add-on.

**History:** 0.5.0 *Lamps* (4 Oct 2026, ten or five ▊ lamps per gauge in padded tiles) → 0.6.0 *Mini bars* (9 Oct 2026, made compact so every gauge keeps its meter down to a 120-column window) → 0.7.0 *Bar tiles* (29 Oct 2026, picked over *Long bars* from a side-by-side page: bars too small to read, reset times dropped first, and pace colours showed 79% as green).

## previews/usage-footer-bar-tiles

The design page behind 0.7.0. Open `footer-designs-2026-10-29.html`. It shows today's Mini bars, *A · Long bars* and *B · Bar tiles* (picked) side by side at 120 / 140 / 160 columns, across seven moments: your numbers, while Claude works, calm, near the 5-hour limit, context near auto-compact, used up, and a new session. The rows animate as the footer does. Every row is the add-on's own drawing, cell for cell. The frames are embedded, so the page needs nothing else.

`run/` checks the footer in a real Claude Code with no tmux and no node: `drive.py` runs `claude` in a pty, reads the screen with pyte, and saves each cell's glyph and colours; `render.py` turns that into a PNG. `live-trial-2026-10-29.png` is the trial (today, A and B), and `live-0.7.0-2026-10-29.png` is the shipped row.

```sh
cd previews/usage-footer-bar-tiles/run
python3 -m pip install --target .pylib pyte
PYTHONPATH=.pylib python3 drive.py steps.json captures.json claude --dangerously-skip-permissions
python3 render.py captures.json captures.png
```

## previews/usage-footer-mini-bars

The design preview for 0.6.0, kept as a record: the built page holds the 0.6.0 drawing code. `build.mjs` bundles the add-on's current `row.ts`, so rebuilding it now needs the 0.6.0 one (commit `e12334f`). Open `footer-mini-bars-2026-10-09.html`. Its tabs are: before → after (Lamps vs Mini bars at 120 / 149 / 177), any width with a slider and moments (working, background shell, reply, compaction), captures from a real Claude Code, and how it shrinks.

```sh
bun build.mjs        # bundles the add-on's own drawing code (today's and 0.5.0's from lamps-0.5.0/) into the page
bun src/check.ts     # the page's drawing vs the real captures, cell by cell: glyph, ink, background
node shoot.mjs       # fit checks in WebKit and Chromium (needs Playwright: PLAYWRIGHT_FROM=<a package.json that has it>)
```

`run/` holds the real-terminal harness. `probe.mjs` drives a real Claude Code in a pty with a steps file (`steps-next.mjs`: every width at rest, mid-reply and with a background shell). `run/next-frames.json` keeps only the footer row of each capture. The pty driver comes from the Agentic Coder repo (`PTY_HARNESS`).
