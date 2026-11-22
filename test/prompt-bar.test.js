'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-test-'));
process.env.PROMPT_BAR_STATE_DIR = path.join(tmp, 'state');
process.env.PROMPT_BAR_DATA_DIR = path.join(tmp, 'data');
delete process.env.NO_COLOR;
delete process.env.PROMPT_BAR_STYLE;

const { reduce, activeMs } = require('../scripts/lib/state');
const { estimateProgress, median, typicalMs, recordRun, loadStats, STATS_FILE } = require('../scripts/lib/estimate');
const { render, bar, fmtDuration, BARS } = require('../scripts/lib/render');
const { DEFAULTS, LAYOUTS, loadConfig, validate, CONFIG_FILE } = require('../scripts/lib/config');

const cfg = Object.assign({}, DEFAULTS, { color: false });
const SCRIPTS = path.join(__dirname, '..', 'scripts');
const S = 1000;
const hist = (list) => ({ v: 3, all: list, projects: {} });
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// Tests run with estimator=free unless a test turns the AI on, so that no background
// worker adds events while a test counts log lines.
const setConfig = (obj) => {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(Object.assign({ estimator: 'free' }, obj)));
};
setConfig({});

// A stand-in for `claude -p`, so tests never use the real model. It records how it was
// called (PB_FAKE_LOG) and answers per PB_FAKE_MODE: ok | login | garbage.
const FAKE_CLAUDE = path.join(tmp, 'fake-claude.js');
fs.writeFileSync(FAKE_CLAUDE, `
const fs = require('fs'); let input = '';
process.stdin.on('data', (d) => { input += d; }).on('end', () => {
  if (process.env.PB_FAKE_LOG) fs.writeFileSync(process.env.PB_FAKE_LOG, JSON.stringify({ args: process.argv.slice(2), input, child: process.env.PROMPT_BAR_CHILD, cwd: process.cwd() }));
  const mode = process.env.PB_FAKE_MODE || 'ok';
  if (mode === 'login') return process.stdout.write(JSON.stringify({ is_error: true, result: 'Not logged in · Please run /login' }));
  if (mode === 'garbage') return process.stdout.write('not json');
  process.stdout.write(JSON.stringify({ is_error: false, result: '{"seconds": ' + (process.env.PB_FAKE_SECONDS || 120) + '}' }));
});`);
process.env.PROMPT_BAR_CLAUDE = FAKE_CLAUDE;

// Wait (synchronously) until `check()` is truthy or the timeout passes.
const waitFor = (check, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = check();
    if (v) return v;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return check();
};

// ---- state ---------------------------------------------------------------

test('prompt -> tool -> done lifecycle', () => {
  let s = reduce([{ t: 1, e: 'prompt' }]);
  assert.equal(s.phase, 'thinking');
  s = reduce([{ t: 1, e: 'prompt' }, { t: 2, e: 'pre', tool: 'Bash', id: 'a', label: 'ls' }]);
  assert.equal(s.phase, 'tool');
  assert.equal(s.running.size, 1);
  s = reduce([{ t: 1, e: 'prompt' }, { t: 2, e: 'pre', tool: 'Bash', id: 'a' }, { t: 3, e: 'post', tool: 'Bash', id: 'a' }, { t: 9, e: 'stop' }]);
  assert.equal(s.phase, 'done');
  assert.equal(s.toolsDone, 1);
  assert.equal(s.endedAt - s.startedAt, 8);
});

test('async hooks out of order: post logged before pre does not leave a ghost tool', () => {
  const s = reduce([{ t: 1, e: 'prompt' }, { t: 3, e: 'post', tool: 'Read', id: 'x' }, { t: 3, e: 'pre', tool: 'Read', id: 'x' }]);
  assert.equal(s.running.size, 0);
  assert.equal(s.phase, 'thinking');
});

test('parallel tools tracked independently', () => {
  const s = reduce([{ t: 1, e: 'prompt' },
    { t: 2, e: 'pre', tool: 'Read', id: 'a' }, { t: 2, e: 'pre', tool: 'Grep', id: 'b' },
    { t: 3, e: 'post', tool: 'Read', id: 'a' }]);
  assert.equal(s.running.size, 1);
  assert.equal(s.phase, 'tool');
});

test('Task events give exact progress; deleted tasks excluded', () => {
  const s = reduce([{ t: 1, e: 'prompt' },
    { t: 2, e: 'task', task: { id: '1', status: 'pending', subject: 'A' } },
    { t: 2, e: 'task', task: { id: '2', status: 'pending', subject: 'B' } },
    { t: 2, e: 'task', task: { id: '3', status: 'pending', subject: 'C' } },
    { t: 3, e: 'post', tool: 'TaskUpdate', id: 'u', task: { id: '1', status: 'completed' } },
    { t: 4, e: 'post', tool: 'TaskUpdate', id: 'v', task: { id: '2', status: 'in_progress', form: 'Doing B' } },
    { t: 5, e: 'post', tool: 'TaskUpdate', id: 'w', task: { id: '3', status: 'deleted' } }]);
  assert.deepEqual(s.todo, { done: 1, total: 2, active: 'Doing B' });
  const p = estimateProgress(s, null, 10);
  assert.equal(p.pct, 50);
  assert.equal(p.kind, 'exact');
});

