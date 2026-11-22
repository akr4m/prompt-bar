'use strict';
// Pure rendering: (state, progress, config, now) -> one status-line string.
// The line is built from `cfg.segments` in order. A segment listed in ATTACH joins the one
// before it with a space when that one is among its partners ("⠹ working ▕██▏ 50%",
// "~53s left (history)"); every other join uses cfg.separator.

const { activeMs } = require('./state');

const BARS = {
  bar:    { l: '▕', r: '▏', full: '█', part: ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'], empty: '░', est: '▒' },
  blocks: { l: '',  r: '',  full: '■', part: [''], empty: '□', est: '▣' },
  dots:   { l: '',  r: '',  full: '●', part: [''], empty: '○', est: '◍' },
  ascii:  { l: '[', r: ']', full: '#', part: [''], empty: '-', est: '=' },
};
const SPINNERS = {
  braille: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  line: ['|', '/', '-', '\\'],
};
const GLYPH = {
  unicode: { waiting: '⏸', done: '✓', error: '✗', interrupted: '⊘', agents: '⑂' },
  ascii: { waiting: '||', done: 'OK', error: 'X', interrupted: '--', agents: 'agents:' },
};
const ICON = {
  Bash: '$', PowerShell: '$', Read: '⌕', Grep: '⌕', Glob: '⌕', Edit: '✎', Write: '✎', MultiEdit: '✎',
  NotebookEdit: '✎', WebFetch: '⇣', WebSearch: '⇣', Task: '⑂', Agent: '⑂', TodoWrite: '☑',
};
const ANSI = {
  black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37,
  gray: 90, dim: 2, bold: 1,
};
const RESET = '\x1b[0m';
const isEnded = (state) => state.phase === 'done' || state.phase === 'interrupted';
const ATTACH = {
  bar: new Set(['status']),
  pct: new Set(['status', 'bar']),
  time: new Set(['status', 'bar']), // after a percentage, the time reads better as its own part
  source: new Set(['time']),
};

function fmtDuration(ms, format = 'short') {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n) => String(n).padStart(2, '0');
  if (format === 'clock') return h ? h + ':' + pad(m % 60) + ':' + pad(s % 60) : m + ':' + pad(s % 60);
  if (s < 60) return s + 's';
  if (m < 60) return m + 'm' + pad(s % 60) + 's';
  return h + 'h' + pad(m % 60) + 'm';
}

function truncate(str, n) {
  str = String(str || '').replace(/\s+/g, ' ').trim();
  return str.length > n ? str.slice(0, Math.max(1, n - 1)) + '…' : str;
}

function paint(cfg, color, s) {
  if (!cfg.color || !s || color === 'none') return s;
  const code = typeof color === 'number' ? '38;5;' + color : ANSI[color];
  return code === undefined ? s : '\x1b[' + code + 'm' + s + RESET;
}

// pct: 0-100 fills the bar; null draws an indeterminate pulse. `soft` = hatched fill (estimate).
function bar(pct, soft, cfg, now) {
  const st = BARS[cfg.barStyle] || BARS.bar;
  const w = cfg.width;
  if (pct == null) {
    // A sliding 3-cell pulse: shows liveness, claims no amount. One step per redraw second.
    const pos = Math.floor(now / 1000) % (w + 3);
    let out = '';
    for (let i = 0; i < w; i++) out += (i >= pos - 3 && i < pos) ? st.est : st.empty;
    return st.l + out + st.r;
  }
  const exact = (Math.max(0, Math.min(100, pct)) / 100) * w;
  const full = Math.floor(exact);
  let partial = '';
  if (!soft && st.part.length > 1 && full < w) partial = st.part[Math.floor((exact - full) * st.part.length)] || '';
  const used = full + (partial ? 1 : 0);
  return st.l + (soft ? st.est : st.full).repeat(full) + partial + st.empty.repeat(Math.max(0, w - used)) + st.r;
}

// What fills the bar for the chosen measure: { pct, soft } or { pct: null } for a pulse.
function barFill(prog, cfg) {
  const t = prog.time;
  const timeFill = t ? { pct: (100 * t.activeMs) / t.totalMs, soft: false } : null;
  if (cfg.measure === 'time') return timeFill || { pct: null };
  if (cfg.measure === 'both' && prog.kind !== 'exact' && timeFill) return timeFill;
  return { pct: prog.pct, soft: prog.kind === 'estimate' };
}

