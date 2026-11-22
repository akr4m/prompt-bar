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
const { render, bar, fmtDuration } = require('../scripts/lib/render');
const { DEFAULTS, LAYOUTS, loadConfig, validate, CONFIG_FILE } = require('../scripts/lib/config');

const cfg = Object.assign({}, DEFAULTS, { color: false });
const SCRIPTS = path.join(__dirname, '..', 'scripts');
const S = 1000;
const hist = (list) => ({ v: 2, all: list, projects: {} });
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

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

test('task pace: working time / done * total, and it beats history', () => {
  const s = reduce([{ t: 0, e: 'prompt' },
    { t: 1, e: 'task', task: { id: '1', status: 'completed' } }, { t: 1, e: 'task', task: { id: '2', status: 'completed' } },
    { t: 1, e: 'task', task: { id: '3', status: 'pending' } }, { t: 1, e: 'task', task: { id: '4', status: 'pending' } }]);
  const p = estimateProgress(s, hist([999 * S, 999 * S, 999 * S]), 50 * S, DEFAULTS);
  assert.equal(p.time.source, 'tasks');
  assert.equal(p.time.totalMs, 100 * S);
  assert.equal(p.time.remainingMs, 50 * S);
  assert.match(render(s, p, cfg, 50 * S), /50s \/ ~1m40s · ~50s left/);
  // estimate=history ignores the task pace; estimate=off gives no time at all.
  assert.equal(estimateProgress(s, hist([60 * S, 60 * S, 60 * S]), 50 * S, Object.assign({}, DEFAULTS, { estimate: 'history' })).time.source, 'history');
  assert.equal(estimateProgress(s, hist([60 * S, 60 * S, 60 * S]), 50 * S, Object.assign({}, DEFAULTS, { estimate: 'off' })).time, null);
});

test('history median is used without a task pace, and outliers barely move it', () => {
  assert.equal(median([10, 20, 30, 600]), 25);
  assert.equal(median([10, 20, 30]), 20);
  const s = reduce([{ t: 0, e: 'prompt' }]);
  const p = estimateProgress(s, hist([60 * S, 80 * S, 100 * S, 3600 * S]), 30 * S, DEFAULTS);
  assert.equal(p.time.source, 'history');
  assert.equal(p.time.totalMs, 90 * S);
  assert.match(render(s, p, cfg, 30 * S), /30s \/ ~1m30s · ~1m00s left/);
});

test('no estimate before minSamples prompts of history', () => {
  const s = reduce([{ t: 0, e: 'prompt' }]);
  assert.equal(estimateProgress(s, hist([60 * S, 60 * S]), 10 * S, DEFAULTS).time, null);
  assert.ok(estimateProgress(s, hist([60 * S, 60 * S]), 10 * S, Object.assign({}, DEFAULTS, { minSamples: 2 })).time);
});

test('per-project history, falling back to all projects', () => {
  const stats = { v: 2, all: [10 * S, 10 * S, 10 * S, 99 * S], projects: { 'd:/big': [200 * S, 200 * S, 200 * S], 'd:/new': [5 * S] } };
  const big = process.platform === 'win32' ? 'D:\\big\\' : 'd:/big/';
  assert.equal(typicalMs(stats, big, DEFAULTS), 200 * S);
  assert.equal(typicalMs(stats, 'd:/new', DEFAULTS), 10 * S); // too few samples -> all projects
  assert.equal(typicalMs(stats, 'd:/big', Object.assign({}, DEFAULTS, { historyScope: 'global' })), 10 * S);
});

test('recordRun keeps the last historySize prompts; 0.1 stats are replaced', () => {
  try { fs.unlinkSync(STATS_FILE); } catch (_) { /* none */ }
  const c = Object.assign({}, DEFAULTS, { historySize: 3 });
  for (const n of [1, 2, 3, 4, 5]) recordRun('/proj', n * S, c);
  const st = loadStats();
  assert.deepEqual(st.all, [3 * S, 4 * S, 5 * S]);
  assert.deepEqual(Object.values(st.projects)[0], [3 * S, 4 * S, 5 * S]);
  fs.writeFileSync(STATS_FILE, JSON.stringify({ n: 4, avgTools: 1, avgMs: 6764 }));
  assert.deepEqual(loadStats(), { v: 2, all: [], projects: {} });
  fs.unlinkSync(STATS_FILE);
});

test('over the estimate: no countdown, an honest note, a pulse bar', () => {
  const s = reduce([{ t: 0, e: 'prompt' }]);
  const p = estimateProgress(s, hist([60 * S, 60 * S, 60 * S]), 130 * S, DEFAULTS);
  assert.equal(p.time.over, true);
  const out = render(s, p, cfg, 130 * S);
  assert.match(out, /2m10s · over est ~1m00s/);
  assert.doesNotMatch(out, /left|█/);
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
  fs.unlinkSync(CONFIG_FILE);
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
});

// ---- end to end ----------------------------------------------------------

test('end-to-end: hooks print nothing, status line renders, prompt rotates log, history recorded', () => {
  const run = ([script, ...argv], input) => execFileSync(process.execPath, [path.join(SCRIPTS, script), ...argv], {
    input: JSON.stringify(input), env: process.env,
  }).toString();
  const sid = 'e2e-session';
  fs.mkdirSync(process.env.PROMPT_BAR_DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ color: false, measure: 'both' }));
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
  fs.unlinkSync(CONFIG_FILE);
});

test('malformed stdin never throws', () => {
  const out = execFileSync(process.execPath, [path.join(SCRIPTS, 'track.js'), 'pre'], { input: '{not json', env: process.env });
  assert.equal(out.toString(), '');
});