test('legacy TodoWrite snapshot', () => {
  const s = reduce([{ t: 1, e: 'prompt' }, { t: 2, e: 'post', tool: 'TodoWrite', id: 'a', todo: [3, 4, 'Polishing'] }]);
  assert.equal(estimateProgress(s, null, 3).pct, 75);
});

test('idle Notification after stop does not flip done -> waiting', () => {
  const s = reduce([{ t: 1, e: 'prompt' }, { t: 2, e: 'stop' }, { t: 3, e: 'wait' }]);
  assert.equal(s.phase, 'done');
});

test('waiting for the user is excluded from working time', () => {
  const evs = [{ t: 0, e: 'prompt' }, { t: 10 * S, e: 'wait' }, { t: 310 * S, e: 'post', tool: 'Bash', id: 'a' },
    { t: 320 * S, e: 'pre', tool: 'AskUserQuestion', id: 'q' }, { t: 380 * S, e: 'post', tool: 'AskUserQuestion', id: 'q' },
    { t: 400 * S, e: 'stop' }];
  const s = reduce(evs);
  assert.equal(activeMs(s, 400 * S), 40 * S); // 400s wall - 300s permission wait - 60s question
  const mid = reduce(evs.slice(0, 2));        // still waiting: the working clock is frozen
  assert.equal(mid.phase, 'waiting');
  assert.equal(activeMs(mid, 100 * S), 10 * S);
  // The finished line shows the real wall-clock time.
  assert.match(render(s, estimateProgress(s, null, 400 * S), cfg, 400 * S), /6m40s$/);
});

// ---- estimates -----------------------------------------------------------

test('no signal -> no fake number in any measure', () => {
  const s = reduce([{ t: 1, e: 'prompt' }]);
  assert.deepEqual(estimateProgress(s, null, 5), { pct: null, kind: 'none', time: null });
  for (const measure of ['time', 'percent', 'both']) {
    const c = Object.assign({}, cfg, { measure });
    assert.doesNotMatch(render(s, estimateProgress(s, null, 5, c), c, 5), /%|~/, measure);
  }
});

// Four tasks; tasks 1 and 2 finished at 20s and 40s of working time.
const fourTasks = (extra = []) => reduce([{ t: 0, e: 'prompt' },
  ...['1', '2', '3', '4'].map((id) => ({ t: 1, e: 'task', task: { id, status: 'pending' } })),
  { t: 20 * S, e: 'task', task: { id: '1', status: 'completed' } },
  { t: 40 * S, e: 'task', task: { id: '2', status: 'completed' } }, ...extra]);

test('task pace: per-task time from this prompt, remaining tasks at that pace', () => {
  const s = fourTasks();
  assert.equal(s.doneHere, 2);
  assert.equal(s.doneActive, 40 * S);
  // At 50s: pace 20s/task; current task 10s in -> 10s more; plus 1 more task -> ~30s left.
  const p = estimateProgress(s, hist([999 * S, 999 * S, 999 * S]), 50 * S, DEFAULTS);
  assert.equal(p.time.source, 'tasks'); // task pace beats history
  assert.equal(p.time.remainingMs, 30 * S);
  assert.match(render(s, p, cfg, 50 * S), /50s \/ ~1m20s · ~30s left/);
  assert.equal(estimateProgress(s, hist([99 * S, 99 * S, 99 * S]), 50 * S, Object.assign({}, DEFAULTS, { estimate: 'history' })).time.source, 'history');
  assert.equal(estimateProgress(s, hist([99 * S, 99 * S, 99 * S]), 50 * S, Object.assign({}, DEFAULTS, { estimate: 'off' })).time, null);
});

test('task pace re-estimates when the current task runs slow, never stalls at 0', () => {
  const s = fourTasks();
  // At 100s the current task has taken 60s (pace is 20s): assume ~30s more, plus 1 task.
  const late = estimateProgress(s, null, 100 * S, DEFAULTS).time;
  assert.equal(late.remainingMs, 50 * S);
  // The longer it runs, the later the finish, so "left" keeps a real number.
  const later = estimateProgress(s, null, 200 * S, DEFAULTS).time;
  assert.ok(later.totalMs > late.totalMs && later.remainingMs > 0);
});

test('tasks finished in an earlier prompt do not speed up the pace', () => {
  // Carried over: 2 tasks completed before this prompt started (logged at t = start - 1).
  const s = reduce([
    { t: 999, e: 'task', task: { id: '1', status: 'completed' } }, { t: 999, e: 'task', task: { id: '2', status: 'completed' } },
    { t: 999, e: 'task', task: { id: '3', status: 'pending' } }, { t: 999, e: 'task', task: { id: '4', status: 'pending' } },
    { t: 1000, e: 'prompt' }]);
  assert.equal(s.todo.done, 2);
  assert.equal(s.doneHere, 0);
  assert.equal(estimateProgress(s, null, 1000 + 30 * S, DEFAULTS).time, null); // no pace yet: no guess
});

