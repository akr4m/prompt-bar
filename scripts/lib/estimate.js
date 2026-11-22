'use strict';
// Estimates. Every number is either measured or labelled as an estimate:
//   progress kind 'exact'    -> Claude's own task list (completed / total).
//   progress kind 'estimate' -> working time vs the typical prompt from history ("~NN% est").
//   progress kind 'none'     -> not enough signal; the renderer shows a pulse, no number.
//   time { totalMs, source }  -> estimated working time for the whole prompt, from the
//                                task pace ('tasks') or the history median ('history').
// "Working time" excludes time spent waiting for the user (see state.activeMs).

const fs = require('fs');
const path = require('path');
const { DATA_DIR, ensureDir, activeMs } = require('./state');
const { DEFAULTS } = require('./config');

const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const EST_CAP = 95;        // a history estimate must never claim "done"
const MAX_PROJECTS = 100;  // bound stats.json; least recently used projects are dropped

// Same folder, same key, whatever the slash direction or (on Windows) letter case.
function projectKey(cwd) {
  if (!cwd) return '';
  const k = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? k.toLowerCase() : k;
}

// v3: 0.1 kept one moving average (v1), and 0.2.0 (v2) recorded only the part of a prompt
// after the user's last mid-turn message. Neither is a fair duration, so start fresh.
const VERSION = 3;
function emptyStats() { return { v: VERSION, all: [], projects: {}, last: null }; }

function loadStats() {
  try {
    const s = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    if (s && s.v === VERSION && Array.isArray(s.all) && s.projects && typeof s.projects === 'object') return s;
  } catch (_) { /* none yet */ }
  return emptyStats();
}

function push(list, value, size) {
  list.push(value);
  while (list.length > size) list.shift();
  return list;
}

// Add a value to a { all, projects } bucket, keeping the last `size` values per list.
function addSample(bucket, key, value, size) {
  push(bucket.all, value, size);
  if (!key) return;
  const list = bucket.projects[key] || [];
  delete bucket.projects[key]; // re-insert so key order = recency
  bucket.projects[key] = push(list, value, size);
  const keys = Object.keys(bucket.projects);
  for (let i = 0; i < keys.length - MAX_PROJECTS; i++) delete bucket.projects[keys[i]];
}

// Record one finished prompt's working time. `id` identifies the prompt: when Claude keeps
// working after a Stop (another plugin's Stop hook can force that) the same prompt stops
// again, and its earlier entry is replaced instead of counted twice.
// `aiRatio` (optional) = actual remaining time / the AI's first estimate of it, used to
// calibrate future AI estimates to this user.
function recordRun(cwd, ms, cfg = DEFAULTS, id = '', aiRatio = 0) {
  if (!(ms > 0)) return;
  const size = cfg.historySize;
  const s = loadStats();
  if (!s.ai) s.ai = { all: [], projects: {} };
  const key = projectKey(cwd);
  if (id && s.last && s.last.id === id) {
    s.all.pop();
    if (s.last.key && s.projects[s.last.key]) s.projects[s.last.key].pop();
    if (s.last.ai) {
      s.ai.all.pop();
      if (s.last.key && s.ai.projects[s.last.key]) s.ai.projects[s.last.key].pop();
    }
  }
  addSample(s, key, Math.round(ms), size);
  const hasAi = aiRatio > 0 && Number.isFinite(aiRatio);
  if (hasAi) addSample(s.ai, key, Math.round(aiRatio * 1000) / 1000, size);
  s.last = id ? { id, key, ai: hasAi } : null;
  ensureDir(DATA_DIR);
  // Write-then-rename, so two sessions finishing at once never leave a torn file.
  const tmp = STATS_FILE + '.' + process.pid + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(s)); fs.renameSync(tmp, STATS_FILE); }
  catch (_) { try { fs.unlinkSync(tmp); } catch (__) { /* ignore */ } }
}

