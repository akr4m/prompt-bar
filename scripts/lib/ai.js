'use strict';
// AI estimate (estimator=ai). Asks Claude through the user's own Claude Code login by
// running `claude -p` in the background: no API key, no extra service. The call loads no
// settings (so no plugins, hooks or skills run), saves no session, and has no tools.
//
// When:  at prompt start; again if the prompt passes the estimate, or the user sends a
//        new message mid-prompt, while there is no task pace (max cfg.aiMaxCalls a prompt).
// What:  the prompt text and progress facts PromptBar already has. Never file contents.
// Fails: silently. The bar keeps using the free estimators. Login or usage-limit errors
//        pause AI calls for 15 minutes so a broken setup isn't retried every prompt.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DATA_DIR, logPath, ensureDir, activeMs } = require('./state');
const { typicalMs, aiTotalMs } = require('./estimate');

const COOLDOWN_FILE = path.join(DATA_DIR, 'ai-cooldown.json');
const COOLDOWN_MS = 15 * 60 * 1000;
const PENDING_MS = 90 * 1000;       // a request with no answer after this is given up on
const MAX_TEXT = 2000;
const WORKER = path.join(__dirname, '..', 'ai-worker.js');
const RUNNING = new Set(['thinking', 'tool', 'waiting', 'compacting']);

const SYSTEM = [
  'You estimate how much longer Claude Code, an AI coding agent, will keep working on a request.',
  'It is fast: reading or searching files takes seconds, a small edit 10-30 seconds, running a',
  'test suite 10-90 seconds, a feature across several files a few minutes, a large refactor longer.',
  'Count only the agent\'s working time. Reply with ONLY JSON: {"seconds": N}',
].join(' ');

function coolingDown(now = Date.now()) {
  try { return JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8')).until > now; } catch (_) { return false; }
}

function startCooldown(reason, now = Date.now()) {
  ensureDir(DATA_DIR);
  try { fs.writeFileSync(COOLDOWN_FILE, JSON.stringify({ until: now + COOLDOWN_MS, reason: String(reason).slice(0, 200) })); } catch (_) { /* best effort */ }
}

// Should a new AI estimate be requested now? Returns the reason, or '' for no.
function askReason(state, stats, cfg, now) {
  if (cfg.estimator !== 'ai' || cfg.estimate !== 'auto' || !RUNNING.has(state.phase)) return '';
  if (state.aiPendingSince && now - state.aiPendingSince < PENDING_MS) return '';
  if (state.aiReqs >= cfg.aiMaxCalls || coolingDown(now)) return '';
  if (state.aiReqs === 0) return 'start';
  const t = state.todo;
  if (t && t.total > t.done && state.doneHere >= 1) return ''; // task pace is measuring it
  if (!state.ai) return '';
  const lastNote = state.notes.length ? state.notes[state.notes.length - 1].t : 0;
  if (lastNote > state.ai.t) return 'message';
  if (activeMs(state, now) >= aiTotalMs(state, stats, cfg)) return 'passed';
  return '';
}

// Record the request in the log and start the worker in the background (never waits).
function requestEstimate(sessionId, reason, n) {
  fs.appendFileSync(logPath(sessionId), JSON.stringify({ t: Date.now(), e: 'ai_req', n, reason }) + '\n');
  const child = spawn(process.execPath, [WORKER, String(sessionId)], {
    detached: true, stdio: 'ignore', windowsHide: true,
    env: Object.assign({}, process.env, { PROMPT_BAR_CHILD: '1' }),
  });
  child.unref();
}

function fmt(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's';
}

// The question sent to the model: the request plus what PromptBar already knows.
function buildQuestion(state, stats, cfg, now) {
  const clip = (s) => String(s || '').slice(0, MAX_TEXT);
  const lines = ['Request:', '"""', clip(state.text) || '(empty)', '"""'];
  for (const n of state.notes.slice(-3)) lines.push('Message sent while it was working:', '"""', clip(n.text), '"""');
  if (state.cwd) lines.push('Project folder: ' + path.basename(String(state.cwd).replace(/[\\/]+$/, '')));
  const typ = typicalMs(stats, state.cwd, cfg, 0);
  lines.push(typ ? 'This user\'s median prompt here takes ' + fmt(typ) + ' of working time.' : 'No history for this user yet.');
  const tasks = [...state.tasks.values()].filter((x) => x.status !== 'deleted');
  if (tasks.length) {
    const done = tasks.filter((x) => x.status === 'completed').length;
    lines.push('Its task list: ' + done + '/' + tasks.length + ' done: ' + tasks.slice(0, 10).map((x) => (x.status === 'completed' ? '[x] ' : '[ ] ') + (x.subject || x.form || 'task')).join('; '));
  }
  const act = activeMs(state, now);
  if (act > 1000) {
    const tools = Object.entries(state.toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + ' x' + v).join(', ');
    lines.push('So far: ' + fmt(act) + ' of working time' + (tools ? ', tool calls: ' + tools : '') + '.');
  }
  if (state.ai) lines.push('The previous estimate was ' + fmt(aiTotalMs(state, stats, cfg)) + ' in total' + (act >= aiTotalMs(state, stats, cfg) ? ' and it has been passed.' : '.'));
  lines.push('How many MORE seconds of working time until it finishes? Reply with ONLY JSON: {"seconds": N}');
  return lines.join('\n');
}

// Seconds from the model's reply, clamped to 5s..4h; null if there is no number.
function parseSeconds(text) {
  const m = String(text || '').match(/"seconds"\s*:\s*(\d+(?:\.\d+)?)/) || String(text || '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? Math.max(5, Math.min(4 * 3600, v)) : null;
}

// Arguments for `claude -p`: the user's login, no settings, no tools, no session saved.
function claudeArgs(cfg) {
  return ['-p', '--model', cfg.aiModel, '--setting-sources', '', '--strict-mcp-config', '--tools', '',
    '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json', '--system-prompt', SYSTEM];
}

// Errors that won't fix themselves in the next minute: pause AI calls for a while.
function isLasting(message) {
  return /not logged in|\/login|usage limit|rate limit|credit|quota|ENOENT|not found|not recognized/i.test(String(message));
}

module.exports = {
  askReason, requestEstimate, buildQuestion, parseSeconds, claudeArgs, isLasting,
  coolingDown, startCooldown, COOLDOWN_FILE, SYSTEM,
};
