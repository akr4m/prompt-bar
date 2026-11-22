<div align="center">

# PromptBar

**Live time estimates for every Claude Code prompt, right in the status line.**

How long Claude has been working · how long the prompt should take · how much time is left

`AI-assisted or 0 tokens` · `uses your Claude Code login` · `no dependencies` · `Node ≥ 18` · `MIT`

</div>

```text
⠧ working ▕████████░░░░▏ 47s / ~1m10s · ~24s left · 2/4 Running tests · $ Bash npm test · 1 tool
```

---

## Contents

- [One prompt, start to finish](#one-prompt-start-to-finish)
- [Reading the line](#reading-the-line)
- [AI or token-free](#ai-or-token-free)
- [How the estimate works](#how-the-estimate-works)
- [Edge cases](#edge-cases)
- [Install](#install)
- [Layouts](#layouts)
- [Bar styles and measures](#bar-styles-and-measures)
- [Configuration](#configuration)
- [Recipes](#recipes)
- [How it works](#how-it-works)
- [Uninstall](#uninstall)
- [Develop](#develop)

---

## One prompt, start to finish

Here is one prompt as it runs, with the default settings. The clock on the left is the real time; the line is what the status line shows. The estimate is worked out again every second.

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

- **0:01.** The AI estimate is on its way, so your history fills in for a moment.
- **0:03.** The AI has read the prompt and estimates 2m30s of work.
- **0:31.** Claude has finished 1 of 4 tasks. Its real pace (24s per task) is better evidence than any guess, so the estimate switches to it.
- **1:10.** Claude is waiting for your permission. The working clock pauses at 40s.
- **1:58.** The minute you spent answering doesn't count: 58s worked, not 1m58s.
- **2:10.** You sent a message while Claude was working. It's the same prompt, so the timer carries on. The current task is running slower than the pace, so the time left goes up a little.
- **2:52.** The finished line shows the real clock time.

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
⠧ working ▕░░░░░░░░░▒▒▒▏ 4m20s · $ Bash npm run build
✓ done · 14 tools · 1m12s
⊘ interrupted · 22s
✗ stopped (API error) · 20s
```

`+2` means two more tools are running in parallel, and `⑂1` means one subagent is running. A moving `▒▒▒` pulse means "working, but no reliable estimate", for example when a prompt has already run longer than almost every past one. It never stands for an amount.

## AI or token-free

PromptBar has two estimators. **`ai` is the default.** Turn on token-free mode with `/prompt-bar:config estimator=free`, and switch back with `estimator=ai`.

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

## Install

Requires [Node.js](https://nodejs.org) 18 or newer on your `PATH`. The AI estimate also needs the `claude` command, which you already have if you use Claude Code in a terminal.

```bash
/plugin marketplace add akr4m/prompt-bar
/plugin install prompt-bar@prompt-bar
/prompt-bar:setup
```

`/prompt-bar:setup` adds the status line to `~/.claude/settings.json` and keeps a backup next to it (`settings.json.prompt-bar.bak`). If you already have a status line, it stays, and PromptBar is drawn below it. The bar appears from your next prompt.

To stay token-free from the start:

```bash
/prompt-bar:config estimator=free
```

Update later with:

```bash
/plugin marketplace update prompt-bar
/plugin update prompt-bar@prompt-bar
```

## Layouts

A layout is a preset. Choose one with `/prompt-bar:config layout=<name>`; any setting you set yourself still overrides it. Each block shows the same six moments: task pace, AI estimate, a very long prompt, waiting, interrupted, done.

**`default`**, for everyday use

```text
⠧ working ▕████████░░░░▏ 47s / ~1m10s · ~24s left · 2/4 Running tests · $ Bash npm test · 1 tool
⠧ working ▕███▊░░░░░░░░▏ 47s / ~2m30s · ~1m43s left · ✎ Edit checkout.tsx · 1 tool
⠧ working ▕░░░░░░░░░▒▒▒▏ 4m20s · $ Bash npm run build
⏸ waiting for you ▕██▍░░░░░░░░░▏ 31s / ~2m30s · ~1m59s left
⊘ interrupted · 22s
✓ done · 14 tools · 1m12s
```

**`verbose`**, which also shows where the estimate came from

```text
⠧ working ▕████████░░░░▏ 47s / ~1m10s · ~24s left (task pace) · 2/4 Running tests · $ Bash npm test · 1 tool
⠧ working ▕███▊░░░░░░░░▏ 47s / ~2m30s · ~1m43s left (ai) · ✎ Edit checkout.tsx · 1 tool
⠧ working ▕░░░░░░░░░▒▒▒▏ 4m20s · $ Bash npm run build
⏸ waiting for you ▕██▍░░░░░░░░░▏ 31s / ~2m30s · ~1m59s left (ai)
⊘ interrupted · 22s
✓ done · 14 tools · 1m12s
```

**`compact`**, for narrow terminals

```text
⠧ ▕████████░░░░▏ 47s / ~1m10s · 2/4 Running tests
⠧ ▕███▊░░░░░░░░▏ 47s / ~2m30s
⠧ ▕░░░░░░░░░▒▒▒▏ 4m20s
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
\ working [---------===] 4m20s - Bash npm run build
|| waiting for you [##----------] 31s / ~2m30s - ~1m59s left
-- interrupted - 22s
OK done - 14 tools - 1m12s
```

Run `/prompt-bar:config` with no arguments to preview every layout in your own terminal.

## Bar styles and measures

**`barStyle`**

```text
bar     ⠧ working ▕███▊░░░░░░░░▏ 47s / ~2m30s · ~1m43s left
blocks  ⠧ working ■■■□□□□□□□□□ 47s / ~2m30s · ~1m43s left
dots    ⠧ working ●●●○○○○○○○○○ 47s / ~2m30s · ~1m43s left
ascii   \ working [###---------] 47s / ~2m30s · ~1m43s left
none    ⠧ working 47s / ~2m30s · ~1m43s left
```

**`measure`**, which decides what the bar and the numbers measure

```text
time     ⠧ working ▕████████░░░░▏ 47s / ~1m10s · ~24s left · 2/4 Running tests     (default)
percent  ⠧ working ▕██████░░░░░░▏ 50% · 2/4 Running tests · 47s
both     ⠧ working ▕██████░░░░░░▏ 50% · 47s / ~1m10s · ~24s left · 2/4 Running tests
```

With `percent` and no task list, the percentage is an estimate. It's drawn hatched and labelled: `▕▒▒▒▒▒░░░░░░░▏ ~43% est`.

## Configuration

```bash
/prompt-bar:config estimator=free layout=compact barStyle=dots   # set one or more keys
/prompt-bar:config reset                                         # back to defaults
/prompt-bar:config                                               # preview every layout
```

Settings live in `~/.claude/prompt-bar/config.json`. Every value is checked:

```text
> /prompt-bar:config layout=compac width=abc
invalid layout="compac": must be one of default | verbose | compact | minimal | countdown | focus | plain
invalid width="abc": must be a whole number from 4 to 40
```

<details open>
<summary><b>Estimator</b></summary>

| key | default | values |
|---|---|---|
| `estimator` | `ai` | `ai`: a quick AI estimate on your Claude Code plan · `free`: 0 tokens |
| `aiModel` | `haiku` | model alias or id for the AI estimate, e.g. `haiku`, `sonnet` |
| `aiMaxCalls` | `3` | AI calls per prompt at most, 1–10 |
| `estimate` | `auto` | `auto` (task pace, then AI, then history) · `tasks` · `history` · `off` |

</details>

<details open>
<summary><b>What to show</b></summary>

| key | default | values |
|---|---|---|
| `layout` | `default` | `default` · `verbose` · `compact` · `minimal` · `countdown` · `focus` · `plain` |
| `measure` | `time` | `time` · `percent` · `both` |
| `timeStyle` | `full` | `full` → `47s / ~1m40s · ~53s left` · `remaining` → `~53s left` |
| `showTotal` | `true` | the `/ ~1m40s` part |
| `showRemaining` | `true` | the `~53s left` part |
| `statusText` | `always` | phase word next to the icon: `always` · `paused` (done and waiting only) · `never` |
| `segments` | `status,bar,pct,time,task,tool,agents,tools` | which parts appear, in what order. Add `source` to show where the estimate came from |

</details>

<details>
<summary><b>History</b></summary>

| key | default | values |
|---|---|---|
| `historySize` | `50` | finished prompts kept per project, 3–200 |
| `minSamples` | `3` | prompts needed before history (or AI calibration) is used, 1–50 |
| `historyScope` | `project` | `project` · `global` |
| `timeFormat` | `short` | `short` → `1m40s` · `clock` → `1:40` |

</details>

<details>
<summary><b>Look</b></summary>

| key | default | values |
|---|---|---|
| `barStyle` | `bar` | `bar` · `blocks` · `dots` · `ascii` · `none` |
| `width` | `12` | bar cells, 4–40 |
| `color` | `true` | `true` · `false` (also turned off by `NO_COLOR`) |
| `colorThinking` | `cyan` | colour name or `0`–`255` |
| `colorWorking` | `cyan` | 〃 |
| `colorWaiting` | `yellow` | 〃 |
| `colorCompacting` | `magenta` | 〃 |
| `colorDone` | `green` | 〃 |
| `colorError` | `red` | 〃 |
| `colorInterrupted` | `yellow` | 〃 |
| `colorBar` | `green` | 〃 |
| `icons` | `true` | tool icons `$ ✎ ⌕ ⇣ ⑂` |
| `spinner` | `auto` | `auto` · `braille` (`⠋⠙⠹`) · `line` (`|/-\`) · `none` |
| `separator` | ` · ` | any text |

Colour names: `black` `red` `green` `yellow` `blue` `magenta` `cyan` `white` `gray` `dim` `bold` `none`.

</details>

<details>
<summary><b>Wording</b></summary>

| key | default |
|---|---|
| `textThinking` | `thinking` |
| `textWorking` | `working` |
| `textWaiting` | `waiting for you` |
| `textCompacting` | `compacting` |
| `textDone` | `done` |
| `textInterrupted` | `interrupted` |
| `textError` | `stopped (API error)` |
| `textLeft` | `left` |
| `textEst` | `est` |
| `textPace` | `task pace` |
| `textAi` | `ai` |
| `textHistory` | `history` |

</details>

<details>
<summary><b>Behaviour</b></summary>

| key | default | values |
|---|---|---|
| `showLabel` | `true` | the tool running now, e.g. `$ Bash npm test` |
| `showTools` | `true` | the `3 tools` counter |
| `showElapsed` | `true` | elapsed time, and the total on the finished line |
| `showTaskCount` | `true` | the `2/4` before the current task |
| `maxLabel` | `28` | shorten tool and task names to this many characters, 4–200 |
| `doneLinger` | `-1` | seconds to keep `✓ done` on screen; `-1` keeps it until the next prompt |
| `refresh` | `1` | seconds between redraws, 1–60; written to `settings.json` |

</details>

Names from 0.1 still work: `style` → `barStyle` (`minimal` → `none`), `mode` → `measure`, `showEstimate=false` → `estimate=off`.

## Recipes

**Token-free**: `estimator=free`

```text
⠧ working ▕████████░░░░▏ 47s / ~1m10s · ~24s left · 2/4 Running tests · $ Bash npm test
```

**A stronger model for the AI estimate**: `aiModel=sonnet` (more usage per call)

**Clock-style times**: `timeFormat=clock`

```text
⠧ working ▕████████░░░░▏ 0:47 / ~1:10 · ~0:24 left · 2/4 Running tests · $ Bash npm test · 1 tool
```

**A wider dotted bar**: `barStyle=dots width=16`

```text
⠧ working ●●●●●●●●●●○○○○○○ 47s / ~1m10s · ~24s left · 2/4 Running tests · $ Bash npm test · 1 tool
```

**Your own line**: `segments=status,time,tool statusText=never`

```text
⠧ 47s / ~1m10s · ~24s left · $ Bash npm test
```

**Another language**: `textWorking=läuft textLeft=übrig textInterrupted=abgebrochen`

```text
⠧ läuft ▕████████░░░░▏ 47s / ~1m10s · ~24s übrig · 2/4 Running tests · $ Bash npm test · 1 tool
```

**Hide the finished line after 30 seconds**: `doneLinger=30`

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

- **Nothing added to your conversation.** The hooks print nothing, and the status line runs outside the model, so Claude never sees any of it. In `ai` mode the estimate is a separate, small `claude -p` call; in `free` mode PromptBar uses 0 tokens.
- **Never slows Claude down.** The tool hooks are `async`, and the AI call runs in a detached background process. The prompt hook returns in about 0.1s.
- **Small files.** Each new prompt rewrites the log to hold only that prompt plus any unfinished tasks. The log is deleted when the session ends. History keeps at most 50 durations per project, for up to 100 projects. It's written to a temp file and then renamed, so two sessions finishing at once can't corrupt it.
- **Local, except the AI call.** In `free` mode nothing leaves your machine. In `ai` mode only the estimate question goes to Anthropic, the same place Claude Code already sends your prompts.

## Uninstall

```bash
/prompt-bar:uninstall                 # remove the bar and restore your previous status line
/plugin uninstall prompt-bar          # remove the hooks too
```

## Develop

```bash
git clone https://github.com/akr4m/prompt-bar && cd prompt-bar
npm test          # node --test, no dependencies; a stand-in replaces `claude`, so tests use no tokens
npm run demo      # preview every layout
```

The code lives in `scripts/`:

| file | job |
|---|---|
| `track.js` | hook handler: one JSON line per event |
| `statusline.js` | status-line entry point |
| `ai-worker.js` | background `claude -p` call that writes the AI estimate to the log |
| `setup.js` | install, uninstall, config, demo |
| `lib/state.js` | turns the log into the current state; working time |
| `lib/estimate.js` | task pace, AI calibration, history median, per-project stats |
| `lib/ai.js` | when to ask the AI, the question, reading the answer |
| `lib/transcript.js` | spots an Esc in the session transcript |
| `lib/render.js` | segments, layouts, colours, bar styles |
| `lib/config.js` | defaults, layouts, value checks |

## License

[MIT](LICENSE) © akr4m