test('history re-estimates live: only prompts longer than this one so far count', () => {
  assert.equal(median([10, 20, 30, 600]), 25);
  const h = hist([3 * S, 4 * S, 8 * S, 45 * S, 70 * S, 90 * S, 120 * S, 240 * S]);
  const s = reduce([{ t: 0, e: 'prompt' }]);
  const at = (sec) => estimateProgress(s, h, sec * S, DEFAULTS).time;
  assert.equal(at(5).totalMs, 80 * S);    // 8 45 70 90 120 240 -> 80
  assert.equal(at(50).totalMs, 105 * S);  // 70 90 120 240 -> 105: re-estimated upward
  assert.equal(at(130), null);            // only 240 is longer: too few, no guess
  assert.match(render(s, estimateProgress(s, h, 5 * S, DEFAULTS), cfg, 5 * S), /5s \/ ~1m20s · ~1m15s left/);
  assert.match(render(s, estimateProgress(s, h, 130 * S, DEFAULTS), cfg, 130 * S), /^. thinking ▕[░▒]+▏ 2m10s$/);
});

test('no estimate before minSamples prompts of history', () => {
  const s = reduce([{ t: 0, e: 'prompt' }]);
  assert.equal(estimateProgress(s, hist([60 * S, 60 * S]), 10 * S, DEFAULTS).time, null);
  assert.ok(estimateProgress(s, hist([60 * S, 60 * S]), 10 * S, Object.assign({}, DEFAULTS, { minSamples: 2 })).time);
});

test('per-project history, falling back to all projects', () => {
  const stats = { v: 3, all: [10 * S, 10 * S, 10 * S, 99 * S], projects: { 'd:/big': [200 * S, 200 * S, 200 * S], 'd:/new': [5 * S] } };
  const big = process.platform === 'win32' ? 'D:\\big\\' : 'd:/big/';
  assert.equal(typicalMs(stats, big, DEFAULTS), 200 * S);
  assert.equal(typicalMs(stats, 'd:/new', DEFAULTS), 10 * S); // too few samples -> all projects
  assert.equal(typicalMs(stats, 'd:/big', Object.assign({}, DEFAULTS, { historyScope: 'global' })), 10 * S);
});

test('recordRun: keeps historySize prompts, replaces a re-stopped prompt, drops old formats', () => {
  try { fs.unlinkSync(STATS_FILE); } catch (_) { /* none */ }
  const c = Object.assign({}, DEFAULTS, { historySize: 3 });
  for (const n of [1, 2, 3, 4, 5]) recordRun('/proj', n * S, c, 'p' + n);
  assert.deepEqual(loadStats().all, [3 * S, 4 * S, 5 * S]);
  recordRun('/proj', 9 * S, c, 'p5'); // the same prompt stopped again: replace, don't add
  const st = loadStats();
  assert.deepEqual(st.all, [3 * S, 4 * S, 9 * S]);
  assert.deepEqual(Object.values(st.projects)[0], [3 * S, 4 * S, 9 * S]);
  for (const old of [{ n: 4, avgTools: 1, avgMs: 6764 }, { v: 2, all: [3100], projects: {} }]) {
    fs.writeFileSync(STATS_FILE, JSON.stringify(old));
    assert.deepEqual(loadStats(), { v: 3, all: [], projects: {}, last: null });
  }
  fs.unlinkSync(STATS_FILE);
});

// ---- scenarios -----------------------------------------------------------

test('Esc during a tool: interrupted, not running, no estimate', () => {
  const s = reduce([{ t: 0, e: 'prompt' }, { t: 1 * S, e: 'pre', tool: 'Bash', id: 'a', label: 'npm test' },
    { t: 30 * S, e: 'interrupt', tool: 'Bash', id: 'a' }]);
  assert.equal(s.phase, 'interrupted');
  assert.equal(s.running.size, 0);
  assert.equal(s.toolsFailed, 0); // an interrupt is not a tool failure
  const out = render(s, estimateProgress(s, hist([60 * S, 60 * S, 60 * S]), 40 * S, DEFAULTS), cfg, 40 * S);
  assert.equal(out, '⊘ interrupted · 30s');
});

test('Claude continues after Stop (a Stop hook blocked it): the prompt reopens', () => {
  const s = reduce([{ t: 0, e: 'prompt' }, { t: 10 * S, e: 'stop' },
    { t: 12 * S, e: 'pre', tool: 'Edit', id: 'b', label: 'x.js' }]);
  assert.equal(s.phase, 'tool');
  assert.equal(s.endedAt, 0);
  assert.equal(activeMs(s, 20 * S), 18 * S); // the 2s gap after Stop is not working time
  // Late async events and idle notifications do not reopen it.
  assert.equal(reduce([{ t: 0, e: 'prompt' }, { t: 10 * S, e: 'stop' }, { t: 9 * S, e: 'post', tool: 'Read', id: 'r' }]).phase, 'done');
  assert.equal(reduce([{ t: 0, e: 'prompt' }, { t: 10 * S, e: 'stop' }, { t: 11 * S, e: 'wait' }]).phase, 'done');
});

test('/compact between prompts returns to done; during a prompt resumes it', () => {
  assert.equal(reduce([{ t: 0, e: 'prompt' }, { t: 5, e: 'stop' }, { t: 6, e: 'compact' }, { t: 7, e: 'compacted' }]).phase, 'done');
  assert.equal(reduce([{ t: 0, e: 'prompt' }, { t: 5, e: 'stop' }, { t: 6, e: 'compact' }]).phase, 'compacting');
  assert.equal(reduce([{ t: 0, e: 'prompt' }, { t: 5, e: 'pre', tool: 'Bash', id: 'a' }, { t: 6, e: 'compact' }, { t: 7, e: 'compacted' }]).phase, 'thinking');
});

