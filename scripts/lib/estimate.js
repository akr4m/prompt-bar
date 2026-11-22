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

function emptyStats() { return { v: 2, all: [], projects: {} }; }

function loadStats() {
  try {
    const s = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    // 0.1 kept a single moving average, which cannot become a list of durations: start fresh.
    if (s && s.v === 2 && Array.isArray(s.all) && s.projects && typeof s.projects === 'object') return s;
  } catch (_) { /* none yet */ }
  return emptyStats();
}

function push(list, ms, size) {
  list.push(Math.round(ms));
  while (list.length > size) list.shift();
  return list;
}

// Record one finished prompt's working time.
function recordRun(cwd, ms, cfg = DEFAULTS) {
  if (!(ms > 0)) return;
  const size = cfg.historySize;
  const s = loadStats();
  push(s.all, ms, size);
  const key = projectKey(cwd);
  if (key) {
    const list = s.projects[key] || [];
    delete s.projects[key]; // re-insert so key order = recency
    s.projects[key] = push(list, ms, size);
    const keys = Object.keys(s.projects);
    for (let i = 0; i < keys.length - MAX_PROJECTS; i++) delete s.projects[keys[i]];
  }
  ensureDir(DATA_DIR);
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(s)); } catch (_) { /* best effort */ }
}

function median(list) {
  if (!list || !list.length) return null;
  const a = list.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Typical working time of a prompt: this project's median once it has enough samples,
// otherwise the median across all projects, otherwise null (no guess).
function typicalMs(stats, cwd, cfg = DEFAULTS) {
  if (!stats) return null;
  const n = cfg.minSamples;
  if (cfg.historyScope === 'project') {
    const own = stats.projects && stats.projects[projectKey(cwd)];
    if (own && own.length >= n) return median(own);
  }
  return stats.all && stats.all.length >= n ? median(stats.all) : null;
}

/**
 * Estimated working time for the whole prompt.
 * @returns {{ totalMs: number, source: 'tasks'|'history' } | null}
 */
function estimateTotal(state, stats, cfg, now) {
  const src = cfg.estimate;
  if (src === 'off') return null;
  const active = activeMs(state, now);
  const t = state.todo;
  // Task pace: the time per finished task so far, times the number of tasks.
  if ((src === 'auto' || src === 'tasks') && t && t.total > 0 && t.done >= 1 && t.done < t.total && active > 0) {
    return { totalMs: (active / t.done) * t.total, source: 'tasks' };
  }
  if (src === 'auto' || src === 'history') {
    const typ = typicalMs(stats, state.cwd, cfg);
    if (typ > 0) return { totalMs: typ, source: 'history' };
  }
  return null;
}

/**
 * Everything the renderer needs about progress.
 * @returns {{ pct: number|null, kind: 'exact'|'estimate'|'none',
 *             time: null | { activeMs, totalMs, remainingMs, over, source } }}
 */
function estimateProgress(state, stats, now, cfg = DEFAULTS) {
  const active = activeMs(state, now);
  let time = null;
  if (state.phase !== 'done' && state.phase !== 'idle') {
    const est = estimateTotal(state, stats, cfg, now);
    if (est) {
      time = {
        activeMs: active,
        totalMs: est.totalMs,
        remainingMs: Math.max(0, est.totalMs - active),
        over: active > est.totalMs,
        source: est.source,
      };
    }
  }

  let pct = null;
  let kind = 'none';
  if (state.phase === 'done') { pct = 100; kind = 'exact'; }
  else if (state.todo && state.todo.total > 0) {
    pct = Math.round((100 * state.todo.done) / state.todo.total); kind = 'exact';
  } else if (time && time.source === 'history' && !time.over) {
    pct = Math.max(0, Math.min(EST_CAP, Math.round((100 * active) / time.totalMs))); kind = 'estimate';
  }
  return { pct, kind, time };
}

module.exports = {
  estimateProgress, estimateTotal, typicalMs, median, projectKey,
  loadStats, recordRun, STATS_FILE, EST_CAP,
};
