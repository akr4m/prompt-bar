'use strict';
// Progress estimation. Two sources, never mixed silently:
//   kind 'exact'    -> Claude's own todo list (completed / total). Measured, not guessed.
//   kind 'estimate' -> heuristic from this user's history. Rendered with a "~" + "est" label.
//   kind 'none'     -> not enough signal; renderer shows phase/activity only (no fake %).

const fs = require('fs');
const path = require('path');
const { DATA_DIR, ensureDir } = require('./state');

const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const MIN_SAMPLES = 3;   // don't estimate until we've seen a few prompts
const EST_CAP = 95;      // an estimate must never claim "done"

function loadStats() {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); }
  catch (_) { return { n: 0, avgTools: 0, avgMs: 0 }; }
}

// Exponential moving average so recent work style dominates, O(1) storage.
function recordRun(toolsDone, durationMs) {
  if (durationMs <= 0) return;
  const s = loadStats();
  const a = s.n < 10 ? 1 / (s.n + 1) : 0.1;
  s.avgTools = s.n ? s.avgTools + a * (toolsDone - s.avgTools) : toolsDone;
  s.avgMs = s.n ? s.avgMs + a * (durationMs - s.avgMs) : durationMs;
  s.n++;
  ensureDir(DATA_DIR);
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(s)); } catch (_) { /* best effort */ }
}

/**
 * Heuristic progress for prompts WITHOUT a todo list.
 * @param {object} state   reduced state (toolsDone, startedAt, running, phase, ...)
 * @param {object} stats   { n, avgTools, avgMs } historical moving averages
 * @param {number} now     epoch ms
 * @returns {number|null}  0..EST_CAP, or null to show no percentage at all
 */
function heuristicPct(state, stats, now) {
  if (!stats || stats.n < MIN_SAMPLES || !stats.avgTools || !stats.avgMs) return null;
  // TODO(you): turn history into an honest estimate. 5-10 lines.
  // Available signals: state.toolsDone vs stats.avgTools, (now - state.startedAt) vs stats.avgMs.
  // Return null when you'd rather show nothing than guess.
  return null;
}

function estimateProgress(state, stats, now) {
  if (state.phase === 'done') return { pct: 100, kind: 'exact' };
  if (state.todo && state.todo.total > 0) {
    return { pct: Math.round((100 * state.todo.done) / state.todo.total), kind: 'exact' };
  }
  const h = heuristicPct(state, stats, now);
  if (h == null || !Number.isFinite(h)) return { pct: null, kind: 'none' };
  return { pct: Math.max(0, Math.min(EST_CAP, Math.round(h))), kind: 'estimate' };
}

module.exports = { estimateProgress, heuristicPct, loadStats, recordRun, STATS_FILE, EST_CAP };
