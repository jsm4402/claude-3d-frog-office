// 팀장 보고 — 일이 끝나면 (1) 마크다운 파일로 쌓고 (2) 윈도우 알림을 띄우고 (3) 화면에서 다시 볼 수 있게 가장 최근 보고를 기억한다.
// 바깥으로 나가는 건 없다: 파일은 내 PC 폴더, 알림은 내 PC 알림 센터.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { officeHome } from './paths.mjs';
import { digestSection } from './digest.mjs';

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

let latest = null; // { at, n, text }

/** 보고 폴더 — 설정값 > D:\office-reports(윈도우에 D 가 있으면) > ~/.claude-office/reports */
export function reportDir(cfg = {}) {
  if (cfg.reportDir) return path.resolve(cfg.reportDir);
  if (process.env.CLAUDE_OFFICE_REPORT_DIR) return path.resolve(process.env.CLAUDE_OFFICE_REPORT_DIR); // 시험용
  if (process.platform === 'win32' && fs.existsSync('D:\\')) return 'D:\\office-reports';
  return path.join(officeHome(), 'reports');
}

const FLOW_MAX = 4;
const clip = (t, n) => {
  const x = String(t || '').replace(/\s+/g, ' ').trim();
  return x.length > n ? x.slice(0, n - 1) + '…' : x;
};

/** 일하는 동안 직원별 활동 기록(log)을 모아 둔다 — 같은 기록은 한 번만 센다. work: Map(이름 → 누적) */
export function absorb(work, name, log, sinceIso) {
  let w = work.get(name);
  for (const e of log || []) {
    if (!e || !e.k || String(e.at || '') < sinceIso) continue;
    if (!w) work.set(name, (w = { seen: new Set(), result: '', files: new Map(), skills: new Set(), agents: new Set(), tools: new Set(), flow: [], cmds: 0 }));
    const key = `${e.at}|${e.k}|${e.a}`;
    if (w.seen.has(key)) continue;
    if (w.seen.size > 400) w.seen.clear();
    w.seen.add(key);
    const a = clip(e.a, 80);
    if (e.k === 'text' && a) w.result = a;
    else if ((e.k === 'edit' || e.k === 'write') && a) w.files.set(a, w.files.get(a) === 'write' || e.k === 'write' ? 'write' : 'edit');
    else if (e.k === 'skill' && a) w.skills.add(a);
    else if (e.k === 'agent' && a) w.agents.add(a);
    else if ((e.k === 'mcp' || e.k === 'fetch' || e.k === 'search') && a) w.tools.add(a);
    else if (e.k === 'bash') {
      w.cmds++;
      if (a && !w.flow.includes(a) && w.flow.length < FLOW_MAX) w.flow.push(a);
    }
  }
}

/** 모아 둔 기록 → 보고서 구역(직원/프로젝트별). 한 일이 하나도 없으면 빼고, 결과 문장이 있는 쪽을 앞에 둔다 */
export function sectionsOf(work) {
  const out = [];
  for (const [who, w] of work) {
    const files = [...w.files].map(([name, kind]) => ({ name, kind }));
    const sec = { who, result: w.result, files: files.slice(0, 8), fileCount: files.length, skills: [...w.skills].slice(0, 6), agents: [...w.agents].slice(0, 6), tools: [...w.tools].slice(0, 6), flow: [...w.flow], cmds: w.cmds };
    if (sec.result || sec.fileCount || sec.skills.length || sec.agents.length || sec.tools.length || sec.cmds) out.push(sec);
  }
  return out.sort((a, b) => (b.result ? 1 : 0) - (a.result ? 1 : 0) || b.fileCount - a.fileCount);
}

/** 보고서 한 건의 마크다운 — 구역(직원별 요약)이 있으면 그걸 쓰고, 없으면 문장 목록 */
export function formatReport(r) {
  const end = new Date(r.at);
  const mins = Math.max(1, Math.round((r.at - r.startedAt) / 60000));
  const lines = [`## ${clock(end)} 보고 — 업무 ${r.n}건 완료 (약 ${mins}분)`];
  if (r.who.length) lines.push(`- 참여: ${r.who.join(', ')}`);
  const secs = r.sections || [];
  if (secs.length) {
    for (const s of secs) {
      lines.push('', `### ${s.who}${s.minutes ? ` (약 ${s.minutes}분)` : ''}`);
      if (s.request) lines.push(`- 요청: ${s.request}${s.requests && s.requests.length > 1 ? ` (외 ${s.requests.length - 1}건)` : ''}`);
      if (s.result) lines.push(s.result.includes('\n') ? `- 결과:\n${s.result.split('\n').map((l) => `  ${l}`).join('\n')}` : `- 결과: ${s.result}`);
      if (s.notes && s.notes.length) {
        lines.push('- 진행 과정:');
        s.notes.forEach((n, i) => lines.push(`  ${i + 1}. ${n}`));
      }
      if (s.fileCount) lines.push(`- 바뀐 파일 ${s.fileCount}개: ${s.files.map((f) => `${f.name}${f.kind === 'write' ? '(새로)' : ''}`).join(', ')}${s.fileCount > s.files.length ? ' 외' : ''}`);
      const use = [s.skills.length ? `스킬 ${s.skills.join(', ')}` : '', s.agents.length ? `에이전트 ${s.agents.join(', ')}` : '', s.tools.length ? `외부 ${s.tools.join(', ')}` : ''].filter(Boolean);
      if (use.length) lines.push(`- 쓴 도구: ${use.join(' / ')}`);
      if (s.flow.length) lines.push(`- 작업 흐름: ${s.flow.join(' → ')}${s.cmds > s.flow.length ? ` (명령 ${s.cmds}번)` : ''}`);
      const c = s.counts || {};
      const act = [['read', '읽기'], ['edit', '수정'], ['write', '새 파일'], ['bash', '명령'], ['find', '찾기'], ['web', '웹'], ['agent', '에이전트'], ['mcp', '외부 연결']].filter(([k]) => c[k]).map(([k, l]) => `${l} ${c[k]}`);
      if (act.length) lines.push(`- 활동량: ${act.join(' · ')}`);
    }
  } else if (r.tasks.length) {
    lines.push('- 한 일(마지막 보고 문장 기준):');
    for (const t of r.tasks) lines.push(`  - ${t.replace(/\s+/g, ' ').trim()}`);
  } else lines.push('- 한 일: 기록된 문장 없음');
  return lines.join('\n') + '\n';
}

