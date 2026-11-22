'use strict';
// User config: ~/.claude/prompt-bar/config.json (all keys optional).
const fs = require('fs');
const path = require('path');
const { DATA_DIR, ensureDir } = require('./state');

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  style: 'bar',          // bar | blocks | dots | ascii | minimal
  width: 12,             // bar cells
  color: true,
  showLabel: true,       // current tool + target (e.g. "Edit state.js")
  showTools: true,       // tool-call counter
  showElapsed: true,
  showEstimate: true,    // allow "~NN% est" from history when no todo list exists
  maxLabel: 28,
  chain: '',             // previous statusLine command; its output is prefixed to ours
  separator: ' · ',
};

function loadConfig() {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) { /* defaults */ }
  const cfg = Object.assign({}, DEFAULTS, user);
  if (process.env.NO_COLOR) cfg.color = false;
  if (process.env.PROMPT_BAR_STYLE) cfg.style = process.env.PROMPT_BAR_STYLE;
  cfg.width = Math.max(4, Math.min(40, Number(cfg.width) || DEFAULTS.width));
  return cfg;
}

function saveConfig(patch) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) { /* new */ }
  const next = Object.assign(cur, patch);
  ensureDir(DATA_DIR);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n');
  return next;
}

module.exports = { loadConfig, saveConfig, DEFAULTS, CONFIG_FILE };
