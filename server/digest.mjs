// 팀장 보고용 '자세한 요약' — 보고 순간에 한 번, 일한 대화 기록(jsonl)을 처음부터 끝까지 읽어
// 무엇을 시켰고(요청) 어떤 순서로 무엇을 했고(진행) 무엇이 바뀌었고(파일) 결과가 뭔지를 뽑는다.
// 대화 기록 형식은 바뀔 수 있다 — 모르는 모양은 조용히 건너뛴다. 명령 원문은 읽지 않고(토큰이 섞일 수 있다)
// 사람이 읽으라고 쓴 description 만 쓴다.
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 24 * 1024 * 1024; // 한 파일에서 뒤쪽 이만큼까지만 읽는다
const REQ_MAX = 3; // 요청은 최대 3개
const NOTE_MAX = 6; // 진행 설명은 최대 6줄
const FLOW_MAX = 10; // 작업 흐름 최대 10단계
const FILE_MAX = 12;

const ms = (iso) => {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) ? t : null;
};

/** 공백·빈 줄을 정리하고 n 글자까지만(말줄임) — 줄바꿈은 살린다 */
export function clipText(text, n) {
  const s = String(text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(0, n - 1).join('').trimEnd() + '…';
}

const oneLine = (text, n) => clipText(String(text || '').replace(/\s+/g, ' '), n);
/** 마크다운 기호(**굵게**·`코드`)는 보고서에서 지저분하다 — 글자만 남긴다 */
const plain = (t) => String(t || '').replace(/\*\*|__|`+/g, '');

/** 사람이 친 글만 — 시스템 알림·명령 출력·도구 결과·끊김 표시는 뺀다 */
function humanText(e) {
  const msg = e.message && typeof e.message === 'object' ? e.message : {};
  if (e.isMeta === true || e.isSidechain === true) return '';
  const c = msg.content;
  let t = '';
  if (typeof c === 'string') t = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b && b.type === 'tool_result')) return '';
    t = c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  }
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!t || /^<(local-command|command-|task-notification)/.test(t) || t.includes('[Request interrupted')) return '';
  return t;
}

function rel(file, cwd) {
  const f = String(file || '');
  if (!f) return '';
  if (cwd) {
    const r = path.relative(cwd, f);
    if (r && !r.startsWith('..') && !path.isAbsolute(r)) return r.split(path.sep).join('/');
  }
  return path.basename(f);
}

/** 대화 파일 하나 → 이 기간의 요약. 읽을 수 없으면 null */
export function digestTranscript(file, sinceMs, untilMs = Date.now()) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - MAX_BYTES);
    const buf = Buffer.alloc(size - start);
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, start + off);
      if (n <= 0) break;
      off += n;
    }
    const text = buf.subarray(0, off).toString('utf8');
    const lines = text.split('\n');
    if (start > 0) lines.shift(); // 반쪽 줄
    const d = { requests: [], texts: [], files: new Map(), skills: new Set(), agents: [], tools: new Set(), flow: [], counts: {}, first: null, last: null, cwd: '' };
    const bump = (k) => { d.counts[k] = (d.counts[k] || 0) + 1; };
    for (const line of lines) {
      if (!line || (!line.includes('"type":"assistant"') && !line.includes('"type":"user"'))) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (!e || (e.type !== 'assistant' && e.type !== 'user')) continue;
      if (typeof e.cwd === 'string' && e.cwd) d.cwd = e.cwd;
      const at = ms(e.timestamp);
      if (at === null || at < sinceMs || at > untilMs) continue;
      if (d.first === null) d.first = at;
      d.last = at;
      if (e.type === 'user') {
        const t = humanText(e);
        if (t && d.requests.length < REQ_MAX) d.requests.push(oneLine(t, 240));
        continue;
      }
      const content = e.message && Array.isArray(e.message.content) ? e.message.content : [];
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) d.texts.push(clipText(plain(b.text), 900));
        if (b.type !== 'tool_use') continue;
        const name = String(b.name || '');
        const inp = b.input && typeof b.input === 'object' ? b.input : {};
        if (name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') {
          const f = rel(inp.file_path || inp.notebook_path, d.cwd);
          if (f) d.files.set(f, d.files.get(f) === 'write' ? 'write' : 'edit');
          bump('edit');
        } else if (name === 'Write') {
          const f = rel(inp.file_path, d.cwd);
          if (f) d.files.set(f, 'write');
          bump('write');
        } else if (name === 'Bash') {
          bump('bash');
          const desc = oneLine(inp.description, 70);
          if (desc && !d.flow.includes(desc)) d.flow.push(desc);
        } else if (name === 'Skill') {
          if (inp.skill) d.skills.add(oneLine(inp.skill, 30));
        } else if (name === 'Agent' || name === 'Task') {
          bump('agent');
          const desc = oneLine(inp.description, 60);
          if (desc && !d.agents.includes(desc)) d.agents.push(desc);
        } else if (name === 'Read') bump('read');
        else if (name === 'Grep' || name === 'Glob') bump('find');
        else if (name === 'WebSearch' || name === 'WebFetch') bump('web');
        else if (name.startsWith('mcp__')) {
          bump('mcp');
          d.tools.add(name.split('__').pop());
        }
      }
    }
    return d;
  } catch {
    return null;
  } finally {
    try { fs.closeSync(fd); } catch { /* 무시 */ }
  }
}

/** 여러 대화 파일(같은 프로젝트의 탭들) → 보고서 구역 하나. 한 일이 하나도 없으면 null */
export function digestSection(who, files, sinceMs, untilMs = Date.now()) {
  const ds = (files || []).map((f) => digestTranscript(f, sinceMs, untilMs)).filter((d) => d && d.first !== null);
  if (!ds.length) return null;
  const sec = { who, request: '', requests: [], result: '', notes: [], files: [], fileCount: 0, skills: [], agents: [], tools: [], flow: [], counts: {}, cmds: 0, minutes: 0 };
  const allFiles = new Map();
  const texts = [];
  let first = Infinity, last = 0;
  for (const d of ds.sort((a, b) => a.first - b.first)) {
    first = Math.min(first, d.first);
    last = Math.max(last, d.last);
    for (const r of d.requests) if (sec.requests.length < REQ_MAX && !sec.requests.includes(r)) sec.requests.push(r);
    texts.push(...d.texts);
    for (const [f, k] of d.files) allFiles.set(f, allFiles.get(f) === 'write' ? 'write' : k);
    for (const s of d.skills) if (!sec.skills.includes(s)) sec.skills.push(s);
    for (const a of d.agents) if (!sec.agents.includes(a)) sec.agents.push(a);
    for (const t of d.tools) if (!sec.tools.includes(t)) sec.tools.push(t);
    for (const f of d.flow) if (!sec.flow.includes(f)) sec.flow.push(f);
    for (const [k, v] of Object.entries(d.counts)) sec.counts[k] = (sec.counts[k] || 0) + v;
  }
  sec.request = sec.requests[0] || '';
  sec.result = texts.length ? texts[texts.length - 1] : '';
  // 진행 설명 — 마지막 글(결과)을 뺀 앞선 말들 중 길이가 있는 것만, 너무 비슷한 건 한 번만
  const seen = new Set();
  for (const t of texts.slice(0, -1)) {
    const line = oneLine(t, 170);
    if (Array.from(line).length < 24 || seen.has(line.slice(0, 30))) continue;
    seen.add(line.slice(0, 30));
    sec.notes.push(line);
  }
  if (sec.notes.length > NOTE_MAX) {
    const step = sec.notes.length / NOTE_MAX; // 고르게 솎는다(처음·끝이 빠지지 않게)
    sec.notes = Array.from({ length: NOTE_MAX }, (_, i) => sec.notes[Math.floor(i * step)]);
  }
  sec.files = [...allFiles].slice(0, FILE_MAX).map(([name, kind]) => ({ name, kind }));
  sec.fileCount = allFiles.size;
  sec.skills = sec.skills.slice(0, 8);
  sec.agents = sec.agents.slice(0, 8);
  sec.tools = sec.tools.slice(0, 8);
  sec.flow = sec.flow.slice(0, FLOW_MAX);
  sec.cmds = sec.counts.bash || 0;
  sec.minutes = Math.max(1, Math.round((last - first) / 60000));
  return sec;
}