/** 파일에 덧붙인다. 실패해도 서버는 계속 돈다 — 저장 위치를 돌려준다(못 쓰면 null) */
export function saveReport(r, cfg = {}) {
  const text = formatReport(r);
  latest = { at: r.at, n: r.n, text, sections: r.sections || [] };
  try {
    const dir = reportDir(cfg);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${stamp(new Date(r.at))}.md`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, `# 팀장 보고 ${stamp(new Date(r.at))}\n\n`);
    fs.appendFileSync(file, text + '\n');
    return file;
  } catch (e) {
    console.error(new Date().toISOString(), 'report save failed:', e.message);
    return null;
  }
}

/** 확인 완료 — 가장 최근 보고에 표시하고 오늘 파일에도 한 줄 남긴다 */
export function markAcked(cfg = {}, now = Date.now()) {
  const cur = latestReport(cfg);
  if (!cur || cur.acked) return cur;
  const at = clock(new Date(now));
  latest = { ...cur, acked: at };
  try {
    const file = path.join(reportDir(cfg), `${stamp(new Date(now))}.md`);
    if (fs.existsSync(file)) fs.appendFileSync(file, `> 확인 완료 ${at}

`);
  } catch (e) {
    console.error(new Date().toISOString(), 'ack write failed:', e.message);
  }
  return latest;
}

/** 화면용 — 가장 최근 보고(없으면 null). 서버를 다시 켠 뒤엔 오늘 파일 끝을 읽는다 */
export function latestReport(cfg = {}) {
  if (latest) return latest;
  try {
    const file = path.join(reportDir(cfg), `${stamp(new Date())}.md`);
    const parts = fs.readFileSync(file, 'utf8').split(/\n(?=## )/);
    const last = parts.length > 1 ? parts[parts.length - 1].trim() : '';
    return last ? { at: fs.statSync(file).mtimeMs, n: null, text: last + '\n' } : null;
  } catch {
    return null;
  }
}

/** 윈도우 알림 — 글은 환경변수로만 넘겨 명령 조각에 섞이지 않게 한다. 다른 OS 는 아무것도 안 한다 */
export function notifyReport(r) {
  if (process.platform !== 'win32') return false;
  const first = (r.sections && r.sections[0] && (r.sections[0].result || r.sections[0].request)) || r.tasks[0] || '';
  const head = first ? `: ${String(first).replace(/\s+/g, ' ').trim().slice(0, 70)}` : '';
  const script = [
    "$ErrorActionPreference='Stop'",
    '[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime]|Out-Null',
    '$t=[Security.SecurityElement]::Escape($env:OFFICE_TITLE)',
    '$b=[Security.SecurityElement]::Escape($env:OFFICE_BODY)',
    '$x=New-Object Windows.Data.Xml.Dom.XmlDocument',
    "$x.LoadXml(\"<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>\")",
    '$n=[Windows.UI.Notifications.ToastNotification]::new($x)',
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($n)",
  ].join(';');
  const enc = Buffer.from(script, 'utf16le').toString('base64');
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], {
    windowsHide: true, timeout: 15000,
    env: { ...process.env, OFFICE_TITLE: '팀장 보고', OFFICE_BODY: `업무 ${r.n}건 끝났습니다${head}` },
  }, (err) => {
    if (err) console.error(new Date().toISOString(), 'notify failed:', err.message);
  });
  return true;
}

/**
 * 보고 순간에 대화 기록을 읽어 구역을 자세하게 바꾼다. 못 읽은 프로젝트는 일하는 동안 모아 둔 간단한 구역을 그대로 둔다.
 * r.sources: { 프로젝트이름: [대화 파일…] }, r.sinceMs: 읽기 시작 시각
 */
export function enrich(r) {
  if (!r || !r.sources || !r.sinceMs) return r;
  const rich = new Map();
  for (const [who, files] of Object.entries(r.sources)) {
    try {
      const s = digestSection(who, files, r.sinceMs, r.at);
      if (s) rich.set(who, s);
    } catch (e) {
      console.error(new Date().toISOString(), 'digest failed:', who, e && e.message);
    }
  }
  if (!rich.size) return r;
  const simple = (r.sections || []).filter((s) => !rich.has(s.who));
  const sections = [...rich.values(), ...simple].sort((a, b) => (b.fileCount || 0) - (a.fileCount || 0) || (b.minutes || 0) - (a.minutes || 0));
  return { ...r, sections };
}

/** 서버가 snapshot 에 꽂아 주는 처리기 — 설정은 보고 때마다 새로 읽는다 */
export function makeHandler(loadCfg) {
  return (r0) => {
    const cfg = loadCfg();
    const r = enrich(r0);
    saveReport(r, cfg);
    if (cfg.notify) notifyReport(r);
  };
}
