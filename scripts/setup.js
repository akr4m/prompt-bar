#!/usr/bin/env node
'use strict';
// node setup.js install | uninstall | status | config key=value ... | config reset | demo
// Patches ~/.claude/settings.json (with a backup) to show PromptBar in the status line.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA_DIR, ensureDir } = require('./lib/state');
const { loadConfig, saveConfig, resetConfig, validate, normalize, DEFAULTS, LEGACY, LAYOUTS, CONFIG_FILE } = require('./lib/config');

const SETTINGS = process.env.PROMPT_BAR_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
const SHIM = path.join(DATA_DIR, 'statusline.js');
const ROOT = path.resolve(__dirname, '..');
const fwd = (p) => p.replace(/\\/g, '/');
const OUR_CMD = 'node "' + fwd(SHIM) + '"';
const isOurs = (sl) => !!(sl && typeof sl.command === 'string' && sl.command.includes(fwd(SHIM)));

const SHIM_SRC = `#!/usr/bin/env node
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
  const already = isOurs(prev);
  if (prev && !already) {
    // Keep the user's existing status line: we render it first, then our bar.
    saveConfig({ chain: prev.command || '', previousStatusLine: prev });
  }
  s.statusLine = { type: 'command', command: OUR_CMD, padding: 0, refreshInterval: loadConfig().refresh };
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
  if (isOurs(s.statusLine)) {
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
  const active = isOurs(s.statusLine);
  console.log('status line: ' + (active ? 'PromptBar (active)' : 'not PromptBar' + (s.statusLine ? ' -> ' + s.statusLine.command : '')));
  console.log('config: ' + JSON.stringify(loadConfig()));
}

function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !isNaN(Number(v))) return Number(v);
  return v;
}

// Keep settings.json's redraw interval in step with the "refresh" key.
function applyRefresh(sec) {
  const s = readSettings();
  if (!isOurs(s.statusLine) || s.statusLine.refreshInterval === sec) return;
  s.statusLine.refreshInterval = sec;
  writeSettings(s);
  console.log('refresh: status line now redraws every ' + sec + 's (settings.json updated)');
}

function config(args) {
  if (args[0] === 'reset') {
    resetConfig();
    applyRefresh(DEFAULTS.refresh);
    console.log('PromptBar settings reset to defaults.');
    console.log(JSON.stringify(loadConfig()));
    return;
  }
  const patch = {};
  let errors = 0;
  for (const a of args) {
    const i = a.indexOf('=');
    if (i < 1) { console.log('ignored "' + a + '": use key=value'); errors++; continue; }
    const raw = { [a.slice(0, i)]: a.slice(i + 1) };
    const key = Object.keys(raw)[0];
    // Text keys keep the literal string ("textDone=100" stays "100").
    const isText = ['text', 'separator', 'segments'].some((p) => key.startsWith(p)) || key === 'chain';
    raw[key] = isText ? raw[key] : coerce(raw[key]);
    const norm = normalize(raw);
    const [k, v] = Object.entries(norm)[0] || [key, raw[key]];
    if (LEGACY[key] && k !== key) console.log('note: "' + key + '" is now "' + k + '"');
    if (key === 'chain' || key === 'previousStatusLine') { console.log('"' + key + '" is managed by setup'); errors++; continue; }
    const err = validate(k, v);
    if (err) { console.log('invalid ' + k + '=' + JSON.stringify(v) + ': ' + err); errors++; continue; }
    patch[k] = v;
  }
  if (Object.keys(patch).length) {
    saveConfig(patch);
    if ('refresh' in patch) applyRefresh(patch.refresh);
  }
  if (errors && !Object.keys(patch).length) process.exitCode = 1;
  const cfg = loadConfig();
  delete cfg.chain;
  console.log(JSON.stringify(cfg));
}

function demo() {
  const { reduce } = require('./lib/state');
  const { estimateProgress } = require('./lib/estimate');
  const { render } = require('./lib/render');
  const now = Date.now();
  const t0 = now - 47000;
  // Past prompts in this demo project: 1m40s of working time each.
  const stats = { v: 3, all: [100000, 100000, 100000], projects: {} };
  const task = (t, id, status, subject, form) => ({ t, e: 'task', task: { id, status, subject, form } });
  const scenes = {
    // Tasks 1 and 2 finished at 15s and 30s: a 15s pace, the current task 17s in.
    'task list': [{ t: t0, e: 'prompt' },
      task(t0 + 1, '1', 'in_progress', 'Write parser'), task(t0 + 1, '2', 'pending', 'Add tests'),
      task(t0 + 1, '3', 'pending', 'Run tests'), task(t0 + 1, '4', 'pending', 'Update docs'),
      task(t0 + 15000, '1', 'completed'), task(t0 + 30000, '2', 'completed'),
      task(t0 + 30001, '3', 'in_progress', '', 'Running tests'),
      { t: t0 + 40000, e: 'pre', tool: 'Bash', id: 'a', label: 'npm test' }],
    // The AI read the prompt and answered 2m30s of work, 2s after it was sent.
    'ai': [{ t: t0, e: 'prompt' }, { t: t0 + 1, e: 'ai_req', n: 1 }, { t: t0 + 2000, e: 'ai', ms: 150000, at: 0, n: 1 },
      { t: t0 + 30000, e: 'pre', tool: 'Edit', id: 'f', label: 'checkout.tsx' }],
    'history': [{ t: t0, e: 'prompt' }, { t: t0 + 1, e: 'pre', tool: 'Edit', id: 'b', label: 'render.js' },
      { t: t0 + 2, e: 'post', tool: 'Edit', id: 'b' }, { t: t0 + 3, e: 'pre', tool: 'Grep', id: 'c', label: 'estimate' }],
    // Has run longer than every past prompt: no honest estimate left, so none is shown.
    'long': [{ t: now - 130000, e: 'prompt' }, { t: now - 1000, e: 'pre', tool: 'Bash', id: 'd', label: 'npm run build' }],
    'waiting': [{ t: t0, e: 'prompt' }, { t: t0 + 31000, e: 'wait' }],
    'cancelled': [{ t: now - 30000, e: 'prompt' }, { t: now - 20000, e: 'pre', tool: 'Bash', id: 'e', label: 'npm test' },
      { t: now - 8000, e: 'interrupt', tool: 'Bash', id: 'e' }],
    'done': [{ t: now - 72000, e: 'prompt' }, { t: now - 50000, e: 'post', tool: 'Read', id: 'x' }, { t: now, e: 'stop' }],
  };
  const base = loadConfig();
  const show = (label, over) => {
    console.log('-- ' + label);
    const cfg = Object.assign({}, base, over, { color: false, doneLinger: -1 });
    for (const [name, evs] of Object.entries(scenes)) {
      const st = reduce(evs);
      console.log('  ' + name.padEnd(10) + render(st, estimateProgress(st, stats, now, cfg), cfg, now));
    }
  };
  for (const layout of Object.keys(LAYOUTS)) {
    show('layout=' + layout, Object.assign({}, DEFAULTS, LAYOUTS[layout], { layout }));
  }
  show('measure=percent (your other settings)', { measure: 'percent' });
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  ({ install, uninstall, status, config: () => config(rest), demo }[cmd] || (() => {
    console.log('usage: setup.js install | uninstall | status | config key=value ... | config reset | demo');
  }))();
} catch (e) {
  console.error('prompt-bar setup failed: ' + e.message);
  process.exit(1);
}