test('plan approval (ExitPlanMode) counts as waiting, not working', () => {
  const s = reduce([{ t: 0, e: 'prompt' }, { t: 10 * S, e: 'pre', tool: 'ExitPlanMode', id: 'p' },
    { t: 70 * S, e: 'post', tool: 'ExitPlanMode', id: 'p' }]);
  assert.equal(activeMs(s, 80 * S), 20 * S);
});

test('percent estimates are labelled', () => {
  const s = reduce([{ t: 1, e: 'prompt' }]);
  const out = render(s, { pct: 40, kind: 'estimate', time: null }, Object.assign({}, cfg, { measure: 'percent' }), 2);
  assert.match(out, /~40% est/);
});

// ---- rendering -----------------------------------------------------------

test('StopFailure renders as error', () => {
  const s = reduce([{ t: 1, e: 'prompt' }, { t: 2, e: 'stop', err: 1 }]);
  assert.match(render(s, estimateProgress(s, null, 3), cfg, 3), /API error/);
});

test('bar widths are stable for every style', () => {
  for (const barStyle of ['bar', 'blocks', 'dots', 'ascii']) {
    const c = Object.assign({}, cfg, { barStyle, width: 10 });
    const lens = [0, 13, 50, 99, 100].map((p) => [...bar(p, false, c, 0)].length);
    lens.push([...bar(null, false, c, 0)].length, [...bar(40, true, c, 0)].length);
    assert.equal(new Set(lens).size, 1, barStyle + ' ' + lens);
  }
});

test('the no-estimate pulse is always fully visible, at every second and width', () => {
  for (const barStyle of ['bar', 'blocks', 'dots', 'ascii']) {
    for (const width of [4, 5, 12, 40]) {
      const c = Object.assign({}, cfg, { barStyle, width });
      const est = BARS[barStyle].est;
      for (let sec = 0; sec < 2 * width + 4; sec++) {
        const cells = [...bar(null, false, c, sec * 1000)].filter((ch) => ch === est).length;
        assert.equal(cells, 3, barStyle + ' width ' + width + ' second ' + sec);
      }
    }
  }
});

test('fmtDuration short and clock formats', () => {
  assert.equal(fmtDuration(5400), '5s');
  assert.equal(fmtDuration(65000), '1m05s');
  assert.equal(fmtDuration(3723000), '1h02m');
  assert.equal(fmtDuration(47000, 'clock'), '0:47');
  assert.equal(fmtDuration(3723000, 'clock'), '1:02:03');
});

test('every layout renders a clean line in every phase', () => {
  const phases = {
    thinking: [{ t: 0, e: 'prompt' }],
    tool: [{ t: 0, e: 'prompt' }, { t: 1, e: 'pre', tool: 'Bash', id: 'a', label: 'npm test' }],
    waiting: [{ t: 0, e: 'prompt' }, { t: 1, e: 'wait' }],
    over: [{ t: 0, e: 'prompt' }],
    done: [{ t: 0, e: 'prompt' }, { t: 2 * S, e: 'post', tool: 'Read', id: 'x' }, { t: 72 * S, e: 'stop' }],
  };
  for (const layout of Object.keys(LAYOUTS)) {
    const c = Object.assign({}, DEFAULTS, LAYOUTS[layout], { layout });
    for (const [name, evs] of Object.entries(phases)) {
      const s = reduce(evs);
      const now = name === 'done' ? 72 * S : name === 'over' ? 200 * S : 30 * S;
      const out = strip(render(s, estimateProgress(s, hist([60 * S, 60 * S, 60 * S]), now, c), c, now));
      const where = layout + '/' + name + ': ' + JSON.stringify(out);
      assert.ok(out.length > 0, where);
      assert.doesNotMatch(out, /undefined|NaN|null|\s{2}|^\s|\s$|··|\(\)/, where);
      if (layout === 'plain') assert.match(out, /^[\x20-\x7e]+$/, 'plain must be ASCII only: ' + where);
    }
  }
});

test('layouts: minimal is remaining time only, focus has no numbers, verbose names the source', () => {
  const s = reduce([{ t: 0, e: 'prompt' }, { t: 1, e: 'pre', tool: 'Bash', id: 'a', label: 'npm test' }]);
  const run = (layout) => {
    const c = Object.assign({}, DEFAULTS, LAYOUTS[layout], { layout, color: false });
    return render(s, estimateProgress(s, hist([60 * S, 60 * S, 60 * S]), 20 * S, c), c, 20 * S);
  };
  assert.match(run('minimal'), /^. ~40s left$/);
  assert.doesNotMatch(run('focus'), /\d/);
  assert.match(run('verbose'), /~40s left \(history\)/);
  assert.doesNotMatch(run('compact'), /left|Bash/);
});

test('segments choose and order the parts of the line', () => {
  const s = reduce([{ t: 0, e: 'prompt' }, { t: 1, e: 'pre', tool: 'Bash', id: 'a', label: 'npm test' }]);
  const c = Object.assign({}, cfg, { segments: 'tool,time' });
  const out = render(s, estimateProgress(s, hist([60 * S, 60 * S, 60 * S]), 20 * S, c), c, 20 * S);
  assert.equal(out, '$ Bash npm test · 20s / ~1m00s · ~40s left');
});

