// GET /api/office 응답 조립 — 세션 카드 + 대화 기록 대체 모드를 합쳐 프로젝트(루트 폴더)별 한 명으로.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { loadConfig } from './config.mjs';
import { IS_WIN, pathKey, settingsFile } from './paths.mjs';
import { cardAlive, processStarts } from './liveness.mjs';
import { cleanupCards, mtimeOf, readCards, recentTranscripts, transcriptFor } from './sessions.mjs';
import { LOG_N, MAX_SUBS, oneLine, readTranscript, runningSubagents } from './activity.mjs';
import { installedEvents } from './hooks-config.mjs';
import { absorb, sectionsOf } from './report.mjs';

export const API_VERSION = 1;
const GIT_TTL_MS = 10 * 60 * 1000; // 루트·커밋 수는 10분 캐시 — git 을 3초마다 두드리지 않게
const ANSWERED_MS = 1500; // 결재 카드보다 대화가 이만큼 뒤에 움직였으면 사용자가 답한 것
const END_QUIET_MS = 5000; // end_turn 뒤 이만큼 조용하면 쉬는 중(Esc·Stop 훅 누락 대비)
const FALLBACK_WORKING_MS = 10 * 60 * 1000; // 대체 모드: 이만큼 조용하면 일 안 하는 것으로 본다
const IDLE_WORKING_MS = 10 * 60 * 1000; // 훅 카드가 '일하는 중'인데 이만큼 조용하면 쉬는 중(Stop 훅 누락 대비)
const LEAD_MIN_WORK_MS = 15_000; // 팀장은 이만큼 이어진 일만 보고한다(깜빡임으로 보고가 터지지 않게)
const LEAD_REPORT_MS = 30 * 60_000; // 보고 자세(손 든 모양)를 유지하는 시간 — 사용자가 '확인 완료'를 누르면 바로 내린다
const leadState = { since: 0, n: 0, reportN: 0, head: '', reportUntil: 0, tasks: [], who: [], work: new Map(), src: new Map() };
const COMMUTE_GAP_S = 30; // 가짜 직원 출퇴근이 문 앞에 몰리지 않게 한 명씩 이만큼 간격을 둔다
const CALL_LINGER_MS = 10 * 60_000; // 근무시간 밖에 불려 나온 가짜 직원이 일이 끝난 뒤 사무실에 남아 있는 시간(들락날락 방지)
const callState = { until: new Map() }; // 이름 → 근무시간 밖인데 이 시각까지는 사무실에 있는다
let reportHandler = null;

/**
 * 가짜 직원 i(전체 n명 중)가 근무시간이라 사무실에 있는가 — 서버 PC 의 현지 시각 기준.
 * hours 가 비어 있으면 항상 있다. 출근은 시작 시각까지 한 명씩 먼저 들어오고(마지막 사람이 정각), 퇴근은 끝 시각부터 한 명씩 나간다.
 */
export function onShift(hours, now, i = 0, n = 1) {
  if (!Array.isArray(hours) || hours.length !== 2) return true;
  const d = new Date(now);
  const sec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  return sec >= hours[0] * 3600 - (n - 1 - i) * COMMUTE_GAP_S && sec < hours[1] * 3600 + i * COMMUTE_GAP_S;
}

/** '확인 완료' — 손 든 자세를 내린다. 보고 중이었으면 true */
export function ackReport(now = Date.now()) {
  const was = now < leadState.reportUntil;
  leadState.reportUntil = 0;
  return was;
}

/** 팀장이 보고할 때마다 한 번 불린다(파일 저장·알림용). 테스트·데모에서는 꽂지 않는다 */
export function setReportHandler(fn) {
  reportHandler = typeof fn === 'function' ? fn : null;
}
const CLEANUP_EVERY_MS = 10 * 60 * 1000;
const ASK_CHARS = 80;
const PRIORITY = { decision: 0, working: 1, rest: 2 };

