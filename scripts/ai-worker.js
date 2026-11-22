#!/usr/bin/env node
'use strict';
// Background AI estimate for one session: node ai-worker.js <session_id>
// Started detached by lib/ai.js, so neither Claude nor the status line waits on it.
// Appends { e: 'ai', ms, at } (or { e: 'ai_fail' }) to the session log, then exits.

const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { readEvents, reduce, logPath, activeMs } = require('./lib/state');
const { loadStats } = require('./lib/estimate');
const { loadConfig } = require('./lib/config');
const ai = require('./lib/ai');

const TIMEOUT_MS = 60 * 1000;
const sessionId = process.argv[2];

function append(ev) {
  const file = logPath(sessionId);
  if (!fs.existsSync(file)) return; // the session ended meanwhile
  fs.appendFileSync(file, JSON.stringify(Object.assign({ t: Date.now() }, ev)) + '\n');
}

function fail(reason) {
  if (ai.isLasting(reason)) ai.startCooldown(reason);
  append({ e: 'ai_fail', reason: String(reason).slice(0, 120) });
}

function main() {
  const now = Date.now();
  const state = reduce(readEvents(sessionId));
  if (state.phase === 'idle') return;
  const cfg = loadConfig();
  const stats = loadStats();
  const question = ai.buildQuestion(state, stats, cfg, now);
  const at = activeMs(state, now);

  // PROMPT_BAR_CLAUDE (tests only): a script run with node in place of the real `claude`.
  const fake = process.env.PROMPT_BAR_CLAUDE;
  const cmd = fake ? process.execPath : 'claude';
  const args = fake ? [fake, ...ai.claudeArgs(cfg)] : ai.claudeArgs(cfg);
  const child = execFile(cmd, args, {
    cwd: os.tmpdir(), // no project files or CLAUDE.md in reach
    timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024,
    env: Object.assign({}, process.env, { PROMPT_BAR_CHILD: '1' }),
  }, (err, stdout) => {
    let reply;
    try { reply = JSON.parse(stdout); } catch (_) { return fail(err ? err.code || err.message : 'unreadable reply'); }
    if (reply.is_error) return fail(reply.result || 'error');
    const sec = ai.parseSeconds(reply.result);
    if (sec == null) return fail('no number in reply');
    append({ e: 'ai', ms: Math.round(sec * 1000), at, n: state.aiReqs });
  });
  child.stdin.on('error', () => { /* a failed launch is reported to the callback above */ });
  child.stdin.end(question);
}

try { main(); } catch (e) { try { fail(e.message); } catch (_) { /* nothing left to do */ } }