test('measure=both keeps the percentage and the time as separate parts', () => {
  const s = reduce([{ t: 0, e: 'prompt' }, { t: 1, e: 'task', task: { id: '1', status: 'pending' } },
    { t: 1, e: 'task', task: { id: '2', status: 'pending' } }, { t: 20 * S, e: 'task', task: { id: '1', status: 'completed' } }]);
  const c = Object.assign({}, cfg, { measure: 'both' });
  assert.match(render(s, estimateProgress(s, null, 47 * S, c), c, 47 * S), /▏ 50% · 47s \/ ~1m00s · ~14s left · 1\/2$/);
});

test('doneLinger hides the finished line after N seconds', () => {
  const s = reduce([{ t: 0, e: 'prompt' }, { t: 10 * S, e: 'stop' }]);
  const c = Object.assign({}, cfg, { doneLinger: 5 });
  assert.match(render(s, estimateProgress(s, null, 12 * S), c, 12 * S), /done/);
  assert.equal(render(s, estimateProgress(s, null, 16 * S), c, 16 * S), '');
  assert.match(render(s, estimateProgress(s, null, 9e9), cfg, 9e9), /done/); // -1 = keep
});

test('wording, colours, clock format and spinner are configurable', () => {
  const s = reduce([{ t: 0, e: 'prompt' }, { t: 1, e: 'pre', tool: 'Bash', id: 'a' }]);
  const c = Object.assign({}, DEFAULTS, { textWorking: 'busy', textLeft: 'rest', timeFormat: 'clock', spinner: 'none', colorWorking: 214 });
  const out = render(s, estimateProgress(s, hist([100 * S, 100 * S, 100 * S]), 47 * S, c), c, 47 * S);
  assert.match(out, /\x1b\[38;5;214mbusy/);
  assert.match(strip(out), /^busy ▕.*▏ 0:47 \/ ~1:40 · ~0:53 rest/);
});

// ---- config --------------------------------------------------------------

test('config: bad values are rejected, legacy names still work, layouts are presets', () => {
  assert.equal(validate('measure', 'tiem'), 'must be one of time | percent | both');
  assert.match(validate('width', 3), /4 to 40/);
  assert.match(validate('segments', 'bar,clock'), /unknown segment clock/);
  assert.match(validate('colorBar', 'pink'), /colour name/);
  assert.equal(validate('colorBar', 214), null);
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ style: 'minimal', mode: 'percent', showEstimate: false, width: 'abc' }));
  const c = loadConfig();
  assert.equal(c.barStyle, 'none');
  assert.equal(c.measure, 'percent');
  assert.equal(c.estimate, 'off');
  assert.equal(c.width, DEFAULTS.width); // bad hand-edited value -> default
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ layout: 'compact', maxLabel: 50 }));
  assert.equal(loadConfig().statusText, 'paused'); // from the layout
  assert.equal(loadConfig().maxLabel, 50);         // the user's own key wins
  setConfig({});
});

test('setup config command: validates, renames, resets, writes refresh', () => {
  const settings = path.join(tmp, 'settings.json');
  const env = Object.assign({}, process.env, { PROMPT_BAR_SETTINGS: settings });
  const setup = (...a) => {
    try { return execFileSync(process.execPath, [path.join(SCRIPTS, 'setup.js'), ...a], { env }).toString(); }
    catch (e) { return e.stdout.toString(); }
  };
  setup('install');
  assert.match(setup('config', 'mode=tiem'), /invalid measure="tiem": must be one of/);
  assert.match(setup('config', 'style=dots', 'layout=compact'), /"style" is now "barStyle"/);
  assert.equal(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).barStyle, 'dots');
  setup('config', 'refresh=3');
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).statusLine.refreshInterval, 3);
  setup('config', 'reset');
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).statusLine.refreshInterval, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')), {});
  setConfig({});
});

// ---- end to end ----------------------------------------------------------

test('end-to-end: hooks print nothing, status line renders, prompt rotates log, history recorded', () => {
  const run = ([script, ...argv], input) => execFileSync(process.execPath, [path.join(SCRIPTS, script), ...argv], {
    input: JSON.stringify(input), env: process.env,
  }).toString();
  const sid = 'e2e-session';
  fs.mkdirSync(process.env.PROMPT_BAR_DATA_DIR, { recursive: true });
  setConfig({ color: false, measure: 'both' });
  assert.equal(run(['track.js', 'prompt'], { session_id: sid, cwd: '/e2e/project' }), '');
  assert.equal(run(['track.js', 'task_created'], { session_id: sid, task_id: '1', task_subject: 'Build it' }), '');
  assert.equal(run(['track.js', 'task_created'], { session_id: sid, task_id: '2', task_subject: 'Test it' }), '');
  assert.equal(run(['track.js', 'pre'], { session_id: sid, tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'npm test', description: 'Run tests' } }), '');
  assert.equal(run(['track.js', 'task_done'], { session_id: sid, task_id: '1' }), '');
  const line = run(['statusline.js'], { session_id: sid });
  assert.match(line, /50%/);
  assert.match(line, / \/ ~/); // task pace gives a time estimate
  assert.match(line, /1\/2/);
  assert.match(line, /Bash Run tests/);

  // Stop records this prompt's working time for its project.
  try { fs.unlinkSync(STATS_FILE); } catch (_) { /* none */ }
  run(['track.js', 'stop'], { session_id: sid });
  const st = loadStats();
  assert.equal(st.all.length, 1);
  assert.deepEqual(Object.keys(st.projects), ['/e2e/project']);

  // Next prompt: unfinished task list carries over, tool counters reset.
  run(['track.js', 'prompt'], { session_id: sid });
  const evs = fs.readFileSync(path.join(process.env.PROMPT_BAR_STATE_DIR, sid + '.jsonl'), 'utf8').trim().split('\n');
  assert.equal(evs.length, 3); // 2 carried tasks + prompt
  const line2 = run(['statusline.js'], { session_id: sid });
  assert.match(line2, /50%/);
  assert.doesNotMatch(line2, /tool/);

  run(['track.js', 'end'], { session_id: sid });
  assert.equal(run(['statusline.js'], { session_id: sid }), '');
  setConfig({});
});

