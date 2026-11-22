# PromptBar (`prompt-bar`)

A live progress indicator for every prompt, drawn in the Claude Code status line.

```
⠹ working ▕██████░░░░░░▏ 50% · 2/4 Running tests · $ Bash bun test · 3 tools · 47s
⠹ working ▕░░░▒▒▒░░░░░░▏ · ✎ Edit render.js · 5 tools · 12s        ← no task list: no fake %
⠹ working ▕▒▒▒▒▒░░░░░░░▏ ~40% est · ⌕ Grep TODO · 7 tools · 31s     ← labeled estimate
⏸ waiting for you · 1m04s                                           ← permission prompt
✓ done · 14 tools · 1m12s
```

## How progress is measured

| Source | Shown as | When |
|---|---|---|
| Claude's task list (Task tools / `TaskCreated` / `TaskCompleted` hooks, or legacy `TodoWrite`) | `50%` and a solid bar | Claude made a plan |
| Your history (moving average of tools and duration per prompt) | `~40% est`, a hatched bar, capped at 95% | no plan, after 3 or more prompts of history |
| Nothing reliable | phase, an animated pulse, no number | otherwise |

Phases: `thinking` → `working` (tool running, `+N` when calls run in parallel) → `waiting for you` (permission) / `compacting` → `done` or `stopped (API error)`. Subagents show as `⑂N`.

## Token and performance cost

- **0 tokens.** Hooks print nothing, and the status line runs outside the model.
- Tool hooks are `async`, so Claude never waits on them. Each one appends a single JSON line to `$TMPDIR/prompt-bar/<session>.jsonl`. Append-only writes stay safe when tool calls run in parallel.
- On each new prompt the log is rewritten to hold only the current prompt plus any unfinished tasks, so reads stay small.
- The status line reads and folds that log once a second (`refreshInterval: 1`), which takes about 80ms of Bun time. The log is deleted on `SessionEnd`.

## Install

Requires [Bun](https://bun.sh) ≥ 1.1 on your `PATH`. Hooks, the status line and the commands all run with `bun`.

```bash
/plugin marketplace add akr4m/prompt-bar
/plugin install prompt-bar@prompt-bar
/prompt-bar:setup        # adds the statusLine to ~/.claude/settings.json (backup kept)
```

If you already have a status line, it is kept and drawn above the bar. Remove the bar with `/prompt-bar:uninstall`.

## Customize

`/prompt-bar:config style=dots width=16` writes to `~/.claude/prompt-bar/config.json`.

| key | default | |
|---|---|---|
| `style` | `bar` | `bar` · `blocks` · `dots` · `ascii` · `minimal` |
| `width` | `12` | bar cells (4–40) |
| `color` | `true` | also disabled by `NO_COLOR` |
| `showLabel` / `showTools` / `showElapsed` | `true` | |
| `showEstimate` | `true` | `false` = only exact %, never estimates |
| `maxLabel` | `28` | truncate tool targets |

## Develop

```bash
cd prompt-bar && bun test      # no dependencies
bun run demo                   # preview every style
```
