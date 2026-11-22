#!/usr/bin/env node
'use strict';
// Hook handler. Usage: node track.js <event>
// Appends ONE compact JSON line to the session log and prints NOTHING to stdout,
// so it adds zero tokens to Claude's context.

const fs = require('fs');
const path = require('path');
const { STATE_DIR, logPath, ensureDir, readEvents, reduce, activeMs } = require('./lib/state');
const { lastInterruptAt } = require('./lib/transcript');

const kind = process.argv[2] || '';

function label(tool, inp) {
  if (!inp || typeof inp !== 'object') return '';
  const base = (p) => (p ? path.basename(String(p)) : '');
  switch (tool) {
    case 'Bash': case 'PowerShell': return inp.description || inp.command || '';
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': return base(inp.file_path);
    case 'NotebookEdit': return base(inp.notebook_path);
    case 'Grep': case 'Glob': return inp.pattern || '';
    case 'WebFetch': try { return new URL(inp.url).host; } catch (_) { return ''; }
    case 'WebSearch': return inp.query || '';
    case 'Task': case 'Agent': return inp.description || inp.subagent_type || '';
    case 'Skill': return inp.skill || '';
    default:
      if (tool && tool.startsWith('mcp__')) return tool.split('__').slice(1).join(':');
      return '';
  }
}

// Legacy TodoWrite: full list each call -> [done, total, activeForm].
function todoSnapshot(inp) {
  const todos = inp && Array.isArray(inp.todos) ? inp.todos : null;
  if (!todos || !todos.length) return null;
  const done = todos.filter((t) => t && t.status === 'completed').length;
  const act = todos.find((t) => t && t.status === 'in_progress');
  return [done, todos.length, act ? String(act.activeForm || act.content || '').slice(0, 60) : ''];
}

// Map a hook payload to a compact event (or null to skip).
function toEvent(k, p) {
  const t = Date.now();
  const tool = p.tool_name;
  switch (k) {
    case 'prompt': {
      const ev = { t, e: 'prompt' };
      if (p.cwd) ev.cwd = String(p.cwd);
      if (p.prompt) ev.text = String(p.prompt).slice(0, 2000); // kept locally for the AI estimator
      return ev;
    }
    case 'pre': return { t, e: 'pre', tool, id: p.tool_use_id, label: String(label(tool, p.tool_input)).slice(0, 60) };
    case 'post': {
      const ev = { t, e: 'post', tool, id: p.tool_use_id };
      if (tool === 'TodoWrite') { const s = todoSnapshot(p.tool_input); if (s) ev.todo = s; }
      if (tool === 'TaskUpdate' && p.tool_input) {
        const i = p.tool_input;
        const tid = i.taskId || i.task_id || i.id;
        if (tid && i.status) ev.task = { id: String(tid), status: i.status, form: String(i.activeForm || '').slice(0, 60) };
      }
      return ev;
    }
    // Esc while a tool runs arrives as a failure flagged is_interrupt: the prompt ended.
    case 'fail': return p.is_interrupt ? { t, e: 'interrupt', tool, id: p.tool_use_id } : { t, e: 'fail', tool, id: p.tool_use_id };
    case 'task_created': return { t, e: 'task', task: { id: String(p.task_id || ''), status: 'pending', subject: String(p.task_subject || '').slice(0, 60) } };
    case 'task_done': return { t, e: 'task', task: { id: String(p.task_id || ''), status: 'completed' } };
    case 'sub_start': return { t, e: 'sub_start' };
    case 'sub_stop': return { t, e: 'sub_stop' };
    case 'wait': return { t, e: 'wait' };
    case 'compact': return { t, e: 'compact' };
    case 'compacted': return { t, e: 'compacted' };
    case 'stop': return { t, e: 'stop' };
    case 'stop_fail': return { t, e: 'stop', err: 1 };
    case 'end': return { t, e: 'end' };
    default: return null;
  }
}