const rootCache = new Map(); // cwd → { at, root }
const commitCache = new Map(); // root → { at, n }
let hookCache = { file: '', mtimeMs: -2, value: false };
let lastCleanup = 0;

export function forget() {
  rootCache.clear();
  commitCache.clear();
  hookCache = { file: '', mtimeMs: -2, value: false };
  lastCleanup = 0;
  Object.assign(leadState, { since: 0, n: 0, reportN: 0, head: '', reportUntil: 0, tasks: [], who: [], work: new Map(), src: new Map() });
  callState.until.clear();
}

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 3000, windowsHide: true, encoding: 'utf8' }, (err, out) => {
      resolve(err ? null : String(out).trim());
    });
  });
}

/** 프로젝트 루트 = git 최상위, 아니면 cwd 그대로(정규화) */
export async function gitRoot(cwd, now = Date.now()) {
  const hit = rootCache.get(cwd);
  if (hit && now - hit.at < GIT_TTL_MS) return hit.root;
  let root = path.resolve(cwd);
  if (fs.existsSync(cwd)) {
    const top = await git(cwd, ['rev-parse', '--show-toplevel']);
    if (top) root = path.resolve(top);
  }
  if (rootCache.size > 1000) rootCache.clear();
  rootCache.set(cwd, { at: now, root });
  return root;
}

/** 커밋 수 — git 저장소가 아니거나 못 세면 null(=보통 크기로 그린다) */
export async function commitCount(root, now = Date.now()) {
  const hit = commitCache.get(root);
  if (hit && now - hit.at < GIT_TTL_MS) return hit.n;
  const out = fs.existsSync(root) ? await git(root, ['rev-list', '--count', 'HEAD']) : null;
  const n = out && /^\d+$/.test(out) ? Number(out) : null;
  if (commitCache.size > 1000) commitCache.clear();
  commitCache.set(root, { at: now, n });
  return n;
}

/** settings.json 에 우리 훅이 깔려 있나 — 파일이 그대로면 다시 안 읽는다 */
function hooksInstalled() {
  const file = settingsFile();
  const m = fs.existsSync(file) ? mtimeOf(file) : -1;
  if (hookCache.file !== file || hookCache.mtimeMs !== m) {
    hookCache = { file, mtimeMs: m, value: m >= 0 && installedEvents(file).length > 0 };
  }
  return hookCache.value;
}

/** 카드 상태 + 대화 기록 보정. 훅이 못 본 일(터미널에서 바로 승인·Esc·API 오류)을 대화로 알아본다 */
export function cardStatus(card, last, now = Date.now(), mtimeMs = 0) {
  let kind = PRIORITY[card.kind] !== undefined ? card.kind : 'rest';
  const wrote = Date.parse(String(card.updatedAt || '')) || 0;
  // '일 끝' 도장(Stop)이 안 찍힌 채 오래 조용하면 쉬는 중으로 본다(승인 대기는 그대로 둔다)
  if (kind === 'working') {
    const lastAt = last && Number.isFinite(last.at) ? last.at : 0;
    const quietSince = Math.max(wrote, lastAt, mtimeMs || 0);
    if (quietSince > 0 && now - quietSince > IDLE_WORKING_MS) kind = 'rest';
  }
  if (!last || !Number.isFinite(last.at)) return kind;
  if (kind === 'decision' && last.at > wrote + ANSWERED_MS) kind = 'working'; // 사용자가 답했다
  if (kind === 'working' && last.at > wrote) {
    // Esc 로 끊으면 Stop 훅이 안 울린다 — 대화에 남은 끊김 표시·턴 끝으로 쉬는 중을 알아본다
    if (last.interrupted) kind = 'rest';
    else if (last.type === 'assistant' && (last.apiError || (last.endTurn && now - last.at > END_QUIET_MS))) kind = 'rest';
  }
  return kind;
}

