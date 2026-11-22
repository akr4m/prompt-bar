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
    cwd: '',            // project folder of the prompt (per-project history)
    waitMs: 0,          // time spent waiting for the user (excluded from estimates)
    waitingSince: 0,    // start of the current wait, 0 when not waiting
    doneHere: 0,        // tasks completed during THIS prompt (carried-over ones don't count)
    doneActive: 0,      // working time (ms) at the moment the last of them was completed
    text: '',           // the prompt (first 2000 chars), for the AI estimator
    notes: [],          // messages the user sent while Claude was working: [{ t, text }]
    toolCounts: {},     // finished tool calls by tool name
    aiReqs: 0,          // AI estimate requests made for this prompt
    aiPendingSince: 0,  // time of the request still waiting for an answer, 0 if none
    ai: null,           // latest AI answer: { remMs, at (working ms when asked), t, n }
    aiFirst: null,      // the first AI answer (used to calibrate the AI against reality)
  };
  // Record a task completion that happened during the current prompt.
  const markDone = (t, n = 1) => {
    if (s.phase === 'idle' || t < s.startedAt || n <= 0) return;
    s.doneHere += n;
    s.doneActive = Math.max(0, t - s.startedAt - s.waitMs);
  };
  const finished = new Set(); // async hooks may log a post before its pre
  let anon = 0;
  // Async hooks can land out of order; timestamps are taken at hook start.
  const sorted = events.slice().sort((a, b) => (a.t || 0) - (b.t || 0));
  // Tools that block on the user: their running time is waiting, not working.
  const WAIT_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
  const ended = () => s.phase === 'done' || s.phase === 'interrupted';
  let beforeCompact = '';
  for (const ev of sorted) {
    // AI estimate events are PromptBar's own bookkeeping, not Claude's activity.
    if (AI_EVENTS.has(ev.e)) { applyAi(s, ev); continue; }
    s.lastEventAt = ev.t || s.lastEventAt;
    // Any activity other than a new wait ends the current wait.
    const startsWait = ev.e === 'wait' || (ev.e === 'pre' && WAIT_TOOLS.has(ev.tool));
    if (s.waitingSince && !startsWait && ev.e !== 'prompt' && ev.e !== 'note') {
      s.waitMs += Math.max(0, ev.t - s.waitingSince);
      s.waitingSince = 0;
    }
    // A new tool call after Stop means Claude kept going (e.g. another plugin's Stop hook
    // blocked the stop): reopen the same prompt. The gap is not counted as working time.
    if (ev.e === 'pre' && ended() && s.endedAt && ev.t > s.endedAt) {
      s.waitMs += ev.t - s.endedAt;
      s.phase = 'thinking'; s.endedAt = 0; s.error = false;
    }
    switch (ev.e) {
      case 'prompt':
        s.phase = 'thinking';
        s.startedAt = ev.t; s.endedAt = 0; s.error = false;
        s.toolsDone = 0; s.toolsFailed = 0;
        s.running.clear(); s.lastTool = null; s.todo = null; s.subagents = 0;
        s.cwd = ev.cwd || ''; s.waitMs = 0; s.waitingSince = 0; s.doneHere = 0; s.doneActive = 0;
        s.text = ev.text || ''; s.notes = []; s.toolCounts = {};
        s.aiReqs = 0; s.aiPendingSince = 0; s.ai = null; s.aiFirst = null;
        finished.clear();
        break;
      case 'pre': {
        if (ev.id && finished.has(ev.id)) break;
        const id = ev.id || 'anon' + (anon++);
        s.running.set(id, { tool: ev.tool, label: ev.label, t: ev.t });
        s.lastTool = { tool: ev.tool, label: ev.label };
        if (!ended()) s.phase = WAIT_TOOLS.has(ev.tool) ? 'waiting' : 'tool';
        if (WAIT_TOOLS.has(ev.tool) && !s.waitingSince && s.phase === 'waiting') s.waitingSince = ev.t;
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
        if (ev.tool) s.toolCounts[ev.tool] = (s.toolCounts[ev.tool] || 0) + 1;
        if (ev.todo) {
          // The first snapshot of a prompt is the baseline; later ones count new completions.
          if (s.todo) markDone(ev.t, ev.todo[0] - s.todo.done);
          s.todo = { done: ev.todo[0], total: ev.todo[1], active: ev.todo[2] || '' };
        }
        if (ev.task && applyTask(s, ev.task)) markDone(ev.t);
        if (!ended() && s.phase !== 'compacting') s.phase = s.running.size ? 'tool' : 'thinking';
        break;
      }
      case 'interrupt':
        // The user pressed Esc. The prompt ends here and is not used as history.
        if (ev.id) { finished.add(ev.id); s.running.delete(ev.id); }
        if (s.phase !== 'idle' && !ended()) {
          s.phase = 'interrupted'; s.endedAt = ev.t; s.running.clear(); s.subagents = 0;
        }
        break;
      case 'note': // a message sent while Claude was working: same prompt continues
        if (ev.text) s.notes.push({ t: ev.t, text: ev.text });
        break;
      case 'task': if (applyTask(s, ev.task)) markDone(ev.t); break;
      case 'sub_start': s.subagents++; break;
      case 'sub_stop': s.subagents = Math.max(0, s.subagents - 1); break;
      case 'wait':
        if (!ended() && s.phase !== 'idle') {
          s.phase = 'waiting';
          if (!s.waitingSince) s.waitingSince = ev.t;
        }
        break;
      case 'compact':
        if (s.phase !== 'idle' && s.phase !== 'compacting') { beforeCompact = s.phase; s.phase = 'compacting'; }
        break;
      case 'compacted':
        // A /compact between prompts returns to "done"; one during a prompt resumes it.
        if (s.phase === 'compacting') {
          s.phase = beforeCompact === 'done' || beforeCompact === 'interrupted' ? beforeCompact : 'thinking';
        }
        break;
      case 'stop':
        s.phase = 'done'; s.endedAt = ev.t; s.running.clear(); s.subagents = 0;
        s.error = !!ev.err;
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

// Claude's working time so far: wall clock minus time spent waiting for the user.
function activeMs(s, now) {
  if (s.phase === 'idle') return 0;
  const end = s.endedAt || now;
  const openWait = s.waitingSince ? Math.max(0, end - s.waitingSince) : 0;
  return Math.max(0, end - s.startedAt - s.waitMs - openWait);
}

const AI_EVENTS = new Set(['ai_req', 'ai', 'ai_fail']);

// ai_req: a request was sent. ai: its answer { ms = remaining working ms, at }. ai_fail: none.
function applyAi(s, ev) {
  if (s.phase === 'idle' || ev.t < s.startedAt) return; // belongs to an earlier prompt
  if (ev.e === 'ai_req') { s.aiReqs++; s.aiPendingSince = ev.t; return; }
  s.aiPendingSince = 0;
  if (ev.e === 'ai' && ev.ms > 0) {
    s.ai = { remMs: ev.ms, at: ev.at || 0, t: ev.t, n: ev.n || s.aiReqs };
    if (!s.aiFirst) s.aiFirst = s.ai;
  }
}

// Returns true when this update newly completes the task.
function applyTask(s, t) {
  if (!t || !t.id) return false;
  const cur = s.tasks.get(t.id) || { id: t.id, status: 'pending', subject: '', form: '' };
  const completes = t.status === 'completed' && cur.status !== 'completed';
  if (t.status) cur.status = t.status;
  if (t.subject) cur.subject = t.subject;
  if (t.form) cur.form = t.form;
  s.tasks.set(t.id, cur);
  return completes;
}

module.exports = { STATE_DIR, DATA_DIR, logPath, ensureDir, readEvents, reduce, activeMs, safeId };
