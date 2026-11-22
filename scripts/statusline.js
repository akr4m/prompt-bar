#!/usr/bin/env node
'use strict';
// Status line entry point. Claude Code pipes session JSON on stdin and prints
// whatever we write to stdout under the prompt. Runs outside the model: 0 tokens.

const { execSync } = require('child_process');
const { readEvents, reduce } = require('./lib/state');
const { estimateProgress, loadStats } = require('./lib/estimate');
const { loadConfig } = require('./lib/config');
const { render } = require('./lib/render');

function main(raw) {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch (_) { /* tolerate */ }
  const cfg = loadConfig();
  const now = Date.now();

  let line = '';
  try {
    const state = reduce(readEvents(input.session_id));
    const prog = estimateProgress(state, cfg.estimate === 'off' ? null : loadStats(), now, cfg);
    line = render(state, prog, cfg, now);
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
