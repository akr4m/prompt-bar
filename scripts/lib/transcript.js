'use strict';
// Reads the end of the session transcript (JSONL) that Claude Code passes to hooks and to
// the status line. Pressing Esc while Claude is thinking fires no hook at all; the only
// trace is a "[Request interrupted by user]" entry written to the transcript.

const fs = require('fs');

const TAIL_BYTES = 64 * 1024;
// The genuine entry is a user message whose text STARTS with the marker. Tool results are
// user messages too and may merely contain these words (e.g. grep output), so skip them.
const MARK = '"text":"[Request interrupted by user';

// Epoch ms of the most recent interrupt in the transcript, or 0 if none / unreadable.
function lastInterruptAt(transcriptPath) {
  if (!transcriptPath) return 0;
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes(MARK) || !line.includes('"type":"user"') || line.includes('"tool_result"')) continue;
      const m = line.match(/"timestamp":"([^"]+)"/);
      const t = m ? Date.parse(m[1]) : NaN;
      if (Number.isFinite(t)) return t;
    }
  } catch (_) { /* no transcript: treat as no interrupt */ }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* ignore */ } }
  return 0;
}

module.exports = { lastInterruptAt };
