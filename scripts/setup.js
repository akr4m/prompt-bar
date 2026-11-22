#!/usr/bin/env bun
'use strict';
// bun setup.js install | uninstall | status | config key=value ... | demo
// Patches ~/.claude/settings.json (with a backup) to show PromptBar in the status line.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA_DIR, ensureDir } = require('./lib/state');
const { loadConfig, saveConfig, DEFAULTS, CONFIG_FILE } = require('./lib/config');

const SETTINGS = process.env.PROMPT_BAR_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
const SHIM = path.join(DATA_DIR, 'statusline.js');
const ROOT = path.resolve(__dirname, '..');
const fwd = (p) => p.replace(/\\/g, '/');
const OUR_CMD = 'bun "' + fwd(SHIM) + '"';

const SHIM_SRC = `#!/usr/bin/env bun
// PromptBar stable shim. Loads the current plugin version (path kept fresh by a SessionStart hook).
const fs = require('fs'), path = require('path');
let root = ${JSON.stringify(ROOT)};
try { root = fs.readFileSync(path.join(__dirname, 'root.txt'), 'utf8').trim() || root; } catch (_) {}
try { require(path.join(root, 'scripts', 'statusline.js')); } catch (_) { process.stdin.resume(); }
`;

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw new Error('Cannot parse ' + SETTINGS + ': ' + e.message); }
}
function writeSettings(obj) {
  ensureDir(path.dirname(SETTINGS));
  fs.writeFileSync(SETTINGS, JSON.stringify(obj, null, 2) + '\n');
}

function install() {
  const s = readSettings();
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, SETTINGS + '.prompt-bar.bak');
  ensureDir(DATA_DIR);
  fs.writeFileSync(SHIM, SHIM_SRC);
  fs.writeFileSync(path.join(DATA_DIR, 'root.txt'), ROOT);

  const prev = s.statusLine;
  const already = prev && prev.command === OUR_CMD;
  if (prev && !already) {
    // Keep the user's existing status line: we render it first, then our bar.
    saveConfig({ chain: prev.command || '', previousStatusLine: prev });
  }
  s.statusLine = { type: 'command', command: OUR_CMD, padding: 0, refreshInterval: 1 };
  writeSettings(s);
  console.log('PromptBar installed.');
  console.log('  settings: ' + SETTINGS + (fs.existsSync(SETTINGS + '.prompt-bar.bak') ? ' (backup: .prompt-bar.bak)' : ''));
  if (prev && !already) console.log('  existing status line kept above the bar: ' + prev.command);
  console.log('  The bar appears on your next prompt.');
}

function uninstall() {
  const s = readSettings();
  const cfg = loadConfig();
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) { /* none */ }
  if (s.statusLine && s.statusLine.command === OUR_CMD) {
    if (raw.previousStatusLine) s.statusLine = raw.previousStatusLine;
    else delete s.statusLine;
    writeSettings(s);
    saveConfig({ chain: '', previousStatusLine: undefined });
    console.log('PromptBar removed from status line' + (raw.previousStatusLine ? '; restored: ' + cfg.chain : '.'));
  } else {
    console.log('PromptBar is not the active status line; nothing changed.');
  }
  console.log('To remove the hooks too: /plugin uninstall prompt-bar');
}

function status() {
  const s = readSettings();
  const active = s.statusLine && s.statusLine.command === OUR_CMD;
  console.log('status line: ' + (active ? 'PromptBar (active)' : 'not PromptBar' + (s.statusLine ? ' -> ' + s.statusLine.command : '')));
  console.log('config: ' + JSON.stringify(loadConfig()));
}

function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !isNaN(Number(v))) return Number(v);
  return v;
}

function config(args) {
  const patch = {};
  for (const a of args) {
    const i = a.indexOf('=');
    if (i < 1) continue;
    const k = a.slice(0, i);
    if (!(k in DEFAULTS)) { console.log('unknown key: ' + k + ' (valid: ' + Object.keys(DEFAULTS).join(', ') + ')'); continue; }
    patch[k] = coerce(a.slice(i + 1));
  }
  if (Object.keys(patch).length) saveConfig(patch);
  console.log(JSON.stringify(loadConfig()));
}

function demo() {
  const { reduce } = require('./lib/state');
  const { estimateProgress } = require('./lib/estimate');
  const { render } = require('./lib/render');
  const now = Date.now();
  const t0 = now - 47000;
  const scenes = {
    'task list': [{ t: t0, e: 'prompt' },
      { t: t0 + 1, e: 'task', task: { id: '1', status: 'completed', subject: 'Write parser' } },
      { t: t0 + 2, e: 'task', task: { id: '2', status: 'completed', subject: 'Add tests' } },
      { t: t0 + 3, e: 'task', task: { id: '3', status: 'in_progress', subject: 'Run tests', form: 'Running tests' } },
      { t: t0 + 4, e: 'task', task: { id: '4', status: 'pending', subject: 'Update docs' } },
      { t: t0 + 5, e: 'pre', tool: 'Bash', id: 'a', label: 'bun test' }],
    'no task list': [{ t: t0, e: 'prompt' }, { t: t0 + 1, e: 'pre', tool: 'Edit', id: 'b', label: 'render.js' },
      { t: t0 + 2, e: 'post', tool: 'Edit', id: 'b' }, { t: t0 + 3, e: 'pre', tool: 'Grep', id: 'c', label: 'estimate' }],
    'waiting': [{ t: t0, e: 'prompt' }, { t: t0 + 1, e: 'wait' }],
    'done': [{ t: t0, e: 'prompt' }, { t: t0 + 1, e: 'post', tool: 'Read', id: 'x' }, { t: now, e: 'stop' }],
  };
  const base = loadConfig();
  for (const style of ['bar', 'blocks', 'dots', 'ascii', 'minimal']) {
    console.log('-- style=' + style);
    for (const [name, evs] of Object.entries(scenes)) {
      const st = reduce(evs);
      console.log('  ' + name.padEnd(13) + render(st, estimateProgress(st, null, now), Object.assign({}, base, { style, color: false }), now));
    }
  }
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  ({ install, uninstall, status, config: () => config(rest), demo }[cmd] || (() => {
    console.log('usage: setup.js install | uninstall | status | config key=value ... | demo');
  }))();
} catch (e) {
  console.error('prompt-bar setup failed: ' + e.message);
  process.exit(1);
}
