'use strict';
// User config: ~/.claude/prompt-bar/config.json (all keys optional).
const fs = require('fs');
const path = require('path');
const { DATA_DIR, ensureDir } = require('./state');

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const SEGMENTS = ['status', 'bar', 'pct', 'time', 'source', 'task', 'tool', 'agents', 'tools'];
const COLOR_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray', 'dim', 'bold', 'none'];

// A layout is a preset of other keys. Precedence: DEFAULTS < layout < the user's own keys.
const LAYOUTS = {
  default: {},
  verbose: { segments: 'status,bar,pct,time,source,task,tool,agents,tools', maxLabel: 36 },
  compact: { segments: 'status,bar,pct,time,task', showRemaining: false, statusText: 'paused', maxLabel: 20 },
  minimal: { segments: 'status,pct,time', timeStyle: 'remaining', statusText: 'never' },
  countdown: { segments: 'status,time,task', statusText: 'never' },
  focus: { segments: 'status,task,tool', showTaskCount: false },
  plain: { barStyle: 'ascii', spinner: 'line', icons: false, color: false, separator: ' - ' },
};

const DEFAULTS = {
  // estimator
  estimator: 'ai',       // ai (asks Claude via your Claude Code login, ~800 tokens a call) | free (0 tokens)
  aiModel: 'haiku',      // model alias or id for the AI estimate
  aiMaxCalls: 3,         // AI calls per prompt at most (start, then re-asks)
  // what to show
  layout: 'default',     // default | verbose | compact | minimal | countdown | focus | plain
  measure: 'time',       // time | percent | both
  estimate: 'auto',      // auto (task pace, then AI, then history) | tasks | history | off
  timeStyle: 'full',     // full ("47s / ~1m40s · ~53s left") | remaining ("~53s left")
  showTotal: true,       // the "/ ~1m40s" part
  showRemaining: true,   // the "~53s left" part
  statusText: 'always',  // phase word next to the icon: always | paused (done/waiting only) | never
  segments: 'status,bar,pct,time,task,tool,agents,tools',
  // history
  historySize: 50,       // finished prompts kept per project
  minSamples: 3,         // prompts needed before history is used
  historyScope: 'project', // project | global
  timeFormat: 'short',   // short (1m40s) | clock (1:40)
  // look
  barStyle: 'bar',       // bar | blocks | dots | ascii | none
  width: 12,             // bar cells
  color: true,
  colorThinking: 'cyan',
  colorWorking: 'cyan',
  colorWaiting: 'yellow',
  colorCompacting: 'magenta',
  colorDone: 'green',
  colorError: 'red',
  colorInterrupted: 'yellow',
  colorBar: 'green',
  icons: true,           // tool icons ($ ✎ ⌕ ...)
  spinner: 'auto',       // auto | braille | line | none
  separator: ' · ',
  // wording
  textThinking: 'thinking',
  textWorking: 'working',
  textWaiting: 'waiting for you',
  textCompacting: 'compacting',
  textDone: 'done',
  textError: 'stopped (API error)',
  textLeft: 'left',
  textInterrupted: 'interrupted',
  textEst: 'est',
  textPace: 'task pace',
  textHistory: 'history',
  textAi: 'ai',
  // behaviour
  showLabel: true,       // current tool + target (e.g. "Edit state.js")
  showTools: true,       // tool-call counter
  showElapsed: true,     // time so far (while running) and total time (when done)
  showTaskCount: true,   // the "2/4" before the current task
  maxLabel: 28,
  doneLinger: -1,        // seconds to keep the "done" line; -1 = until next prompt
  refresh: 1,            // status-line redraw interval in seconds (written to settings.json)
  chain: '',             // previous statusLine command; its output is prefixed to ours (set by setup)
};

const enumOf = (...values) => ({ kind: 'enum', values });
const int = (min, max) => ({ kind: 'int', min, max });
const BOOL = { kind: 'bool' };
const TEXT = { kind: 'text' };
const COLOR = { kind: 'color' };