function median(list) {
  if (!list || !list.length) return null;
  const a = list.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Typical working time of a prompt that has ALREADY run `sofarMs`: the median of past
// prompts that lasted longer than that. Re-evaluated every redraw, so the estimate keeps
// updating: once a prompt outlasts quick replies, they stop counting.
// This project's history first, then all projects; null when too few prompts qualify.
function typicalMs(stats, cwd, cfg = DEFAULTS, sofarMs = 0) {
  if (!stats) return null;
  const n = cfg.minSamples;
  const longer = (list) => (list || []).filter((ms) => ms > sofarMs);
  if (cfg.historyScope === 'project') {
    const own = longer(stats.projects && stats.projects[projectKey(cwd)]);
    if (own.length >= n) return median(own);
  }
  const all = longer(stats.all);
  return all.length >= n ? median(all) : null;
}

// How far off the AI usually is for this user: the median of actual / estimated over past
// prompts (this project first, then all), limited to 0.25x-4x. 1 until there is enough data.
function aiCalibration(stats, cwd, cfg = DEFAULTS) {
  const ai = stats && stats.ai;
  if (!ai) return 1;
  const own = cfg.historyScope === 'project' && ai.projects ? ai.projects[projectKey(cwd)] : null;
  const list = own && own.length >= cfg.minSamples ? own : ai.all;
  if (!list || list.length < cfg.minSamples) return 1;
  return Math.max(0.25, Math.min(4, median(list)));
}

// The AI's estimate as a total working time: when it was asked + its answer, calibrated.
function aiTotalMs(state, stats, cfg) {
  if (!state.ai) return null;
  return state.ai.at + state.ai.remMs * aiCalibration(stats, state.cwd, cfg);
}

/**
 * Estimated working time for the whole prompt, recomputed on every redraw.
 * Order: task pace (measured in this prompt) > AI estimate (if estimator=ai) > history.
 * @returns {{ totalMs: number, source: 'tasks'|'ai'|'history' } | null}
 */
function estimateTotal(state, stats, cfg, now) {
  const src = cfg.estimate;
  if (src === 'off') return null;
  const active = activeMs(state, now);
  const t = state.todo;
  // Task pace, from tasks finished in THIS prompt only.
  if ((src === 'auto' || src === 'tasks') && t && t.total > t.done && state.doneHere >= 1 && state.doneActive > 0) {
    const pace = state.doneActive / state.doneHere;     // working time per finished task
    const current = Math.max(0, active - state.doneActive); // time on the task in progress
    // Count the current task down from the pace. Once it is past 2/3 of the pace, assume
    // it needs half as long again as it has taken so far: the two meet at 2/3, so the
    // number moves smoothly, and a slow task keeps a real "left" instead of stalling at 0.
    const currentLeft = Math.max(pace - current, current / 2);
    const left = currentLeft + (t.total - t.done - 1) * pace;
    return { totalMs: active + left, source: 'tasks' };
  }
  // The AI's answer, while the prompt hasn't passed it (once passed, it is asked again).
  if (src === 'auto' && cfg.estimator === 'ai') {
    const total = aiTotalMs(state, stats, cfg);
    if (total > active) return { totalMs: total, source: 'ai' };
  }
  if (src === 'auto' || src === 'history') {
    const typ = typicalMs(stats, state.cwd, cfg, active);
    if (typ > 0) return { totalMs: typ, source: 'history' };
  }
  return null;
}

/**
 * Everything the renderer needs about progress.
 * @returns {{ pct: number|null, kind: 'exact'|'estimate'|'none',
 *             time: null | { activeMs, totalMs, remainingMs, source } }}
 * Both estimators return a total above the working time so far (history only uses
 * prompts that ran longer; task pace adds the remaining tasks), so "remaining" is > 0.
 */
function estimateProgress(state, stats, now, cfg = DEFAULTS) {
  const active = activeMs(state, now);
  const ended = state.phase === 'done' || state.phase === 'interrupted' || state.phase === 'idle';
  let time = null;
  if (!ended) {
    const est = estimateTotal(state, stats, cfg, now);
    if (est) time = { activeMs: active, totalMs: est.totalMs, remainingMs: est.totalMs - active, source: est.source };
  }

  let pct = null;
  let kind = 'none';
  if (state.phase === 'done') { pct = 100; kind = 'exact'; }
  else if (state.phase === 'interrupted') { /* no amount: it did not finish */ }
  else if (state.todo && state.todo.total > 0) {
    pct = Math.round((100 * state.todo.done) / state.todo.total); kind = 'exact';
  } else if (time && time.source === 'history') {
    pct = Math.max(0, Math.min(EST_CAP, Math.round((100 * active) / time.totalMs))); kind = 'estimate';
  }
  return { pct, kind, time };
}

module.exports = {
  estimateProgress, estimateTotal, typicalMs, median, projectKey, aiCalibration, aiTotalMs,
  loadStats, recordRun, STATS_FILE, EST_CAP,
};
