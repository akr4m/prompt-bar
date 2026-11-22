# PromptBar (`prompt-bar`)

Live time estimates for every Claude Code prompt, drawn in the status line: how long Claude has been working, how long the whole prompt should take, and how much time is left.

```
⠹ working ▕██████░░░░░░▏ 47s / ~1m34s · ~47s left · 2/4 Running tests · $ Bash npm test
⠹ working ▕█████▋░░░░░░▏ 47s / ~1m40s · ~53s left · ✎ Edit render.js · 3 tools
⠹ working ▕░░░░░▒▒▒░░░░▏ 2m10s · over est ~1m40s · $ Bash npm run build
⏸ waiting for you ▕████░░░░░░░░▏ 31s / ~1m40s · ~1m09s left
✓ done · 14 tools · 1m12s
```

## How the estimate works

| Source | Used when | Estimated total |
|---|---|---|
| **Task pace** | Claude made a task list and at least one task is done | working time ÷ tasks done × total tasks |
| **History** | otherwise, once you have 3 finished prompts | median of the last 20 prompts in this project (all projects until this one has 3) |
| **None** | neither is available | no number: elapsed time and a moving pulse |

- **Working time only.** Time spent waiting for you (permission prompts, questions) is left out of the estimate and of history. The finished line shows the real clock time.
- **Never a fake number.** Every estimate is marked with `~`. When a prompt runs past its estimate, the countdown stops and the line says `over est`. It doesn't count down to zero or quietly stretch the total.
- **Median, not average.** One 10-minute refactor barely moves the median, but it would drag an average a long way.

## Layouts

Pick one with `/prompt-bar:config layout=<name>`.

| layout | for | example |
|---|---|---|
| `default` | everyday use | `⠹ working ▕██████░░░░░░▏ 47s / ~1m40s · ~53s left · $ Bash npm test · 3 tools` |
| `verbose` | seeing where the estimate came from | `… · ~53s left (task pace) · 2/4 Running tests · …` |
| `compact` | narrow terminals | `⠹ ▕██████░░░░░░▏ 47s / ~1m40s · 2/4 Running tests` |
| `minimal` | the least distraction | `⠹ ~53s left` → `✓ 1m12s` |
| `countdown` | time only, no bar | `⠹ 47s / ~1m40s · ~53s left · 2/4 Running tests` |
| `focus` | no numbers at all | `⠹ working · Running tests · $ Bash npm test` |
| `plain` | basic terminals, logs, screen readers (ASCII, no colour) | `\ working [######------] 47s / ~1m40s - ~53s left` |

A layout is a preset. Any key you set yourself overrides it.

## Install

Requires [Node.js](https://nodejs.org) ≥ 18 on your `PATH`.

```bash
/plugin marketplace add akr4m/prompt-bar
/plugin install prompt-bar@prompt-bar
/prompt-bar:setup        # adds the statusLine to ~/.claude/settings.json (backup kept)
```

If you already have a status line, it is kept and drawn above the bar. Remove the bar with `/prompt-bar:uninstall`.

## Configure

```bash
/prompt-bar:config layout=compact measure=both barStyle=dots
/prompt-bar:config reset          # back to defaults
/prompt-bar:config                # preview every layout
```

Settings are saved to `~/.claude/prompt-bar/config.json`. Each value is checked, and an invalid one is rejected with the list of valid values.

**What to show**

| key | default | values |
|---|---|---|
| `layout` | `default` | `default` · `verbose` · `compact` · `minimal` · `countdown` · `focus` · `plain` |
| `measure` | `time` | `time` (estimates) · `percent` (task-list %) · `both` |
| `estimate` | `auto` | `auto` (task pace, then history) · `tasks` · `history` · `off` |
| `timeStyle` | `full` | `full` (`47s / ~1m40s · ~53s left`) · `remaining` (`~53s left`) |
| `showTotal` / `showRemaining` | `true` | the `/ ~1m40s` and `~53s left` parts |
| `statusText` | `always` | phase word next to the icon: `always` · `paused` (done/waiting only) · `never` |
| `segments` | `status,bar,pct,time,task,tool,agents,tools` | which parts appear, in order. Also available: `source` |

**History**

| key | default | |
|---|---|---|
| `historySize` | `20` | finished prompts kept per project (3–200) |
| `minSamples` | `3` | prompts needed before history is used (1–50) |
| `historyScope` | `project` | `project` · `global` |
| `timeFormat` | `short` | `short` (`1m40s`) · `clock` (`1:40`) |

**Look**

| key | default | |
|---|---|---|
| `barStyle` | `bar` | `bar` · `blocks` · `dots` · `ascii` · `none` |
| `width` | `12` | bar cells (4–40) |
| `color` | `true` | also turned off by `NO_COLOR` |
| `colorThinking` `colorWorking` `colorWaiting` `colorCompacting` `colorDone` `colorError` `colorBar` | cyan, cyan, yellow, magenta, green, red, green | colour names (`black red green yellow blue magenta cyan white gray dim bold none`) or `0`–`255` |
| `icons` | `true` | tool icons (`$ ✎ ⌕ ⇣ ⑂`) |
| `spinner` | `auto` | `auto` · `braille` · `line` · `none` |
| `separator` | ` · ` | text between parts |

**Wording.** `textThinking` `textWorking` `textWaiting` `textCompacting` `textDone` `textError` `textLeft` `textOver` `textEst` `textPace` `textHistory`. Use these for shorter words or another language.

**Behaviour**

| key | default | |
|---|---|---|
| `showLabel` / `showTools` / `showElapsed` / `showTaskCount` | `true` | current tool, tool counter, elapsed time, the `2/4` |
| `maxLabel` | `28` | truncate tool and task names (4–200) |
| `doneLinger` | `-1` | seconds to keep the `✓ done` line; `-1` keeps it until the next prompt |
| `refresh` | `1` | seconds between redraws (1–60); written to `settings.json` |

Names from 0.1 still work: `style` → `barStyle` (`minimal` → `none`), `mode` → `measure`, `showEstimate=false` → `estimate=off`.

## Token and performance cost

- **0 tokens.** The hooks print nothing, and the status line runs outside the model.
- The tool hooks are `async`, so Claude never waits on them. Each one appends one JSON line to `$TMPDIR/prompt-bar/<session>.jsonl`. Append-only writes stay safe when tool calls run in parallel.
- On each new prompt the log is rewritten to hold only the current prompt plus any unfinished tasks, so reads stay small. The log is deleted on `SessionEnd`.
- History is a small file, `~/.claude/prompt-bar/stats.json`: up to `historySize` durations per project, 100 projects at most.

## Develop

```bash
npm test          # node --test, no dependencies
npm run demo      # preview every layout
```