test('malformed stdin never throws', () => {
  const out = execFileSync(process.execPath, [path.join(SCRIPTS, 'track.js'), 'pre'], { input: '{not json', env: process.env });
  assert.equal(out.toString(), '');
});

// ---- hook-level scenarios (real scripts, real files) ---------------------

const runScript = ([script, ...argv], input) => execFileSync(process.execPath, [path.join(SCRIPTS, script), ...argv], {
  input: JSON.stringify(input), env: process.env,
}).toString();
const logOf = (sid) => fs.readFileSync(path.join(process.env.PROMPT_BAR_STATE_DIR, sid + '.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const transcriptWith = (name, lines) => {
  const f = path.join(tmp, name + '.jsonl');
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return f;
};
const interruptEntry = (iso) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, timestamp: iso });

test('a message sent while Claude works is the same prompt: timer and counters carry on', () => {
  const sid = 'queued';
  runScript(['track.js', 'prompt'], { session_id: sid, cwd: '/q' });
  runScript(['track.js', 'pre'], { session_id: sid, tool_name: 'Read', tool_use_id: 'r1', tool_input: { file_path: 'a.js' } });
  runScript(['track.js', 'post'], { session_id: sid, tool_name: 'Read', tool_use_id: 'r1' });
  const before = logOf(sid);
  runScript(['track.js', 'prompt'], { session_id: sid, cwd: '/q', transcript_path: transcriptWith('t-queued', [{ type: 'user', timestamp: new Date().toISOString() }]) });
  const after = logOf(sid);
  assert.equal(after.length, before.length + 1, 'appended, not rotated');
  assert.equal(after[after.length - 1].e, 'note');
  assert.equal(reduce(after).toolsDone, 1);
  assert.equal(reduce(after).startedAt, before[0].t);
  runScript(['track.js', 'end'], { session_id: sid });
});

test('after Esc (no Stop fires), the next prompt is a genuinely new prompt', () => {
  const sid = 'esc-thinking';
  runScript(['track.js', 'prompt'], { session_id: sid });
  const started = logOf(sid)[0].t;
  const tr = transcriptWith('t-esc', [{ type: 'user', timestamp: new Date(started - 60000).toISOString() }, interruptEntry(new Date(started + 5).toISOString())]);
  // The status line notices the interrupt from the transcript alone.
  setConfig({ color: false });
  assert.match(runScript(['statusline.js'], { session_id: sid, transcript_path: tr }), /^⊘ interrupted/);
  runScript(['track.js', 'prompt'], { session_id: sid, transcript_path: tr });
  const log = logOf(sid);
  assert.equal(log.filter((e) => e.e === 'prompt').length, 1, 'rotated to a fresh prompt');
  assert.notEqual(log[log.length - 1].t, started);
  // An OLD interrupt (before this prompt) does not end the current one.
  assert.doesNotMatch(runScript(['statusline.js'], { session_id: sid, transcript_path: tr }), /interrupted/);
  setConfig({});
  runScript(['track.js', 'end'], { session_id: sid });
});

test('words "[Request interrupted by user" inside a tool result are not an interrupt', () => {
  const { lastInterruptAt } = require('../scripts/lib/transcript');
  const fake = { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: '[Request interrupted by user]' }] }] }, timestamp: new Date().toISOString() };
  assert.equal(lastInterruptAt(transcriptWith('t-fake', [fake])), 0);
  assert.ok(lastInterruptAt(transcriptWith('t-real', [interruptEntry(new Date().toISOString())])) > 0);
  assert.equal(lastInterruptAt(path.join(tmp, 'missing.jsonl')), 0);
});

test('Esc during a tool (is_interrupt) ends the prompt and is not saved to history', () => {
  const sid = 'esc-tool';
  try { fs.unlinkSync(STATS_FILE); } catch (_) { /* none */ }
  runScript(['track.js', 'prompt'], { session_id: sid });
  runScript(['track.js', 'pre'], { session_id: sid, tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'sleep 60' } });
  runScript(['track.js', 'fail'], { session_id: sid, tool_name: 'Bash', tool_use_id: 'b1', is_interrupt: true });
  assert.equal(reduce(logOf(sid)).phase, 'interrupted');
  runScript(['track.js', 'prompt'], { session_id: sid }); // next prompt: new, not "queued"
  assert.equal(logOf(sid).length, 1);
  assert.equal(loadStats().all.length, 0);
  runScript(['track.js', 'end'], { session_id: sid });
});

