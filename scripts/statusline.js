#!/usr/bin/env node
'use strict';
// Status line entry point. Claude Code pipes session JSON on stdin and prints
// whatever we write to stdout under the prompt. Runs outside the model: 0 tokens.

const { execSync } = require('child_process');
const { readEvents, reduce } = require('./lib/state');
const { estimateProgress, loadStats } = require('./lib/estimate');
const { loadConfig } = require('./lib/config');
const { render } = require('./lib/render');
const { lastInterruptAt } = require('./lib/transcript');

const RUNNING = new Set(['thinking', 'tool', 'waiting', 'compacting']);

// Esc while Claude is thinking fires no hook, so the log still says "running". The
// transcript records the interrupt: if one landed after this prompt's last event, show it.
function markInterrupt(state, transcriptPath) {
  if (!RUNNING.has(state.phase)) return;
  const at = lastInterruptAt(transcriptPath);
  if (!at || at < state.startedAt || at < state.lastEventAt - 2000) return;
  state.phase = 'interrupted';
  state.endedAt = at;
  state.running.clear();
  state.subagents = 0;
}

function main(raw) {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch (_) { /* tolerate */ }
  const cfg = loadConfig();
  const now = Date.now();

  let line = '';
  try {
    const state = reduce(readEvents(input.session_id));
    markInterrupt(state, input.transcript_path);
    const stats = cfg.estimate === 'off' ? null : loadStats();
    const prog = estimateProgress(state, stats, now, cfg);
    line = render(state, prog, cfg, now);
    // estimator=ai: the prompt passed the AI's estimate, or a new message arrived: ask again.
    if (cfg.estimator === 'ai' && input.session_id) {
      const ai = require('./lib/ai');
      const reason = ai.askReason(state, stats, cfg, now);
      if (reason) ai.requestEstimate(input.session_id, reason, state.aiReqs + 1);
    }
  } catch (e) {
    line = process.env.PROMPT_BAR_DEBUG ? 'prompt-bar error: ' + e.message : '';
  }

  // Preserve the user's previous status line (set by /prompt-bar:setup).
  let prefix = '';
  if (cfg.chain) {
    try {
      prefix = execSync(cfg.chain, { input: raw, timeout: 1500, stdio: ['pipe', 'pipe', 'ignore'] })
        .toString().replace(/\s+$/, '');
    } catch (_) { /* ignore broken chained command */ }
  }

  const out = [prefix, line].filter(Boolean).join(prefix && line ? '\n' : '');
  process.stdout.write(out);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { buf += d; });
process.stdin.on('end', () => main(buf));
