<div align="center">

# PromptBar

**Live time estimates for every Claude Code prompt, right in the status line.**

How long Claude has been working · how long the prompt should take · how much time is left

`v0.3.1` · `AI-assisted or 0 tokens` · `uses your Claude Code login` · `no dependencies` · `Node ≥ 18` · `MIT`

</div>

```text
⠧ working ▕████████░░░░▏ 47s / ~1m10s · ~24s left · 2/4 Running tests · $ Bash npm test · 1 tool
```

---

## Contents

1. [Features](#features)
2. [Quick start](#quick-start)
3. [One prompt, start to finish](#one-prompt-start-to-finish)
4. [Reading the line](#reading-the-line)
5. [Estimators: AI or token-free](#estimators-ai-or-token-free)
6. [How the estimate works](#how-the-estimate-works)
7. [Layouts](#layouts)
8. [Bar styles and measures](#bar-styles-and-measures)
9. [Commands](#commands)
10. [Configuration](#configuration)
11. [Configuration reference](#configuration-reference)
12. [Recipes](#recipes)
13. [Edge cases](#edge-cases)
14. [How it works](#how-it-works)
15. [Files and environment variables](#files-and-environment-variables)
16. [Privacy and cost](#privacy-and-cost)
17. [Troubleshooting](#troubleshooting)
18. [FAQ](#faq)
19. [Uninstall](#uninstall)
20. [Development](#development)
21. [Changelog](#changelog)
22. [License](#license)

---

## Features

- **Time, not just progress.** Elapsed working time, an estimated total and the time left, updated every second.
- **Two estimators.** `ai` (default) reads your prompt with a quick model call on your own Claude Code plan. `free` uses 0 tokens.
- **It learns from you.** Claude's task pace, your per-project history and a correction for how far off the AI usually is for you.
- **Honest numbers.** Every estimate is marked `~`. When nothing reliable is known, the line shows no number.
- **Handles real sessions.** Messages you send mid-prompt, Esc, permission prompts, compaction, API errors and other plugins' Stop hooks.
- **7 layouts, about 50 settings.** Every value is checked, and the old setting names keep working.
- **Lightweight.** No dependencies. The hooks never block Claude and print nothing into the conversation.

## Quick start

**Requirements:** [Claude Code](https://docs.claude.com/en/docs/claude-code) and [Node.js](https://nodejs.org) 18 or newer on your `PATH`. The AI estimator also uses the `claude` command, which you already have if you run Claude Code in a terminal.

```bash
/plugin marketplace add akr4m/prompt-bar
/plugin install prompt-bar@prompt-bar
/prompt-bar:setup
```

Restart Claude Code (or run `/reload-plugins`). The bar appears from your next prompt.

To stay at 0 tokens from the start:

```bash
/prompt-bar:config estimator=free
```

## One prompt, start to finish

Here is one prompt as it runs, with the default settings. The clock on the left is the real time; the line is what the status line shows.

```text
 0:01 │ ⠙ thinking ▕▏░░░░░░░░░░░▏ 1s / ~1m22s · ~1m22s left
 0:03 │ ⠸ thinking ▕▏░░░░░░░░░░░▏ 3s / ~2m30s · ~2m27s left
 0:12 │ ⠹ working ▕▉░░░░░░░░░░░▏ 12s / ~2m30s · ~2m18s left · 0/4 Reading the code · ⌕ Read render.js
 0:31 │ ⠙ working ▕███▊░░░░░░░░▏ 31s / ~1m36s · ~1m05s left · 1/4 Writing the parser · ✎ Edit parser.js · 1 tool
 1:10 │ ⏸ waiting for you ▕█████░░░░░░░▏ 40s / ~1m36s · ~56s left · 1/4 Writing the parser · 1 tool
 1:58 │ ⠇ working ▕████████░░░░▏ 58s / ~1m27s · ~29s left · 2/4 Running tests · $ Bash npm test · 2 tools
 2:10 │ ⠋ working ▕████████░░░░▏ 1m10s / ~1m45s · ~35s left · 2/4 Running tests · $ Bash npm test · 2 tools
 2:35 │ ⠴ working ▕██████████▌░▏ 1m35s / ~1m48s · ~13s left · 3/4 Updating docs · ✎ Edit README.md · 3 tools
 2:52 │ ✓ done · 4 tools · 2m52s
```

| Time | What happened |
|---|---|
| **0:01** | The AI estimate is on its way, so your history fills in for a moment. |
| **0:03** | The AI has read the prompt and estimates 2m30s of work. |
| **0:31** | Claude has finished 1 of 4 tasks. Its real pace (24s per task) is better evidence than any guess, so the estimate switches to it. |
| **1:10** | Claude is waiting for your permission. The working clock pauses at 40s. |
| **1:58** | The minute you spent answering doesn't count: 58s worked, not 1m58s. |
| **2:10** | You sent a message while Claude was working. It's the same prompt, so the timer carries on. The current task is running slow, so the time left goes up a little. |
| **2:52** | The finished line shows the real clock time. |

## Reading the line

```text
  ⠹ working ▕████████░░░░▏ 47s / ~1m10s · ~24s left · 2/4 Running tests · $ Bash npm test · 3 tools
  ┬ ───┬─── ──────┬─────── ─┬─ ───┬────   ────┬────   ────────┬────────   ───────┬───────   ───┬───
  │    │          │         │     │           │               │                  │             │
  │    │          │         │     │           │               │                  │             └ tools finished
  │    │          │         │     │           │               │                  └ tool running now
  │    │          │         │     │           │               └ current task (2 of 4 done)
  │    │          │         │     │           └ time left
  │    │          │         │     └ estimated total (~ = estimate)
  │    │          │         └ working time so far
  │    │          └ share of the estimated time used
  │    └ phase: thinking · working · waiting for you · compacting · done · interrupted
  └ spinner (moves once a second)
```

Every phase:

```text
⠧ thinking ▕███▊░░░░░░░░▏ 47s / ~2m30s · ~1m43s left
⠧ working ▕███▊░░░░░░░░▏ 47s / ~2m30s · ~1m43s left · ✎ Edit state.js · 1 tool 1 failed
⠧ working ▕███▊░░░░░░░░▏ 47s / ~2m30s · ~1m43s left · ⑂ Agent Explore +2 · ⑂1 · 2 tools
⏸ waiting for you ▕██▍░░░░░░░░░▏ 31s / ~2m30s · ~1m59s left
⠧ compacting ▕███▊░░░░░░░░▏ 47s / ~2m30s · ~1m43s left
⠧ working ▕░░░░░░░░▒▒▒░▏ 4m20s · $ Bash npm run build
✓ done · 14 tools · 1m12s
⊘ interrupted · 22s
✗ stopped (API error) · 20s
```

| Symbol | Meaning |
|---|---|
| `▕████░░░░▏` | share of the estimated time used |
| `▕░░▒▒▒░░░▏` | moving pulse: working, but no reliable estimate yet. It never stands for an amount |
| `~` | an estimate, not a measurement |
| `+2` | two more tools running in parallel |
| `⑂1` | one subagent running |
| `$ ✎ ⌕ ⇣ ⑂` | the running tool: shell, edit, read/search, web, agent |

## Estimators: AI or token-free

PromptBar has two estimators. **`ai` is the default.** Switch with `/prompt-bar:config estimator=free` and back with `estimator=ai`.

|  | `estimator=ai` (default) | `estimator=free` |
|---|---|---|
| **How it knows** | A quick model call reads your prompt, so "fix a typo" and "refactor auth" get different estimates. Task pace and history take over as evidence builds up | Task pace and your history only |
| **First estimate** | About 2–4s after you send the prompt | Once there's a task pace or enough history |
| **Cost** | About 800 tokens per call on **your existing Claude Code plan**: same login, no API key, nothing to set up. Usually 1 call per prompt, 3 at most | 0 tokens |
| **What it sends** | Your prompt (first 2,000 characters), messages you add mid-prompt, the folder name, task titles, time and tool counts so far. **Never file contents** | Nothing |

Two real prompts, a few seconds in:

```text
fix the typo in the README title          ⠏ thinking ▕█▌░░░░░░░░░░▏ 3s / ~25s · ~22s left (ai)
refactor the estimate module, add tests…  ⠸ thinking ▕░░░░░░░░░░░░▏ 4s / ~15m00s · ~14m56s left (ai)
```

- **Your own login.** PromptBar runs `claude -p`, the Claude Code you already have, with no settings loaded: no plugins, hooks, skills or MCP servers. The call has no tools and saves no session. It runs in the background, so Claude never waits on it.
- **Corrected by your own prompts.** Each finished prompt records how far off the AI's first guess was. From 3 prompts on, new answers are scaled by the median of those ratios: if the AI usually guesses half the real time for you, its next answer is doubled.
- **Asked again only when needed.** It's asked at the start, when a prompt passes the estimate, and when you add a message mid-prompt, but never while task pace is measuring the work.
- **Never breaks the bar.** If a call fails (offline, logged out, usage limit), the line quietly uses the free estimate. Login and usage-limit errors pause AI calls for 15 minutes.

## How the estimate works

Every second, PromptBar works the estimate out again from what has happened so far, taking the first source that applies:

```text
                 ┌───────────────────────────────┐
  every second ─▶│ Has Claude finished ≥ 1 task  │── yes ──▶ TASK PACE
                 │ of its task list in THIS      │           pace = time per finished task
                 │ prompt?                       │           left = rest of current task + pace × tasks after it
                 └───────────────┬───────────────┘
                                 │ no
                                 ▼
                 ┌───────────────────────────────┐
                 │ estimator=ai, and the AI has  │── yes ──▶ AI
                 │ answered, and its estimate    │           its answer, calibrated to you
                 │ isn't passed yet?             │           (once passed, it's asked again: max 3 per prompt)
                 └───────────────┬───────────────┘
                                 │ no
                                 ▼
                 ┌───────────────────────────────┐
                 │ ≥ 3 past prompts that ran     │── yes ──▶ HISTORY
                 │ LONGER than this one so far?  │           median of those prompts
                 └───────────────┬───────────────┘
                                 │ no
                                 ▼
                            NO ESTIMATE
                            elapsed time and a pulse, no number
```

**History updates as the prompt runs.** Quick replies ("yes", "thanks") are prompts too, but once a prompt outlasts them they stop counting. This is what `estimator=free` shows, or `ai` before the AI answers:

```text
 past prompts in this project:  4s  6s  9s  1m10s  1m35s  1m50s  2m30s  4m00s

   5s   ⠴ working ▕▋░░░░░░░░░░░▏ 5s / ~1m35s · ~1m30s left       ← 4s is left out
  50s   ⠋ working ▕█████▍░░░░░░▏ 50s / ~1m50s · ~1m00s left      ← 4s, 6s and 9s are left out
 1m40s  ⠋ working ▕████████░░░░▏ 1m40s / ~2m30s · ~50s left     ← only longer prompts count
 2m40s  ⠋ working ▕░░▒▒▒░░░░░░░▏ 2m40s                          ← only 4m00s is longer: no guess
```

**Task pace counts only this prompt's work.** Tasks carried over from an earlier prompt don't make the pace look faster. When the current task runs slow, the estimate grows with it, so the time left never stalls at `~0s`:

```text
 tasks 1 and 2 finished at 20s and 40s  →  pace 20s per task, 4 tasks in total

   50s  … 50s / ~1m20s · ~30s left · 2/4       current task 10s in: ~10s more, then 1 task (20s)
 1m40s  … 1m40s / ~2m30s · ~50s left · 2/4     current task 60s in, slow: ~30s more, then 1 task
```

| Rule | Why |
|---|---|
| **Working time only.** Time waiting for you (permission prompts, questions, plan approval) is left out. | How fast you reply has nothing to do with how long the work takes. |
| **One prompt is one prompt.** A message you send while Claude is working continues the same prompt. | Otherwise every message would restart the timer and save a fragment to history. |
| **Median, not average.** | One 10-minute refactor barely moves the median, but it would drag an average a long way. |
| **Per project.** It falls back to all projects until a project has enough prompts. | A small repo and a big monorepo have very different typical prompts. |
| **Never a fake number.** Estimates carry `~`, and with no honest estimate the line shows no number. | A countdown stuck at `0s`, or a total quietly stretched, would mean nothing. |

## Layouts

A layout is a preset of other settings. Choose one with `/prompt-bar:config layout=<name>`; any setting you set yourself still overrides it. Each block shows the same six moments: task pace, AI estimate, a very long prompt, waiting, interrupted, done.

**`default`**, for everyday use

```text
⠧ working ▕████████░░░░▏ 47s / ~1m10s · ~24s left · 2/4 Running tests · $ Bash npm test · 1 tool
⠧ working ▕███▊░░░░░░░░▏ 47s / ~2m30s · ~1m43s left · ✎ Edit checkout.tsx · 1 tool
⠧ working ▕░░░░░░░░▒▒▒░▏ 4m20s · $ Bash npm run build
⏸ waiting for you ▕██▍░░░░░░░░░▏ 31s / ~2m30s · ~1m59s left
⊘ interrupted · 22s
✓ done · 14 tools · 1m12s
```

**`verbose`**, which also shows where the estimate came from

```text
⠧ working ▕████████░░░░▏ 47s / ~1m10s · ~24s left (task pace) · 2/4 Running tests · $ Bash npm test · 1 tool
⠧ working ▕███▊░░░░░░░░▏ 47s / ~2m30s · ~1m43s left (ai) · ✎ Edit checkout.tsx · 1 tool
⠧ working ▕░░░░░░░░▒▒▒░▏ 4m20s · $ Bash npm run build
⏸ waiting for you ▕██▍░░░░░░░░░▏ 31s / ~2m30s · ~1m59s left (ai)
⊘ interrupted · 22s
✓ done · 14 tools · 1m12s
```

**`compact`**, for narrow terminals

```text
⠧ ▕████████░░░░▏ 47s / ~1m10s · 2/4 Running tests
⠧ ▕███▊░░░░░░░░▏ 47s / ~2m30s
⠧ ▕░░░░░░░░▒▒▒░▏ 4m20s
⏸ waiting for you ▕██▍░░░░░░░░░▏ 31s / ~2m30s
⊘ interrupted · 22s
✓ done · 1m12s
```

**`minimal`**, the least distraction

```text
⠧ ~24s left
⠧ ~1m43s left
⠧ 4m20s
⏸ ~1m59s left
⊘ 22s
✓ 1m12s
```

**`countdown`**, time first, with no bar

```text
⠧ 47s / ~1m10s · ~24s left · 2/4 Running tests
⠧ 47s / ~2m30s · ~1m43s left
⠧ 4m20s
⏸ 31s / ~2m30s · ~1m59s left
⊘ 22s
✓ 1m12s
```

**`focus`**, with no numbers at all

```text
⠧ working · Running tests · $ Bash npm test
⠧ working · ✎ Edit checkout.tsx
⠧ working · $ Bash npm run build
⏸ waiting for you
⊘ interrupted
✓ done
```

**`plain`**, ASCII only and no colour, for basic terminals, logs and screen readers

```text
\ working [########----] 47s / ~1m10s - ~24s left - 2/4 Running tests - Bash npm test - 1 tool
\ working [###---------] 47s / ~2m30s - ~1m43s left - Edit checkout.tsx - 1 tool
\ working [--------===-] 4m20s - Bash npm run build
|| waiting for you [##----------] 31s / ~2m30s - ~1m59s left
-- interrupted - 22s
OK done - 14 tools - 1m12s
```

What each layout sets. Anything not listed keeps its default:

| layout | settings it applies |
|---|---|
| `default` | nothing (all defaults) |
| `verbose` | `segments=status,bar,pct,time,source,task,tool,agents,tools` · `maxLabel=36` |
| `compact` | `segments=status,bar,pct,time,task` · `showRemaining=false` · `statusText=paused` · `maxLabel=20` |
| `minimal` | `segments=status,pct,time` · `timeStyle=remaining` · `statusText=never` |
| `countdown` | `segments=status,time,task` · `statusText=never` |
| `focus` | `segments=status,task,tool` · `showTaskCount=false` |
| `plain` | `barStyle=ascii` · `spinner=line` · `icons=false` · `color=false` · `separator=" - "` |

Run `/prompt-bar:config` with no arguments to preview every layout in your own terminal.

## Bar styles and measures

**`barStyle`** changes how the bar is drawn:

```text
bar     ⠧ working ▕███▊░░░░░░░░▏ 47s / ~2m30s · ~1m43s left
blocks  ⠧ working ■■■□□□□□□□□□ 47s / ~2m30s · ~1m43s left
dots    ⠧ working ●●●○○○○○○○○○ 47s / ~2m30s · ~1m43s left
ascii   \ working [###---------] 47s / ~2m30s · ~1m43s left
none    ⠧ working 47s / ~2m30s · ~1m43s left
```

**`measure`** decides what the bar and the numbers measure:

```text
time     ⠧ working ▕████████░░░░▏ 47s / ~1m10s · ~24s left · 2/4 Running tests     (default)
percent  ⠧ working ▕██████░░░░░░▏ 50% · 2/4 Running tests · 47s
both     ⠧ working ▕██████░░░░░░▏ 50% · 47s / ~1m10s · ~24s left · 2/4 Running tests
```

With `percent` and no task list, the percentage comes from the AI or history estimate. It's drawn hatched and labelled: `▕▒▒▒▒▒░░░░░░░▏ ~43% est`.

## Commands

| command | what it does |
|---|---|
| `/prompt-bar:setup` | Puts PromptBar in your status line (`~/.claude/settings.json`) and keeps a backup as `settings.json.prompt-bar.bak`. An existing status line is kept and drawn above the bar |
| `/prompt-bar:config` | With no arguments: shows your current settings and previews every layout |
| `/prompt-bar:config key=value …` | Changes one or more settings. Each value is checked; an invalid one is rejected with the valid choices |
| `/prompt-bar:config reset` | Restores every setting to its default |
| `/prompt-bar:uninstall` | Takes PromptBar out of the status line and restores the one you had before |

## Configuration

There are three ways to configure PromptBar. They apply in this order, and each overrides the one before:

```text
built-in defaults  ─▶  layout preset  ─▶  your settings  ─▶  environment variables
                       (layout=…)         (config.json)       (NO_COLOR, PROMPT_BAR_STYLE)
```

**1. With the command** (recommended): values are checked as you type them.

```bash
/prompt-bar:config estimator=free layout=compact barStyle=dots
/prompt-bar:config "textWaiting=your turn" colorBar=214
/prompt-bar:config reset
```

```text
> /prompt-bar:config layout=compac width=abc
invalid layout="compac": must be one of default | verbose | compact | minimal | countdown | focus | plain
invalid width="abc": must be a whole number from 4 to 40
```

Wrap a value in quotes when it contains spaces. Values `true`/`false` become true and false, and whole numbers become numbers.

**2. By editing `~/.claude/prompt-bar/config.json`.** Only include the settings you want to change:

```json
{
  "estimator": "free",
  "layout": "compact",
  "barStyle": "dots",
  "width": 16,
  "colorBar": 214
}
```

An invalid value in the file is ignored and its default is used, so a typo never breaks the bar.

**3. With environment variables**, for one terminal or for scripts: see [Files and environment variables](#files-and-environment-variables).

### Full default configuration

This is every setting with its default value. You never need to copy it all; set only what you change.

```json
{
  "estimator": "ai",
  "aiModel": "haiku",
  "aiMaxCalls": 3,
  "estimate": "auto",

  "layout": "default",
  "measure": "time",
  "timeStyle": "full",
  "showTotal": true,
  "showRemaining": true,
  "statusText": "always",
  "segments": "status,bar,pct,time,task,tool,agents,tools",

  "historySize": 50,
  "minSamples": 3,
  "historyScope": "project",
  "timeFormat": "short",

  "barStyle": "bar",
  "width": 12,
  "color": true,
  "colorThinking": "cyan",
  "colorWorking": "cyan",
  "colorWaiting": "yellow",
  "colorCompacting": "magenta",
  "colorDone": "green",
  "colorError": "red",
  "colorInterrupted": "yellow",
  "colorBar": "green",
  "icons": true,
  "spinner": "auto",
  "separator": " · ",

  "textThinking": "thinking",
  "textWorking": "working",
  "textWaiting": "waiting for you",
  "textCompacting": "compacting",
  "textDone": "done",
  "textInterrupted": "interrupted",
  "textError": "stopped (API error)",
  "textLeft": "left",
  "textEst": "est",
  "textPace": "task pace",
  "textAi": "ai",
  "textHistory": "history",

  "showLabel": true,
  "showTools": true,
  "showElapsed": true,
  "showTaskCount": true,
  "maxLabel": 28,
  "doneLinger": -1,
  "refresh": 1
}
```

## Configuration reference

### Estimator

| key | type | default | values | what it does |
|---|---|---|---|---|
| `estimator` | choice | `ai` | `ai` · `free` | `ai` adds a quick AI estimate on your Claude Code plan (about 800 tokens a call). `free` uses 0 tokens |
| `aiModel` | text | `haiku` | a model alias or id, e.g. `haiku`, `sonnet`, `claude-haiku-5-5` | the model used for the AI estimate. Larger models use more of your plan per call |
| `aiMaxCalls` | number | `3` | `1`–`10` | the most AI calls made for one prompt (the first one plus re-asks) |
| `estimate` | choice | `auto` | `auto` · `tasks` · `history` · `off` | which sources to use. `auto`: task pace, then AI, then history. `tasks`/`history`: only that source. `off`: no estimates, elapsed time only |

### What to show

| key | type | default | values | what it does |
|---|---|---|---|---|
| `layout` | choice | `default` | `default` · `verbose` · `compact` · `minimal` · `countdown` · `focus` · `plain` | a preset of other settings (see [Layouts](#layouts)) |
| `measure` | choice | `time` | `time` · `percent` · `both` | what the bar and numbers measure |
| `timeStyle` | choice | `full` | `full` · `remaining` | `full`: `47s / ~1m40s · ~53s left`. `remaining`: `~53s left` only |
| `showTotal` | true/false | `true` | | show the `/ ~1m40s` part |
| `showRemaining` | true/false | `true` | | show the `~53s left` part |
| `statusText` | choice | `always` | `always` · `paused` · `never` | the phase word next to the icon. `paused`: only when done, waiting, compacting or interrupted |
| `segments` | list | `status,bar,pct,time,task,tool,agents,tools` | any of the segments below, comma-separated, in the order you want | which parts appear, and in what order |

Segments:

| segment | shows | example |
|---|---|---|
| `status` | spinner or icon, and the phase word | `⠹ working` |
| `bar` | the bar | `▕████░░░░▏` |
| `pct` | percentage, with `measure=percent` or `both` | `50%` · `~43% est` |
| `time` | elapsed, estimated total, time left | `47s / ~1m40s · ~53s left` |
| `source` | where the estimate came from (in `verbose`) | `(task pace)` · `(ai)` · `(history)` |
| `task` | task-list progress and the current task | `2/4 Running tests` |
| `tool` | the tool running now | `$ Bash npm test` |
| `agents` | subagents running | `⑂1` |
| `tools` | tools finished, and failures | `3 tools 1 failed` |

### History

| key | type | default | values | what it does |
|---|---|---|---|---|
| `historySize` | number | `50` | `3`–`200` | finished prompts remembered per project |
| `minSamples` | number | `3` | `1`–`50` | prompts needed before history or AI calibration is used |
| `historyScope` | choice | `project` | `project` · `global` | `project`: this folder's prompts first, then all. `global`: all projects together |
| `timeFormat` | choice | `short` | `short` · `clock` | `short`: `1m40s`. `clock`: `1:40` |

### Look

| key | type | default | values | what it does |
|---|---|---|---|---|
| `barStyle` | choice | `bar` | `bar` · `blocks` · `dots` · `ascii` · `none` | how the bar is drawn; `none` hides it |
| `width` | number | `12` | `4`–`40` | bar length in characters |
| `color` | true/false | `true` | | colours on or off. Also turned off by `NO_COLOR` |
| `colorThinking` | colour | `cyan` | colour name or `0`–`255` | phase colour while thinking |
| `colorWorking` | colour | `cyan` | 〃 | while a tool runs |
| `colorWaiting` | colour | `yellow` | 〃 | while waiting for you |
| `colorCompacting` | colour | `magenta` | 〃 | while compacting |
| `colorDone` | colour | `green` | 〃 | when done |
| `colorError` | colour | `red` | 〃 | on an API error, and the failed-tools count |
| `colorInterrupted` | colour | `yellow` | 〃 | after Esc |
| `colorBar` | colour | `green` | 〃 | the filled part of the bar |
| `icons` | true/false | `true` | | tool icons `$ ✎ ⌕ ⇣ ⑂` |
| `spinner` | choice | `auto` | `auto` · `braille` · `line` · `none` | `braille`: dots (`⠋⠙⠹`). `line`: a turning ASCII line. `auto`: braille, or line with `barStyle=ascii` |
| `separator` | text | ` · ` | any text | what goes between the parts of the line |

Colour names: `black` `red` `green` `yellow` `blue` `magenta` `cyan` `white` `gray` `dim` `bold` `none`. A number from `0` to `255` picks from the 256-colour palette, e.g. `colorBar=214` for orange.

### Wording

Rename any word on the line, for shorter labels or another language.

| key | default | appears as |
|---|---|---|
| `textThinking` | `thinking` | `⠹ thinking` |
| `textWorking` | `working` | `⠹ working` |
| `textWaiting` | `waiting for you` | `⏸ waiting for you` |
| `textCompacting` | `compacting` | `⠹ compacting` |
| `textDone` | `done` | `✓ done` |
| `textInterrupted` | `interrupted` | `⊘ interrupted` |
| `textError` | `stopped (API error)` | `✗ stopped (API error)` |
| `textLeft` | `left` | `~53s left` |
| `textEst` | `est` | `~43% est` |
| `textPace` | `task pace` | `(task pace)` |
| `textAi` | `ai` | `(ai)` |
| `textHistory` | `history` | `(history)` |

### Behaviour

| key | type | default | values | what it does |
|---|---|---|---|---|
| `showLabel` | true/false | `true` | | show the tool running now, e.g. `$ Bash npm test` |
| `showTools` | true/false | `true` | | show the `3 tools` counter |
| `showElapsed` | true/false | `true` | | show elapsed time, and the total on the finished line |
| `showTaskCount` | true/false | `true` | | show the `2/4` before the current task |
| `maxLabel` | number | `28` | `4`–`200` | shorten tool and task names to this many characters |
| `doneLinger` | number | `-1` | `-1`–`86400` | seconds to keep `✓ done` on screen; `-1` keeps it until the next prompt |
| `refresh` | number | `1` | `1`–`60` | seconds between redraws. Changing it updates `settings.json` for you |

### Older setting names

Settings from version 0.1 still work, and the command tells you the new name:

| old | new |
|---|---|
| `style` | `barStyle` (`minimal` becomes `none`) |
| `mode` | `measure` |
| `showEstimate=false` | `estimate=off` |

## Recipes

**Token-free:** `estimator=free`

```text
⠧ working ▕████████░░░░▏ 47s / ~1m10s · ~24s left · 2/4 Running tests · $ Bash npm test
```

**A stronger model for the AI estimate:** `aiModel=sonnet` (uses more of your plan per call)

**Clock-style times:** `timeFormat=clock`

```text
⠧ working ▕████████░░░░▏ 0:47 / ~1:10 · ~0:24 left · 2/4 Running tests · $ Bash npm test · 1 tool
```

**A wider dotted bar:** `barStyle=dots width=16`

```text
⠧ working ●●●●●●●●●●○○○○○○ 47s / ~1m10s · ~24s left · 2/4 Running tests · $ Bash npm test · 1 tool
```

**Your own line:** `segments=status,time,tool statusText=never`

```text
⠧ 47s / ~1m10s · ~24s left · $ Bash npm test
```

**Another language:** `textWorking=läuft textLeft=übrig textInterrupted=abgebrochen`

```text
⠧ läuft ▕████████░░░░▏ 47s / ~1m10s · ~24s übrig · 2/4 Running tests · $ Bash npm test · 1 tool
```

**Hide the finished line after 30 seconds:** `doneLinger=30`

**Percent instead of time, like a classic progress bar:** `measure=percent`

## Edge cases

| What happens | What the line does | Saved to history? |
|---|---|---|
| You send a message while Claude is working (it's queued and picked up mid-prompt) | Same prompt: the timer, tasks and tool count carry on. With `ai`, the AI is asked again, since the job may have changed | Yes, the whole prompt, once |
| You press **Esc** while a tool runs | `⊘ interrupted · 22s` | No |
| You press **Esc** while Claude is thinking (no hook fires) | Spotted from the session transcript: `⊘ interrupted` | No |
| A permission prompt, a question from Claude, or plan approval | `⏸ waiting for you`, and the working clock pauses | Working time only |
| Another plugin's Stop hook makes Claude keep going | The prompt reopens, so it doesn't show `✓ done` while working | Yes, once, replacing the earlier entry |
| API error or rate limit | `✗ stopped (API error)` | No |
| Context compaction during a prompt | `⠧ compacting`, then the prompt resumes | Counted as working time |
| `/compact` between prompts | `compacting`, then back to `✓ done` | – |
| The prompt passes the AI's estimate | The AI is asked again with the progress so far (max 3 calls per prompt) | Yes, plus how far off the AI was |
| The AI call fails: offline, logged out, usage limit | The free estimate is used; login and limit errors pause AI calls for 15 min | Yes |
| The prompt runs longer than almost every past prompt | Elapsed time and a pulse, no number | Yes |
| Tasks carried over from an earlier prompt | Shown in `2/4`, but they don't speed up the pace | – |
| Claude Code crashes mid-prompt | After 30 min without events, the next prompt starts fresh | No |
| Two sessions finish at the same moment | Each saves its own entry safely | Yes |

## How it works

```text
 Claude Code hooks            PromptBar                                           your terminal
 ─────────────────            ─────────                                           ─────────────
 UserPromptSubmit ─┐
 PreToolUse        │
 PostToolUse       ├──▶ track.js ──▶ $TMPDIR/prompt-bar/<session>.jsonl
 PermissionRequest │   (prints        {"t":…,"e":"pre","tool":"Bash",…}
 TaskCreated  …    │    nothing)      {"t":…,"e":"post",…}             │
 Stop             ─┘        │                     ▲                    │ every second
                            │                     │                    ▼
                            │             {"e":"ai","ms":…}      statusline.js ──▶ ⠹ working ▕███░░░▏ …
                            │                     │                    │
                            │              ai-worker.js ◀── re-ask ────┘
                            │              claude -p (your login,
                            │              no settings, no tools)
                            ▼
              ~/.claude/prompt-bar/stats.json   (working time per prompt, per project)
```

1. **Hooks record events.** Claude Code runs `track.js` on each event: prompt, tool start and end, task, permission, compaction, stop. Each run appends one line to a per-session log. The tool hooks are `async`, so Claude never waits on them.
2. **The AI is asked in the background** (`estimator=ai`). `ai-worker.js` runs `claude -p` in a detached process and appends its answer to the same log.
3. **The status line reads the log.** Claude Code runs `statusline.js` every second. It works out the current state and the estimate, and draws the line. It runs outside the model, so nothing is added to your conversation.
4. **Stop saves the result.** The prompt's working time is added to your history, together with how far off the AI was.

The hook at the start of a prompt returns in about 0.1s, and a status-line redraw takes about 60ms.

## Files and environment variables

**Files**

| path | what it is | safe to delete? |
|---|---|---|
| `~/.claude/prompt-bar/config.json` | your settings | yes: you get the defaults |
| `~/.claude/prompt-bar/stats.json` | history: working time per prompt and AI accuracy, per project | yes: estimates start learning again |
| `~/.claude/prompt-bar/ai-cooldown.json` | present while AI calls are paused after a login or usage-limit error | yes: AI calls resume |
| `~/.claude/prompt-bar/statusline.js`, `root.txt` | the stable status-line entry point and the path to the installed plugin | recreated by `/prompt-bar:setup` |
| `~/.claude/settings.json.prompt-bar.bak` | backup of your settings, made by `/prompt-bar:setup` | yes |
| `$TMPDIR/prompt-bar/<session>.jsonl` | the live event log for one session | deleted automatically when the session ends |

**Environment variables**

| variable | effect |
|---|---|
| `NO_COLOR` | turns colours off (the [standard](https://no-color.org)) |
| `PROMPT_BAR_STYLE` | overrides `barStyle` for this terminal, e.g. `PROMPT_BAR_STYLE=ascii` |
| `PROMPT_BAR_DEBUG` | when set, the status line shows an error message instead of staying blank |
| `PROMPT_BAR_DATA_DIR` | where settings and history are stored (default `~/.claude/prompt-bar`) |
| `PROMPT_BAR_STATE_DIR` | where session logs are kept (default `$TMPDIR/prompt-bar`) |
| `PROMPT_BAR_SETTINGS` | the Claude Code settings file that setup edits (default `~/.claude/settings.json`) |

## Privacy and cost

| | `estimator=ai` | `estimator=free` |
|---|---|---|
| Tokens | about 800 per AI call, usually 1 call a prompt, on your Claude Code plan | 0 |
| Data leaving your machine | the estimate question, sent to Anthropic through your Claude Code login: the same place your prompts already go | none |
| Data in the question | prompt (first 2,000 characters), mid-prompt messages, folder name, task titles, time and tool counts | – |
| Never sent | file contents, code, tool output | – |
| Stored locally | settings, history (durations only), session logs (deleted at session end) | same |

## Troubleshooting

<details>
<summary><b>The bar doesn't appear</b></summary>

1. Run `/prompt-bar:setup`, then restart Claude Code.
2. Check that Node.js 18 or newer is on your `PATH`: `node --version`.
3. Check that your settings point at PromptBar. `~/.claude/settings.json` should contain `"statusLine": { "command": "node \".../prompt-bar/statusline.js\"" }`.
4. The bar is empty while no prompt is running. Send a prompt.

</details>

<details>
<summary><b>No AI estimates (no <code>(ai)</code> in the <code>verbose</code> layout)</b></summary>

1. Check that `estimator` is `ai`: `/prompt-bar:config`.
2. Check that the `claude` command works in a terminal and that you're logged in: `claude auth status`.
3. After a login or usage-limit error, AI calls pause for 15 minutes. Delete `~/.claude/prompt-bar/ai-cooldown.json` to resume now.
4. With a task list, task pace takes over once a task finishes. That's intended.

</details>

<details>
<summary><b>The estimates feel off</b></summary>

- Estimates improve as you use PromptBar. History and AI calibration both need 3 finished prompts in a project.
- Use `layout=verbose` to see which source each estimate comes from.
- To start learning again from scratch, delete `~/.claude/prompt-bar/stats.json`.

</details>

<details>
<summary><b>The line is blank or shows strange characters</b></summary>

- Run Claude Code with `PROMPT_BAR_DEBUG=1` set to see any error on the line.
- If your terminal font shows symbols as boxes, use `layout=plain` or `barStyle=ascii icons=false spinner=line`.

</details>

<details>
<summary><b>Start over</b></summary>

```bash
/prompt-bar:config reset        # all settings back to defaults
```

Delete `~/.claude/prompt-bar/stats.json` to clear history as well.

</details>

## FAQ

**Does PromptBar add tokens to my conversation?**
No. The hooks print nothing, and the status line runs outside the model. The only token use is the optional AI estimate: a separate, small call on your plan, which `estimator=free` turns off.

**Do I need an API key?**
No. The AI estimate uses the `claude` command you already have, through your normal Claude Code login.

**Does it slow Claude down?**
No. Hooks are asynchronous or return in about 0.1s, and the AI call runs in the background.

**Will it replace my current status line?**
No. `/prompt-bar:setup` keeps it and draws it above the bar, and `/prompt-bar:uninstall` puts it back on its own.

**Does it work on Windows, macOS and Linux?**
Yes. It's plain Node.js with no dependencies.

**Why does the estimate change while Claude works?**
It's worked out again every second from the latest evidence: tasks finished, the AI's answer and how long this prompt has already run. A changing estimate is the accurate one.

## Uninstall

```bash
/prompt-bar:uninstall                 # remove the bar and restore your previous status line
/plugin uninstall prompt-bar          # remove the plugin and its hooks
```

Then delete `~/.claude/prompt-bar/` to remove your settings and history.

## Development

```bash
git clone https://github.com/akr4m/prompt-bar && cd prompt-bar
npm test          # node --test, no dependencies; a stand-in replaces `claude`, so tests use no tokens
npm run demo      # preview every layout
```

| file | job |
|---|---|
| `scripts/track.js` | hook handler: one JSON line per event |
| `scripts/statusline.js` | status-line entry point |
| `scripts/ai-worker.js` | background `claude -p` call that writes the AI estimate to the log |
| `scripts/setup.js` | install, uninstall, config, demo |
| `scripts/lib/state.js` | turns the log into the current state; working time |
| `scripts/lib/estimate.js` | task pace, AI calibration, history median, per-project stats |
| `scripts/lib/ai.js` | when to ask the AI, the question, reading the answer |
| `scripts/lib/transcript.js` | spots an Esc in the session transcript |
| `scripts/lib/render.js` | segments, layouts, colours, bar styles |
| `scripts/lib/config.js` | defaults, layouts, value checks |
| `hooks/hooks.json` | which Claude Code events run `track.js` |
| `commands/*.md` | the `/prompt-bar:*` commands |
| `test/prompt-bar.test.js` | the test suite |

## Changelog

**0.3.1**
- The "no estimate" pulse always stays on the bar, so it never looks like 0%.
- `measure=percent` also uses the AI estimate.

**0.3.0**
- AI estimator (default), using your Claude Code login, calibrated to you; `estimator=free` for 0 tokens.
- Estimates update live: history only counts prompts longer than this one so far.
- Fixed: a message sent mid-prompt restarted the timer, which made estimates too short.
- New `⊘ interrupted` state for Esc; correct handling of Stop hooks that continue, `/compact` and plan approval.

**0.2.0**
- Time estimates (elapsed, total, left) instead of percentages; 7 layouts; about 50 checked settings.

**0.1.0**
- First release: a live progress bar in the status line. It ran on Bun until it moved to Node.js.

## License

[MIT](LICENSE) © akr4m
