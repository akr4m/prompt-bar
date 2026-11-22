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

const { reduce } = require('../scripts/lib/state');
const { estimateProgress } = require('../scripts/lib/estimate');
const { render, bar, fmtDuration } = require('../scripts/lib/render');
const { DEFAULTS } = require('../scripts/lib/config');

const cfg = Object.assign({}, DEFAULTS, { color: false });
const SCRIPTS = path.join(__dirname, '..', 'scripts');

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
  assert.deepEqual(estimateProgress(s, null, 10), { pct: 50, kind: 'exact' });
});

test('legacy TodoWrite snapshot', () => {
  const s = reduce([{ t: 1, e: 'prompt' }, { t: 2, e: 'post', tool: 'TodoWrite', id: 'a', todo: [3, 4, 'Polishing'] }]);
  assert.equal(estimateProgress(s, null, 3).pct, 75);
});

test('no signal -> no fake percentage', () => {
  const s = reduce([{ t: 1, e: 'prompt' }]);
  assert.deepEqual(estimateProgress(s, { n: 0 }, 5), { pct: null, kind: 'none' });
  assert.doesNotMatch(render(s, estimateProgress(s, null, 5), cfg, 5), /%/);
});

test('idle Notification after stop does not flip done -> waiting', () => {
  const s = reduce([{ t: 1, e: 'prompt' }, { t: 2, e: 'stop' }, { t: 3, e: 'wait' }]);
  assert.equal(s.phase, 'done');
});

test('StopFailure renders as error', () => {
  const s = reduce([{ t: 1, e: 'prompt' }, { t: 2, e: 'stop', err: 1 }]);
  assert.match(render(s, estimateProgress(s, null, 3), cfg, 3), /API error/);
});

test('bar widths are stable for every style', () => {
  for (const style of ['bar', 'blocks', 'dots', 'ascii']) {
    const c = Object.assign({}, cfg, { style, width: 10 });
    const lens = [0, 13, 50, 99, 100].map((p) => [...bar(p, 'exact', c, 0)].length);
    lens.push([...bar(null, 'none', c, 0)].length, [...bar(40, 'estimate', c, 0)].length);
    assert.equal(new Set(lens).size, 1, style + ' ' + lens);
  }
});

test('estimates are labeled', () => {
  const s = reduce([{ t: 1, e: 'prompt' }]);
  const out = render(s, { pct: 40, kind: 'estimate' }, cfg, 2);
  assert.match(out, /~40% est/);
});

test('fmtDuration', () => {
  assert.equal(fmtDuration(5400), '5s');
  assert.equal(fmtDuration(65000), '1m05s');
  assert.equal(fmtDuration(3723000), '1h02m');
});

test('end-to-end: hooks print nothing, status line renders, prompt rotates log', () => {
  const run = ([script, ...argv], input) => execFileSync(process.execPath, [path.join(SCRIPTS, script), ...argv], {
    input: JSON.stringify(input), env: process.env,
  }).toString();
  const sid = 'e2e-session';
  assert.equal(run(['track.js', 'prompt'], { session_id: sid }), '');
  assert.equal(run(['track.js', 'task_created'], { session_id: sid, task_id: '1', task_subject: 'Build it' }), '');
  assert.equal(run(['track.js', 'task_created'], { session_id: sid, task_id: '2', task_subject: 'Test it' }), '');
  assert.equal(run(['track.js', 'pre'], { session_id: sid, tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'bun test', description: 'Run tests' } }), '');
  assert.equal(run(['track.js', 'task_done'], { session_id: sid, task_id: '1' }), '');
  fs.mkdirSync(process.env.PROMPT_BAR_DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.PROMPT_BAR_DATA_DIR, 'config.json'), JSON.stringify({ color: false }));
  const line = run(['statusline.js'], { session_id: sid });
  assert.match(line, /50%/);
  assert.match(line, /1\/2/);
  assert.match(line, /Bash Run tests/);

  // Next prompt: unfinished task list carries over, tool counters reset.
  run(['track.js', 'stop'], { session_id: sid });
  run(['track.js', 'prompt'], { session_id: sid });
  const evs = fs.readFileSync(path.join(process.env.PROMPT_BAR_STATE_DIR, sid + '.jsonl'), 'utf8').trim().split('\n');
  assert.equal(evs.length, 3); // 2 carried tasks + prompt
  const line2 = run(['statusline.js'], { session_id: sid });
  assert.match(line2, /50%/);
  assert.doesNotMatch(line2, /tool/);

  run(['track.js', 'end'], { session_id: sid });
  assert.equal(run(['statusline.js'], { session_id: sid }), '');
});

test('malformed stdin never throws', () => {
  const out = execFileSync(process.execPath, [path.join(SCRIPTS, 'track.js'), 'pre'], { input: '{not json', env: process.env });
  assert.equal(out.toString(), '');
});