test('a prompt that continues after Stop is saved to history once, with its full time', () => {
  const sid = 'restop';
  try { fs.unlinkSync(STATS_FILE); } catch (_) { /* none */ }
  runScript(['track.js', 'prompt'], { session_id: sid, cwd: '/r' });
  runScript(['track.js', 'stop'], { session_id: sid });
  const first = loadStats().all[0];
  runScript(['track.js', 'pre'], { session_id: sid, tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: 'x.js' } });
  runScript(['track.js', 'post'], { session_id: sid, tool_name: 'Edit', tool_use_id: 'e1' });
  runScript(['track.js', 'stop'], { session_id: sid });
  const st = loadStats();
  assert.equal(st.all.length, 1, 'replaced, not added');
  assert.ok(st.all[0] >= first);
  runScript(['track.js', 'end'], { session_id: sid });
});

// ---- AI estimator --------------------------------------------------------

const ai = require('../scripts/lib/ai');
const { aiCalibration } = require('../scripts/lib/estimate');
const AI = Object.assign({}, DEFAULTS, { estimator: 'ai' });
const FREE = Object.assign({}, DEFAULTS, { estimator: 'free' });
const withAi = (extra = []) => reduce([{ t: 0, e: 'prompt', text: 'refactor auth' }, { t: 1, e: 'ai_req', n: 1 },
  { t: 2 * S, e: 'ai', ms: 120 * S, at: 0, n: 1 }, ...extra]);

test('AI estimate: used when there is no task pace, ranked above history', () => {
  const s = withAi();
  const p = estimateProgress(s, hist([10 * S, 10 * S, 10 * S, 900 * S, 900 * S, 900 * S]), 30 * S, AI);
  assert.equal(p.time.source, 'ai');
  assert.equal(p.time.totalMs, 120 * S);
  assert.match(render(s, p, Object.assign({}, cfg, { segments: 'time,source' }), 30 * S), /30s \/ ~2m00s · ~1m30s left \(ai\)/);
  assert.equal(estimateProgress(s, null, 30 * S, FREE).time, null, 'estimator=free ignores the AI answer');
});

test('measure=percent uses the AI estimate too, labelled as an estimate', () => {
  const c = Object.assign({}, AI, { measure: 'percent', color: false });
  const p = estimateProgress(withAi(), null, 30 * S, c);
  assert.deepEqual([p.pct, p.kind], [25, 'estimate']);
  assert.match(render(withAi(), p, c, 30 * S), /▕▒▒▒░+▏ ~25% est/);
});

test('AI estimate: task pace takes over once a task finishes in this prompt', () => {
  const s = withAi([{ t: 3, e: 'task', task: { id: '1', status: 'pending' } }, { t: 3, e: 'task', task: { id: '2', status: 'pending' } },
    { t: 20 * S, e: 'task', task: { id: '1', status: 'completed' } }]);
  assert.equal(estimateProgress(s, null, 25 * S, AI).time.source, 'tasks');
});

test('AI estimate: once passed it is not used, and a re-ask is due', () => {
  const s = withAi();
  assert.equal(estimateProgress(s, null, 130 * S, AI).time, null);
  assert.equal(ai.askReason(s, null, AI, 130 * S), 'passed');
});

test('AI calibration: corrects the AI by how far off it usually is for you', () => {
  const stats = { v: 3, all: [], projects: {}, ai: { all: [2, 2.2, 1.8], projects: {} } };
  assert.equal(aiCalibration(stats, '/x', DEFAULTS), 2);
  assert.equal(estimateProgress(withAi(), stats, 30 * S, AI).time.totalMs, 240 * S);
  assert.equal(aiCalibration({ ai: { all: [9, 9, 9], projects: {} } }, '', DEFAULTS), 4); // clamped
  assert.equal(aiCalibration({ ai: { all: [2, 2], projects: {} } }, '', DEFAULTS), 1);    // too few
});

test('askReason: start, pending, max calls, new message, free mode, not running, cooldown', () => {
  const fresh = reduce([{ t: 0, e: 'prompt' }]);
  assert.equal(ai.askReason(fresh, null, AI, 1), 'start');
  assert.equal(ai.askReason(fresh, null, FREE, 1), '');
  assert.equal(ai.askReason(reduce([{ t: 0, e: 'prompt' }, { t: 1, e: 'ai_req' }]), null, AI, 10 * S), '', 'pending');
  assert.equal(ai.askReason(withAi([{ t: 50 * S, e: 'note', text: 'also add tests' }]), null, AI, 60 * S), 'message');
  const maxed = withAi([{ t: 3, e: 'ai_req' }, { t: 4, e: 'ai_req' }, { t: 5, e: 'ai', ms: 10 * S, at: 0 }]);
  assert.equal(ai.askReason(maxed, null, AI, 500 * S), '', 'max 3 calls');
  assert.equal(ai.askReason(reduce([{ t: 0, e: 'prompt' }, { t: 1, e: 'stop' }]), null, AI, 2), '', 'not running');
  ai.startCooldown('Not logged in');
  assert.equal(ai.askReason(fresh, null, AI, Date.now()), '', 'cooling down');
  fs.unlinkSync(ai.COOLDOWN_FILE);
});

