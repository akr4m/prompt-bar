'use strict';
// Shared paths + the event-log reducer.
// Hooks APPEND compact JSON lines to <stateDir>/<session>.jsonl (race-free for
// parallel tool calls); the status line REDUCES that log into a progress state.

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = process.env.PROMPT_BAR_STATE_DIR || path.join(os.tmpdir(), 'prompt-bar');
const DATA_DIR = process.env.PROMPT_BAR_DATA_DIR || path.join(os.homedir(), '.claude', 'prompt-bar');

function safeId(id) {
  return String(id || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

function logPath(sessionId) {
  return path.join(STATE_DIR, safeId(sessionId) + '.jsonl');
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* exists */ }
}

function readEvents(sessionId) {
  let raw;
  try { raw = fs.readFileSync(logPath(sessionId), 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch (_) { /* torn line: skip */ }
  }
  return out;
}

// Fold events into a progress state. Pure function -> easy to unit test.
function reduce(events) {
  const s = {
    phase: 'idle',      // idle | thinking | tool | waiting | compacting | done | interrupted
    startedAt: 0,
    endedAt: 0,
    lastEventAt: 0,
    toolsDone: 0,
    toolsFailed: 0,
    running: new Map(), // tool_use_id -> { tool, label, t }
    lastTool: null,     // { tool, label }
    todo: null,         // { done, total, active } - legacy TodoWrite snapshot
    tasks: new Map(),   // task_id -> { id, status, subject, form } - Task tools / TaskCreated hooks
    subagents: 0,
    error: false,
  };
  const finished = new Set(); // async hooks may log a post before its pre
  let anon = 0;
  // Async hooks can land out of order; timestamps are taken at hook start.
  const sorted = events.slice().sort((a, b) => (a.t || 0) - (b.t || 0));
  for (const ev of sorted) {
    s.lastEventAt = ev.t || s.lastEventAt;
    switch (ev.e) {
      case 'prompt':
        s.phase = 'thinking';
        s.startedAt = ev.t; s.endedAt = 0; s.error = false;
        s.toolsDone = 0; s.toolsFailed = 0;
        s.running.clear(); s.lastTool = null; s.todo = null; s.subagents = 0;
        finished.clear();
        break;
      case 'pre': {
        if (ev.id && finished.has(ev.id)) break;
        const id = ev.id || 'anon' + (anon++);
        s.running.set(id, { tool: ev.tool, label: ev.label, t: ev.t });
        s.lastTool = { tool: ev.tool, label: ev.label };
        if (s.phase !== 'done') s.phase = 'tool';
        break;
      }
      case 'post':
      case 'fail': {
        if (ev.id) finished.add(ev.id);
        if (ev.id && s.running.has(ev.id)) s.running.delete(ev.id);
        else if (!ev.id) {
          for (const [k, v] of s.running) { if (v.tool === ev.tool) { s.running.delete(k); break; } }
        }
        if (ev.e === 'fail') s.toolsFailed++; else s.toolsDone++;
        if (ev.todo) s.todo = { done: ev.todo[0], total: ev.todo[1], active: ev.todo[2] || '' };
        if (ev.task) applyTask(s, ev.task);
        if (s.phase !== 'done') s.phase = s.running.size ? 'tool' : 'thinking';
        break;
      }
      case 'task': applyTask(s, ev.task); break;
      case 'sub_start': s.subagents++; break;
      case 'sub_stop': s.subagents = Math.max(0, s.subagents - 1); break;
      case 'wait': if (s.phase !== 'done' && s.phase !== 'idle') s.phase = 'waiting'; break;
      case 'compact': if (s.phase !== 'idle') s.phase = 'compacting'; break;
      case 'compacted': if (s.phase === 'compacting') s.phase = 'thinking'; break;
      case 'stop':
        s.phase = 'done'; s.endedAt = ev.t; s.running.clear(); s.subagents = 0;
        if (ev.err) s.error = true;
        break;
      default: break;
    }
  }
  // Task tools win over TodoWrite when both exist (they're the newer mechanism).
  const live = [...s.tasks.values()].filter((x) => x.status !== 'deleted');
  if (live.length) {
    const act = live.find((x) => x.status === 'in_progress');
    s.todo = {
      done: live.filter((x) => x.status === 'completed').length,
      total: live.length,
      active: act ? (act.form || act.subject || '') : '',
    };
  }
  return s;
}

function applyTask(s, t) {
  if (!t || !t.id) return;
  const cur = s.tasks.get(t.id) || { id: t.id, status: 'pending', subject: '', form: '' };
  if (t.status) cur.status = t.status;
  if (t.subject) cur.subject = t.subject;
  if (t.form) cur.form = t.form;
  s.tasks.set(t.id, cur);
}

module.exports = { STATE_DIR, DATA_DIR, logPath, ensureDir, readEvents, reduce, safeId };