const SCHEMA = {
  estimator: enumOf('ai', 'free'),
  aiModel: { kind: 'model' },
  aiMaxCalls: int(1, 10),
  layout: enumOf(...Object.keys(LAYOUTS)),
  measure: enumOf('time', 'percent', 'both'),
  estimate: enumOf('auto', 'tasks', 'history', 'off'),
  timeStyle: enumOf('full', 'remaining'),
  showTotal: BOOL, showRemaining: BOOL,
  statusText: enumOf('always', 'paused', 'never'),
  segments: { kind: 'segments' },
  historySize: int(3, 200), minSamples: int(1, 50),
  historyScope: enumOf('project', 'global'),
  timeFormat: enumOf('short', 'clock'),
  barStyle: enumOf('bar', 'blocks', 'dots', 'ascii', 'none'),
  width: int(4, 40),
  color: BOOL,
  colorThinking: COLOR, colorWorking: COLOR, colorWaiting: COLOR, colorCompacting: COLOR,
  colorDone: COLOR, colorError: COLOR, colorInterrupted: COLOR, colorBar: COLOR,
  icons: BOOL,
  spinner: enumOf('auto', 'braille', 'line', 'none'),
  separator: TEXT,
  textThinking: TEXT, textWorking: TEXT, textWaiting: TEXT, textCompacting: TEXT, textDone: TEXT,
  textError: TEXT, textInterrupted: TEXT, textLeft: TEXT, textEst: TEXT, textPace: TEXT, textHistory: TEXT, textAi: TEXT,
  showLabel: BOOL, showTools: BOOL, showElapsed: BOOL, showTaskCount: BOOL,
  maxLabel: int(4, 200),
  doneLinger: int(-1, 86400),
  refresh: int(1, 60),
  chain: TEXT,
};

// Names from 0.1, still accepted: old key -> (value -> [new key, new value]).
const LEGACY = {
  style: (v) => ['barStyle', v === 'minimal' ? 'none' : v],
  mode: (v) => ['measure', v],
  showEstimate: (v) => (v === false ? ['estimate', 'off'] : null),
};

// Rewrite legacy keys in a plain settings object. New keys win over old ones.
function normalize(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (!LEGACY[k]) { out[k] = v; continue; }
    const m = LEGACY[k](v);
    if (m && !(m[0] in obj)) out[m[0]] = m[1];
  }
  return out;
}

// Returns null when `value` is valid for `key`, otherwise a human-readable reason.
function validate(key, value) {
  const rule = SCHEMA[key];
  if (!rule) return 'unknown key';
  switch (rule.kind) {
    case 'enum': return rule.values.includes(value) ? null : 'must be one of ' + rule.values.join(' | ');
    case 'int': return Number.isInteger(value) && value >= rule.min && value <= rule.max
      ? null : 'must be a whole number from ' + rule.min + ' to ' + rule.max;
    case 'bool': return typeof value === 'boolean' ? null : 'must be true or false';
    case 'text': return typeof value === 'string' ? null : 'must be text';
    case 'color': return (COLOR_NAMES.includes(value) || (Number.isInteger(value) && value >= 0 && value <= 255))
      ? null : 'must be a colour name (' + COLOR_NAMES.join(' ') + ') or 0-255';
    // Passed to `claude --model`: a model alias or id, nothing that could act as another flag.
    case 'model': return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,63}$/.test(value)
      ? null : 'must be a model alias or id, e.g. haiku, sonnet, claude-haiku-5-5';
    case 'segments': {
      if (typeof value !== 'string' || !value.trim()) return 'must be a comma list of ' + SEGMENTS.join(',');
      const bad = value.split(',').map((x) => x.trim()).filter((x) => !SEGMENTS.includes(x));
      return bad.length ? 'unknown segment ' + bad.join(', ') + ' (valid: ' + SEGMENTS.join(',') + ')' : null;
    }
    default: return null;
  }
}

function readRaw() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) { return {}; }
}

function loadConfig() {
  const user = normalize(readRaw());
  // A hand-edited bad value falls back to its default instead of breaking the bar.
  const ok = (k) => k in user && validate(k, user[k]) === null;
  const layout = ok('layout') ? user.layout : DEFAULTS.layout;
  const cfg = Object.assign({}, DEFAULTS, LAYOUTS[layout], { layout });
  for (const k of Object.keys(DEFAULTS)) if (ok(k)) cfg[k] = user[k];
  if (process.env.NO_COLOR) cfg.color = false;
  const envStyle = process.env.PROMPT_BAR_STYLE;
  if (envStyle) {
    const s = envStyle === 'minimal' ? 'none' : envStyle;
    if (validate('barStyle', s) === null) cfg.barStyle = s;
  }
  return cfg;
}

function saveConfig(patch) {
  const next = Object.assign(normalize(readRaw()), patch);
  ensureDir(DATA_DIR);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n');
  return next;
}

// Remove every user setting, keeping only what setup manages (the chained status line).
function resetConfig() {
  const raw = readRaw();
  const keep = {};
  for (const k of ['chain', 'previousStatusLine']) if (raw[k] !== undefined) keep[k] = raw[k];
  ensureDir(DATA_DIR);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(keep, null, 2) + '\n');
}

module.exports = {
  loadConfig, saveConfig, resetConfig, validate, normalize, readRaw,
  DEFAULTS, SCHEMA, SEGMENTS, LAYOUTS, LEGACY, CONFIG_FILE,
};