test('the AI question: prompt, messages, tasks and progress, clipped', () => {
  const s = reduce([{ t: 0, e: 'prompt', text: 'x'.repeat(5000), cwd: 'D:\\Code\\shop\\' },
    { t: 1, e: 'task', task: { id: '1', status: 'completed', subject: 'Read code' } }, { t: 1, e: 'task', task: { id: '2', status: 'pending', subject: 'Write tests' } },
    { t: 2 * S, e: 'post', tool: 'Read', id: 'r' }, { t: 3 * S, e: 'post', tool: 'Read', id: 'q' }, { t: 4 * S, e: 'note', text: 'use vitest' }]);
  const q = ai.buildQuestion(s, null, DEFAULTS, 40 * S);
  assert.ok(q.includes('x'.repeat(2000)) && !q.includes('x'.repeat(2001)), 'clipped to 2000 chars');
  assert.match(q, /use vitest/);
  assert.match(q, /Project folder: shop/);
  assert.match(q, /1\/2 done: \[x\] Read code; \[ \] Write tests/);
  assert.match(q, /So far: 40s of working time, tool calls: Read x2/);
  assert.equal(ai.parseSeconds('{"seconds": 95}'), 95);
  assert.equal(ai.parseSeconds('{"seconds": 1}'), 5);
  assert.equal(ai.parseSeconds('{"seconds": 999999}'), 14400);
  assert.equal(ai.parseSeconds('no idea'), null);
});

test('claude -p uses the Claude Code login with nothing loaded: no settings, tools, session or MCP', () => {
  const a = ai.claudeArgs(DEFAULTS);
  const val = (flag) => a[a.indexOf(flag) + 1];
  assert.equal(val('--model'), 'haiku');
  assert.equal(val('--setting-sources'), '');
  assert.equal(val('--tools'), '');
  for (const f of ['-p', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) assert.ok(a.includes(f), f);
  assert.ok(!a.includes('--bare'), '--bare needs an API key; the login must be used');
  assert.match(validate('aiModel', '--dangerously-skip-permissions'), /model alias/);
  assert.equal(validate('aiModel', 'claude-haiku-5-5'), null);
});

test('end-to-end AI: prompt, background worker, estimate on the line, calibration on stop', () => {
  const sid = 'ai-e2e';
  const callLog = path.join(tmp, 'fake-call.json');
  try { fs.unlinkSync(STATS_FILE); } catch (_) { /* none */ }
  setConfig({ estimator: 'ai', color: false, segments: 'status,time,source' });
  process.env.PB_FAKE_LOG = callLog;
  process.env.PB_FAKE_SECONDS = '150';
  try {
    runScript(['track.js', 'prompt'], { session_id: sid, prompt: 'build the checkout page', cwd: '/shop' });
    const got = waitFor(() => logOf(sid).find((e) => e.e === 'ai'));
    assert.ok(got, 'the worker wrote an AI estimate');
    assert.equal(got.ms, 150 * S);
    const call = JSON.parse(fs.readFileSync(callLog, 'utf8'));
    assert.match(call.input, /build the checkout page/);
    assert.equal(call.child, '1', 'the child is marked so PromptBar ignores it');
    assert.equal(call.args[call.args.indexOf('--setting-sources') + 1], '');
    assert.match(runScript(['statusline.js'], { session_id: sid }), / \/ ~2m30s · ~2m\d\ds left \(ai\)$/);
    // PromptBar's hook inside the child process does nothing.
    const before = logOf(sid).length;
    execFileSync(process.execPath, [path.join(SCRIPTS, 'track.js'), 'prompt'], {
      input: JSON.stringify({ session_id: sid }), env: Object.assign({}, process.env, { PROMPT_BAR_CHILD: '1' }),
    });
    assert.equal(logOf(sid).length, before);
    runScript(['track.js', 'stop'], { session_id: sid });
    const st = loadStats();
    assert.equal(st.ai.all.length, 1, 'actual vs AI ratio saved for calibration');
    assert.ok(st.ai.all[0] > 0 && st.ai.all[0] < 0.1);
  } finally {
    delete process.env.PB_FAKE_LOG;
    delete process.env.PB_FAKE_SECONDS;
    runScript(['track.js', 'end'], { session_id: sid });
    setConfig({});
  }
});

test('AI failure (logged out): falls back silently and pauses AI calls', () => {
  const sid = 'ai-fail';
  try { fs.unlinkSync(ai.COOLDOWN_FILE); } catch (_) { /* none */ }
  setConfig({ estimator: 'ai', color: false });
  process.env.PB_FAKE_MODE = 'login';
  try {
    runScript(['track.js', 'prompt'], { session_id: sid, prompt: 'hi' });
    assert.ok(waitFor(() => logOf(sid).find((e) => e.e === 'ai_fail')), 'failure recorded');
    assert.ok(ai.coolingDown(), 'login errors pause AI calls');
    assert.match(runScript(['statusline.js'], { session_id: sid }), /thinking/);
    runScript(['track.js', 'stop'], { session_id: sid });
    runScript(['track.js', 'prompt'], { session_id: sid, prompt: 'again' });
    assert.equal(logOf(sid).filter((e) => e.e === 'ai_req').length, 0, 'no new call while paused');
  } finally {
    delete process.env.PB_FAKE_MODE;
    try { fs.unlinkSync(ai.COOLDOWN_FILE); } catch (_) { /* none */ }
    runScript(['track.js', 'end'], { session_id: sid });
    setConfig({});
  }
});

test('estimator=free never starts the AI', () => {
  const sid = 'free-mode';
  runScript(['track.js', 'prompt'], { session_id: sid, prompt: 'hello' });
  runScript(['statusline.js'], { session_id: sid });
  assert.equal(logOf(sid).filter((e) => e.e.startsWith('ai')).length, 0);
  runScript(['track.js', 'end'], { session_id: sid });
});