/** 대체 모드(훅 카드 없음) 상태 — 승인 대기는 알 수 없다 */
export function transcriptStatus(last, mtimeMs, now = Date.now()) {
  if (!last || last.interrupted) return 'rest';
  if (last.type === 'assistant' && (last.endTurn || last.apiError)) return 'rest';
  return now - Math.max(mtimeMs || 0, last.at || 0) < FALLBACK_WORKING_MS ? 'working' : 'rest';
}

const nameKey = (s) => (IS_WIN ? String(s).toLowerCase() : String(s));

function matches(list, name, key) {
  return list.some((x) => nameKey(x) === nameKey(name) || pathKey(x) === key);
}

function homeOf(homes, name, key) {
  for (const [k, v] of Object.entries(homes)) {
    if (v === 'server' && (nameKey(k) === nameKey(name) || pathKey(k) === key)) return 'server';
  }
  return null;
}

/** 살아 있는 세션들 — 훅 카드 먼저, 카드 없는 최근 대화는 대체 모드로 */
function collectSessions(cfg, now, starts) {
  const cards = readCards();
  const known = new Set(cards.map((c) => c.sessionId)); // ended 카드도 대체 모드를 막는다(유령 방지)
  const out = [];
  for (const card of cards) {
    if (card.kind === 'ended') continue;
    const transcript = transcriptFor(card, now);
    const tm = transcript ? mtimeOf(transcript) : 0;
    if (!cardAlive(card, { starts, now, transcriptMtimeMs: tm, staleHours: cfg.staleHours })) continue;
    const info = readTranscript(transcript);
    const cwd = (typeof card.cwd === 'string' && card.cwd) || info.cwd;
    if (!cwd) continue;
    const status = cardStatus(card, info.last, now, tm);
    out.push({
      cwd,
      status,
      ask: status === 'decision' ? oneLine(card.message, ASK_CHARS) : '',
      at: Date.parse(String(card.updatedAt || '')) || 0,
      source: 'hook',
      transcript,
      info,
    });
  }
  if (cfg.fallbackMinutes > 0) {
    for (const t of recentTranscripts(cfg.fallbackMinutes, now)) {
      if (known.has(t.sessionId)) continue;
      const info = readTranscript(t.file);
      if (!info.cwd) continue;
      out.push({ cwd: info.cwd, status: transcriptStatus(info.last, t.mtimeMs, now), ask: '', at: t.mtimeMs, source: 'transcript', transcript: t.file, info });
    }
  }
  return { sessions: out, cardCount: cards.length };
}

/** 스킬을 방금 부른 기록(log 의 k:'skill') → 꼬마 직원. SKILL_MINI_MS 동안만 서 있다. 같은 스킬을 연달아 불러도 한 명 */
const SKILL_MINI_MS = 120_000;
function skillSubs(items, now) {
  const seen = new Map();
  for (const s of items) {
    for (const e of s.info.log) {
      if (e.k !== 'skill' || !e.a) continue;
      const at = Date.parse(String(e.at || ''));
      if (!Number.isFinite(at) || now - at > SKILL_MINI_MS || at - now > 60_000) continue;
      if (!seen.has(e.a) || at > seen.get(e.a)) seen.set(e.a, at);
    }
  }
  return [...seen].sort((a, b) => a[1] - b[1]).map(([name]) => ({
    id: `skill-${name}`, type: 'Skill', desc: name, doing: null,
  }));
}