// Each segment returns a list of parts ([] = nothing to show).
const SEG = {
  status(c) {
    const { state, cfg, ascii, now } = c;
    const g = GLYPH[ascii ? 'ascii' : 'unicode'];
    const kind = state.phase === 'done' ? (state.error ? 'error' : 'done') : state.phase;
    const frames = SPINNERS[cfg.spinner === 'auto' ? (ascii ? 'line' : 'braille') : cfg.spinner];
    const spin = frames ? frames[Math.floor(now / 1000) % frames.length] : '';
    const look = {
      thinking: [spin, cfg.textThinking, cfg.colorThinking],
      tool: [spin, cfg.textWorking, cfg.colorWorking],
      compacting: [spin, cfg.textCompacting, cfg.colorCompacting],
      waiting: [g.waiting, cfg.textWaiting, cfg.colorWaiting],
      done: [g.done, cfg.textDone, cfg.colorDone],
      error: [g.error, cfg.textError, cfg.colorError],
      interrupted: [g.interrupted, cfg.textInterrupted, cfg.colorInterrupted],
    }[kind] || [spin, cfg.textThinking, cfg.colorThinking];
    const paused = kind !== 'thinking' && kind !== 'tool';
    const word = cfg.statusText === 'always' || (cfg.statusText === 'paused' && paused) ? look[1] : '';
    const s = [look[0], word].filter(Boolean).join(' ');
    c.bareGlyph = !word;
    return s ? [paint(cfg, look[2], s)] : [];
  },

  bar(c) {
    const { state, prog, cfg, now } = c;
    if (cfg.barStyle === 'none' || isEnded(state)) return [];
    const f = barFill(prog, cfg);
    // While paused, show a frozen bar only when it holds a real amount, never a pulse.
    if (state.phase === 'waiting' && f.pct == null) return [];
    return [paint(cfg, f.pct == null || f.soft ? 'dim' : cfg.colorBar, bar(f.pct, f.soft, cfg, now))];
  },

  pct(c) {
    const { state, prog, cfg } = c;
    if (cfg.measure === 'time' || isEnded(state) || prog.pct == null) return [];
    return [prog.kind === 'estimate' ? '~' + prog.pct + '% ' + paint(cfg, 'dim', cfg.textEst) : prog.pct + '%'];
  },

  time(c) {
    const { state, prog, cfg, now } = c;
    const f = (ms) => fmtDuration(ms, cfg.timeFormat);
    // A plain duration (no estimate) is a trailing counter: it goes at the end of the line.
    if (isEnded(state)) {
      if (cfg.showElapsed) c.tail = paint(cfg, 'dim', f(state.endedAt - state.startedAt));
      return [];
    }
    const act = activeMs(state, now);
    const t = cfg.measure === 'percent' ? null : prog.time;
    if (!t) {
      if (!cfg.showElapsed) return [];
      // Measuring time: elapsed is the headline number, so it stays next to the bar.
      // Measuring percent: it is a trailing counter, like on the finished line.
      if (cfg.measure !== 'percent') return [f(act)];
      c.tail = paint(cfg, 'dim', f(act));
      return [];
    }
    // Round remaining up so that elapsed + left never falls short of the total.
    const left = '~' + f(Math.ceil(t.remainingMs / 1000) * 1000) + ' ' + cfg.textLeft;
    if (cfg.timeStyle === 'remaining') return [left];
    const parts = [];
    if (cfg.showTotal) parts.push(f(act) + paint(cfg, 'dim', ' / ~' + f(t.totalMs)));
    else if (cfg.showElapsed) parts.push(f(act));
    if (cfg.showRemaining) parts.push(left);
    return parts;
  },

  source(c) {
    const { state, prog, cfg } = c;
    const t = prog.time;
    if (!t || cfg.measure === 'percent' || isEnded(state)) return [];
    const label = { tasks: cfg.textPace, ai: cfg.textAi, history: cfg.textHistory }[t.source] || t.source;
    return [paint(cfg, 'dim', '(' + label + ')')];
  },

  task(c) {
    const { state, cfg } = c;
    const t = state.todo;
    if (!t || !t.total || isEnded(state)) return [];
    const label = t.active ? truncate(t.active, cfg.maxLabel) : '';
    const s = [cfg.showTaskCount ? t.done + '/' + t.total : '', label].filter(Boolean).join(' ');
    return s ? [s] : [];
  },

  tool(c) {
    const { state, cfg, ascii } = c;
    const lt = state.lastTool;
    if (!cfg.showLabel || state.phase !== 'tool' || !lt) return [];
    let a = (cfg.icons && !ascii ? (ICON[lt.tool] || '⚙') + ' ' : '') + lt.tool;
    if (lt.label) a += ' ' + truncate(lt.label, cfg.maxLabel);
    if (state.running.size > 1) a += ' +' + (state.running.size - 1);
    return [a];
  },

  agents(c) {
    const { state, ascii } = c;
    return state.subagents > 0 ? [GLYPH[ascii ? 'ascii' : 'unicode'].agents + state.subagents] : [];
  },

  tools(c) {
    const { state, cfg } = c;
    if (!cfg.showTools || !(state.toolsDone || state.toolsFailed)) return [];
    let t = state.toolsDone + ' tool' + (state.toolsDone === 1 ? '' : 's');
    if (state.toolsFailed) t += ' ' + paint(cfg, cfg.colorError, state.toolsFailed + ' failed');
    return [t];
  },
};

function render(state, prog, cfg, now) {
  if (state.phase === 'idle') return '';
  if (isEnded(state) && cfg.doneLinger >= 0 && now - state.endedAt > cfg.doneLinger * 1000) return '';
  const ctx = { state, prog, cfg, now, ascii: cfg.barStyle === 'ascii' };
  const sep = paint(cfg, 'dim', cfg.separator);
  const out = [];
  let prev = '';
  for (const name of String(cfg.segments).split(',').map((x) => x.trim())) {
    const fn = SEG[name];
    const parts = fn ? fn(ctx) : [];
    if (!parts.length) continue;
    if (out.length && ATTACH[name] && ATTACH[name].has(prev)) out[out.length - 1] += ' ' + parts.shift();
    out.push(...parts);
    prev = name;
  }
  if (ctx.tail) {
    // Right after a bare status icon ("✓ 1m12s") a space reads better than a separator.
    if (out.length === 1 && prev === 'status' && ctx.bareGlyph) out[0] += ' ' + ctx.tail;
    else out.push(ctx.tail);
  }
  return out.join(sep);
}

module.exports = { render, bar, fmtDuration, truncate, BARS };