// On a new prompt, rewrite the log as: carried-over open task list + prompt.
// This keeps the log O(current prompt) so the status line stays cheap to read.
function rotate(sessionId, ev) {
  const prev = reduce(readEvents(sessionId));
  const lines = [];
  const tasks = [...prev.tasks.values()];
  if (tasks.some((x) => x.status !== 'completed' && x.status !== 'deleted')) {
    for (const x of tasks) lines.push(JSON.stringify({ t: ev.t - 1, e: 'task', task: x }));
  }
  lines.push(JSON.stringify(ev));
  const file = logPath(sessionId);
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n') + '\n');
  fs.renameSync(tmp, file);
}

const RUNNING = new Set(['thinking', 'tool', 'waiting', 'compacting']);
const STALE_MS = 30 * 60 * 1000; // no event for this long: the old prompt was abandoned (crash)

// UserPromptSubmit also fires for a message sent WHILE Claude is working (it is queued and
// absorbed mid-turn). That is the same prompt, so the timer and counters must carry on.
// It is a genuinely new prompt when the previous one finished, or when the user pressed
// Esc (Stop never fires on an interrupt; the transcript records it).
function onPrompt(p, ev) {
  const prev = reduce(readEvents(p.session_id));
  if (RUNNING.has(prev.phase) && ev.t - prev.lastEventAt < STALE_MS) {
    const interruptedAt = lastInterruptAt(p.transcript_path);
    if (!(interruptedAt && interruptedAt >= prev.startedAt)) {
      fs.appendFileSync(logPath(p.session_id), JSON.stringify({ t: ev.t, e: 'note', text: ev.text || '' }) + '\n');
      return maybeAskAi(p.session_id);
    }
  }
  rotate(p.session_id, ev);
  maybeAskAi(p.session_id);
}

// estimator=ai: start a background AI estimate when one is due (see lib/ai.js).
function maybeAskAi(sessionId) {
  const cfg = require('./lib/config').loadConfig();
  if (cfg.estimator !== 'ai') return;
  const ai = require('./lib/ai');
  const state = reduce(readEvents(sessionId));
  const reason = ai.askReason(state, require('./lib/estimate').loadStats(), cfg, Date.now());
  if (reason) ai.requestEstimate(sessionId, reason, state.aiReqs + 1);
}

function finish(sessionId) {
  // Feed the history behind time estimates: working time only, per project. The prompt's
  // start time is its id, so a second Stop for the same prompt replaces the first entry.
  try {
    const s = reduce(readEvents(sessionId));
    if (s.startedAt && s.endedAt) {
      const cfg = require('./lib/config').loadConfig();
      const worked = activeMs(s, s.endedAt);
      // How the AI's first estimate compared with what really happened, for calibration.
      const f = s.aiFirst;
      const ratio = f && f.remMs > 0 && worked > f.at ? (worked - f.at) / f.remMs : 0;
      require('./lib/estimate').recordRun(s.cwd, worked, cfg, sessionId + ':' + s.startedAt, ratio);
    }
  } catch (_) { /* best effort */ }
}

// SessionStart: record where the (versioned) plugin lives so the stable
// status-line shim in ~/.claude/prompt-bar/ always loads the current version.
function recordRoot() {
  const { DATA_DIR } = require('./lib/state');
  const root = path.resolve(__dirname, '..');
  const f = path.join(DATA_DIR, 'root.txt');
  let cur = '';
  try { cur = fs.readFileSync(f, 'utf8').trim(); } catch (_) { /* first run */ }
  if (cur !== root) { ensureDir(DATA_DIR); fs.writeFileSync(f, root); }
}

function main(raw) {
  // The AI estimator's own `claude -p` must never feed back into PromptBar.
  if (process.env.PROMPT_BAR_CHILD) return;
  if (kind === 'root') return recordRoot();
  let p = {};
  try { p = JSON.parse(raw || '{}'); } catch (_) { return; }
  const ev = toEvent(kind, p);
  if (!ev) return;
  ensureDir(STATE_DIR);
  if (ev.e === 'end') { try { fs.unlinkSync(logPath(p.session_id)); } catch (_) { /* gone */ } return; }
  if (ev.e === 'prompt') return onPrompt(p, ev);
  fs.appendFileSync(logPath(p.session_id), JSON.stringify(ev) + '\n');
  if (ev.e === 'stop' && !ev.err) finish(p.session_id);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { buf += d; });
process.stdin.on('end', () => { try { main(buf); } catch (_) { /* never break Claude */ } process.exit(0); });