/** 스냅샷 한 장. opts: now·cfg·starts(시험용 주입) */
export async function buildSnapshot(opts = {}) {
  const now = opts.now ?? Date.now();
  const cfg = opts.cfg ?? loadConfig();
  if (opts.cleanup || now - lastCleanup > CLEANUP_EVERY_MS) {
    lastCleanup = now;
    cleanupCards(now);
  }
  const starts = opts.starts !== undefined ? opts.starts : processStarts(now);
  const { sessions, cardCount } = collectSessions(cfg, now, starts);

  const cwds = [...new Set(sessions.map((s) => s.cwd))];
  const roots = new Map(await Promise.all(cwds.map(async (c) => [c, await gitRoot(c, now)])));
  const groups = new Map(); // pathKey(root) → { root, items }
  for (const s of sessions) {
    const root = roots.get(s.cwd);
    const key = pathKey(root);
    if (!groups.has(key)) groups.set(key, { root, items: [] });
    groups.get(key).items.push(s);
  }

  const people = [];
  const srcByName = new Map(); // 프로젝트 이름 → 대화 파일들(보고서가 나중에 자세히 읽는다)
  for (const [key, { root, items }] of groups) {
    const base = path.basename(root) || root;
    if (matches(cfg.hide, base, key)) continue;
    const status = items.map((s) => s.status).sort((a, b) => PRIORITY[a] - PRIORITY[b])[0];
    const asks = items.filter((s) => s.status === 'decision').sort((a, b) => b.at - a.at);
    const commits = await commitCount(root, now);
    const subs = items.flatMap((s) => runningSubagents(s.transcript, now));
    if (cfg.skillMinis) subs.push(...skillSubs(items, now));
    // 한 프로젝트에 대화가 둘 이상이면(탭·/clear 직후) 가장 최근에 움직인 쪽이 '지금 하는 일'
    const lastAt = (s) => (s.info.log.length ? s.info.log[s.info.log.length - 1].at : '');
    const latest = items.reduce((a, b) => (lastAt(b) > lastAt(a) ? b : a));
    const log = items.flatMap((s) => s.info.log).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(-LOG_N);
    srcByName.set(base, items.map((s) => s.transcript).filter(Boolean));
    people.push({
      id: root,
      name: base,
      path: root,
      status,
      pending: asks.length,
      ask: asks.length ? asks[0].ask : '',
      sessions: items.length,
      source: items.some((s) => s.source === 'hook') ? 'hook' : 'transcript',
      commits,
      kid: commits !== null && commits < cfg.kidCommits,
      home: homeOf(cfg.homes, base, key),
      subs: subs.slice(0, MAX_SUBS),
      subCount: subs.length,
      doing: latest.info.doing,
      log,
    });
  }

  // 가짜 직원(config.guests) — 항상 쉬는 장식. 진짜 프로젝트와 이름이 같으면 만들지 않는다
  // guestsWork 가 켜져 있으면, 지금 진짜로 벌어지는 일(일하는 직원·서브에이전트·스킬)을 가짜 직원에게 차례로 하달한다
  const tasks = cfg.guestsWork
    ? people.flatMap((p) => [
        ...(p.status === 'working' ? [p.doing || null] : []),
        ...p.subs.map((x) => x.doing || { k: 'skill', a: x.desc }),
      ])
    : [];
  // 팀장(config.lead): 일이 생기면 팀장이 먼저 일어나 필요한 만큼 소집·하달하고, 끝나면 보고(결재 대기 모양)한다
  const lead = cfg.lead && (cfg.guests || []).some((g) => nameKey(g) === nameKey(cfg.lead)) ? cfg.lead : '';
  const staff = (cfg.guests || []).filter((g) => !lead || nameKey(g) !== nameKey(lead));
  const crew = Math.min(tasks.length, staff.length); // 소집 인원 = 일 수(자리 수까지)
  const firstText = (t) => (t && typeof t === 'object' ? String(t.a || '') : '');
  if (lead) {
    if (tasks.length || leadState.since) {
      const sinceIso = new Date((leadState.since || now) - 90_000).toISOString(); // 일 시작 직전 활동까지 담는다
      for (const p of people) {
        if (p.id.startsWith('/guest/')) continue;
        absorb(leadState.work, p.name, p.log, sinceIso);
        if (leadState.work.has(p.name)) {
          const set = leadState.src.get(p.name) || new Set();
          for (const f of srcByName.get(p.name) || []) set.add(f);
          leadState.src.set(p.name, set);
        }
      }
    }
    if (tasks.length) {
      if (!leadState.since) Object.assign(leadState, { since: now, tasks: [], who: [], work: new Map(), src: new Map() });
      leadState.n = Math.max(leadState.n, tasks.length);
      leadState.head = tasks.map(firstText).find(Boolean) || leadState.head;
      leadState.reportUntil = 0;
      for (const t of tasks) {
        const x = oneLine(firstText(t), 120);
        if (x && !leadState.tasks.includes(x) && leadState.tasks.length < 12) leadState.tasks.push(x);
      }
      for (const p of people) {
        if (p.status === 'working' && !p.id.startsWith('/guest/') && !leadState.who.includes(p.name) && leadState.who.length < 12) leadState.who.push(p.name);
      }
    } else if (leadState.since) {
      if (now - leadState.since >= LEAD_MIN_WORK_MS) {
        leadState.reportUntil = now + LEAD_REPORT_MS;
        leadState.reportN = leadState.n;
        if (reportHandler) {
          try {
            reportHandler({ at: now, startedAt: leadState.since, n: leadState.n, tasks: [...leadState.tasks].reverse(), who: [...new Set([...leadState.who, ...leadState.work.keys()])], sections: sectionsOf(leadState.work), sources: Object.fromEntries([...leadState.src].map(([k, v]) => [k, [...v]])), sinceMs: leadState.since - 90_000 });
          } catch (e) {
            console.error(new Date().toISOString(), 'report handler failed:', e && e.message);
          }
        }
      }
      Object.assign(leadState, { since: 0, n: 0, work: new Map(), src: new Map() });
    }
  }
  const reporting = lead && now < leadState.reportUntil;
  // 근무시간(config.guestHours): 시간 밖에는 가짜 직원이 퇴근해 있다. 그래도 일이 생기면 팀장과 맡을 사람만 다시 출근하고,
  // 일이 끝난 뒤 CALL_LINGER_MS 동안 머물다 다시 퇴근한다. 팀장 보고(파일·알림)는 근무시간과 상관없이 그대로 돈다.
  const guestList = cfg.guests || [];
  let given = 0;
  for (let gi = 0; gi < guestList.length; gi++) {
    const g = guestList[gi];
    if (people.some((p) => nameKey(p.name) === nameKey(g))) continue;
    const isLead = lead && nameKey(g) === nameKey(lead);
    let status = 'rest';
    let doing = '';
    let ask = '';
    if (isLead) {
      if (tasks.length) {
        status = 'working';
        doing = { k: 'text', a: `업무 ${tasks.length}건 하달 · ${crew}명 소집` };
      } else if (reporting) {
        status = 'decision';
        ask = `보고드립니다 — 업무 ${leadState.reportN}건 끝났습니다${leadState.head ? `: ${oneLine(leadState.head, 50)}` : ''}`;
      }
    } else if (given < crew) {
      status = 'working';
      doing = tasks[given++] || '';
    }
    if (onShift(cfg.guestHours, now, gi, guestList.length)) callState.until.delete(g);
    else {
      if (status !== 'rest') callState.until.set(g, now + CALL_LINGER_MS); // 불려 나왔다
      if (!((callState.until.get(g) || 0) > now)) continue; // 퇴근해 있다
    }
    people.push({
      id: `/guest/${g}`, name: g, path: `/guest/${g}`, status, pending: status === 'decision' ? 1 : 0, ask, sessions: 1,
      source: 'transcript', commits: null, kid: false, home: null, subs: [], subCount: 0, doing, log: [],
      ...(isLead ? { lead: true } : {}),
    });
  }

  // 같은 폴더 이름이 둘이면 "이름 (부모)" 로 가른다
  const count = new Map();
  for (const p of people) count.set(nameKey(p.name), (count.get(nameKey(p.name)) || 0) + 1);
  for (const p of people) {
    if (count.get(nameKey(p.name)) > 1) p.name = `${p.name} (${path.basename(path.dirname(p.path))})`;
  }
  people.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    version: API_VERSION,
    now: new Date(now).toISOString(),
    hooks: cardCount > 0 || hooksInstalled(),
    demo: false,
    people,
  };
}
