'use strict';
// Pure rendering: (state, progress, config, now) -> one status-line string.

const STYLES = {
  bar:     { l: '▕', r: '▏', full: '█', part: ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'], empty: '░', est: '▒' },
  blocks:  { l: '',  r: '',  full: '■', part: [''], empty: '□', est: '▣' },
  dots:    { l: '',  r: '',  full: '●', part: [''], empty: '○', est: '◍' },
  ascii:   { l: '[', r: ']', full: '#', part: [''], empty: '-', est: '=' },
};
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPIN_ASCII = ['|', '/', '-', '\\'];

const C = { reset: '\x1b[0m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m', magenta: '\x1b[35m' };

const ICON = {
  Bash: '$', Read: '⌕', Grep: '⌕', Glob: '⌕', Edit: '✎', Write: '✎', MultiEdit: '✎', NotebookEdit: '✎',
  WebFetch: '⇣', WebSearch: '⇣', Task: '⑂', Agent: '⑂', TodoWrite: '☑',
};

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm' + String(s % 60).padStart(2, '0') + 's';
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm';
}

function truncate(str, n) {
  str = String(str || '').replace(/\s+/g, ' ').trim();
  return str.length > n ? str.slice(0, Math.max(1, n - 1)) + '…' : str;
}

function bar(pct, kind, cfg, now) {
  const st = STYLES[cfg.style] || STYLES.bar;
  const w = cfg.width;
  if (pct == null) {
    // Indeterminate: a sliding 3-cell pulse. Honest: shows liveness, claims no amount.
    // Step once per second to match refreshInterval: 1 (smooth slide, not random jumps).
    const pos = Math.floor(now / 1000) % (w + 3);
    let out = '';
    for (let i = 0; i < w; i++) out += (i >= pos - 3 && i < pos) ? st.est : st.empty;
    return st.l + out + st.r;
  }
  const fillChar = kind === 'estimate' ? st.est : st.full;
  const exact = (pct / 100) * w;
  let full = Math.floor(exact);
  let partial = '';
  if (kind !== 'estimate' && st.part.length > 1 && full < w) {
    partial = st.part[Math.floor((exact - full) * st.part.length)] || '';
  }
  const used = full + (partial ? 1 : 0);
  return st.l + fillChar.repeat(full) + partial + st.empty.repeat(Math.max(0, w - used)) + st.r;
}

function paint(cfg, color, s) { return cfg.color ? C[color] + s + C.reset : s; }

function render(state, prog, cfg, now) {
  if (state.phase === 'idle') return '';
  const parts = [];
  const ascii = cfg.style === 'ascii';
  const spin = (ascii ? SPIN_ASCII : SPIN)[Math.floor(now / 1000) % (ascii ? 4 : 10)];
  const paused = state.phase === 'done' || state.phase === 'waiting';
  const elapsed = (state.endedAt || now) - state.startedAt;

  // 1) status glyph + phase
  let head;
  switch (state.phase) {
    case 'done': head = state.error
      ? paint(cfg, 'red', ascii ? 'X stopped (API error)' : '✗ stopped (API error)')
      : paint(cfg, 'green', ascii ? 'OK done' : '✓ done'); break;
    case 'waiting': head = paint(cfg, 'yellow', ascii ? '|| waiting for you' : '⏸ waiting for you'); break;
    case 'compacting': head = paint(cfg, 'magenta', spin + ' compacting'); break;
    case 'tool': head = paint(cfg, 'cyan', spin + ' working'); break;
    default: head = paint(cfg, 'cyan', spin + ' thinking');
  }

  // 2) bar + percentage (or nothing in minimal style)
  // A paused task shows a frozen bar only if there's a real number; never an animated pulse.
  if (cfg.style !== 'minimal' && !paused || (state.phase === 'waiting' && prog.pct != null && cfg.style !== 'minimal')) {
    let b = bar(prog.pct, prog.kind, cfg, now);
    let label = '';
    if (prog.kind === 'exact') label = ' ' + prog.pct + '%';
    else if (prog.kind === 'estimate') label = ' ~' + prog.pct + '% ' + paint(cfg, 'dim', 'est');
    b = paint(cfg, prog.kind === 'exact' ? 'green' : 'dim', b) + label;
    parts.push(head + ' ' + b);
  } else if (cfg.style === 'minimal' && prog.pct != null && state.phase !== 'done') {
    parts.push(head + ' ' + (prog.kind === 'estimate' ? '~' + prog.pct + '% est' : prog.pct + '%'));
  } else {
    parts.push(head);
  }

  // 3) todo step ("3/7 · Running tests")
  if (state.todo && state.todo.total && state.phase !== 'done') {
    let t = state.todo.done + '/' + state.todo.total;
    if (state.todo.active) t += ' ' + truncate(state.todo.active, cfg.maxLabel);
    parts.push(t);
  }

  // 4) current activity
  if (cfg.showLabel && state.phase === 'tool' && state.lastTool) {
    const n = state.running.size;
    const lt = state.lastTool;
    let a = (ascii ? '' : (ICON[lt.tool] || '⚙') + ' ') + lt.tool;
    if (lt.label) a += ' ' + truncate(lt.label, cfg.maxLabel);
    if (n > 1) a += ' +' + (n - 1);
    parts.push(a);
  }
  if (state.subagents > 0) parts.push((ascii ? 'agents:' : '⑂') + state.subagents);

  // 5) counters
  if (cfg.showTools && (state.toolsDone || state.toolsFailed)) {
    let t = state.toolsDone + ' tool' + (state.toolsDone === 1 ? '' : 's');
    if (state.toolsFailed) t += ' ' + paint(cfg, 'red', state.toolsFailed + ' failed');
    parts.push(t);
  }
  if (cfg.showElapsed && state.startedAt) parts.push(paint(cfg, 'dim', fmtDuration(elapsed)));

  return parts.join(paint(cfg, 'dim', cfg.separator));
}

module.exports = { render, bar, fmtDuration, truncate, STYLES };
