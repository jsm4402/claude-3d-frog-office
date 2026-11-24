import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatReport, saveReport, latestReport, reportDir } from '../server/report.mjs';
import { normalizeConfig } from '../server/config.mjs';

const r = { at: Date.now(), startedAt: Date.now() - 5 * 60000, n: 2, tasks: ['첫째 일', '둘째\n일'], who: ['docs', 'app'] };

test('formatReport: 건수·참여자·한 일이 마크다운으로 나온다', () => {
  const t = formatReport(r);
  assert.match(t, /^## \d\d:\d\d 보고 — 업무 2건 완료 \(약 5분\)/);
  assert.match(t, /- 참여: docs, app/);
  assert.match(t, /  - 둘째 일/); // 줄바꿈은 한 줄로
  assert.match(formatReport({ ...r, tasks: [], who: [] }), /기록된 문장 없음/);
});

test('saveReport: 설정한 폴더에 날짜 파일로 덧붙이고, latestReport 가 돌려준다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rep-'));
  const cfg = { reportDir: dir };
  const file = saveReport(r, cfg);
  saveReport({ ...r, n: 3 }, cfg);
  const body = fs.readFileSync(file, 'utf8');
  assert.match(body, /^# 팀장 보고 \d{4}-\d\d-\d\d/);
  assert.equal(body.match(/^## /gm).length, 2);
  assert.match(latestReport(cfg).text, /업무 3건/);
  assert.equal(reportDir(cfg), path.resolve(dir));
});

test('saveReport: 폴더를 못 만들어도 던지지 않고 null', () => {
  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rep-')), 'file');
  fs.writeFileSync(blocker, 'x');
  assert.equal(saveReport(r, { reportDir: path.join(blocker, 'sub') }), null);
});

test('config: notify·reportDir 정규화', () => {
  assert.equal(normalizeConfig({}).notify, false);
  assert.equal(normalizeConfig({ notify: true }).notify, true);
  assert.equal(normalizeConfig({ notify: 'yes' }).notify, false);
  assert.equal(normalizeConfig({ reportDir: ' reports/out ' }).reportDir, 'reports/out');
});

import { absorb, sectionsOf } from '../server/report.mjs';

test('absorb·sectionsOf: 직원별로 결과·파일·도구·흐름을 모으고 같은 기록은 한 번만 센다', () => {
  const work = new Map();
  const log = [
    { at: '2026-11-23T01:00:00Z', k: 'text', a: '옛날 말' }, // 시작 전 기록은 뺀다
    { at: '2026-11-23T02:00:01Z', k: 'edit', a: 'a.mjs' },
    { at: '2026-11-23T02:00:02Z', k: 'write', a: 'new.md' },
    { at: '2026-11-23T02:00:03Z', k: 'edit', a: 'new.md' },
    { at: '2026-11-23T02:00:04Z', k: 'skill', a: 'xlsx' },
    { at: '2026-11-23T02:00:05Z', k: 'bash', a: '계산표 확인' },
    { at: '2026-11-23T02:00:06Z', k: 'bash', a: '테스트 실행' },
    { at: '2026-11-23T02:00:07Z', k: 'text', a: '끝났습니다' },
  ];
  absorb(work, 'app', log, '2026-11-23T02:00:00Z');
  absorb(work, 'app', log, '2026-11-23T02:00:00Z'); // 두 번 넣어도 그대로
  absorb(work, 'empty', [{ at: '2026-11-23T01:00:00Z', k: 'text', a: 'x' }], '2026-11-23T02:00:00Z');
  const secs = sectionsOf(work);
  assert.equal(secs.length, 1); // 한 일이 없는 'empty' 는 빠진다
  const s = secs[0];
  assert.equal(s.result, '끝났습니다');
  assert.deepEqual(s.files, [{ name: 'a.mjs', kind: 'edit' }, { name: 'new.md', kind: 'write' }]);
  assert.deepEqual(s.skills, ['xlsx']);
  assert.deepEqual(s.flow, ['계산표 확인', '테스트 실행']);
  assert.equal(s.cmds, 2);
  const md = formatReport({ at: Date.now(), startedAt: Date.now() - 60000, n: 1, tasks: [], who: ['app'], sections: secs });
  assert.match(md, /### app/);
  assert.match(md, /- 결과: 끝났습니다/);
  assert.match(md, /- 바뀐 파일 2개: a\.mjs, new\.md\(새로\)/);
  assert.match(md, /- 쓴 도구: 스킬 xlsx/);
  assert.match(md, /- 작업 흐름: 계산표 확인 → 테스트 실행/);
});

import { digestSection, digestTranscript, clipText } from '../server/digest.mjs';
import { enrich } from '../server/report.mjs';

function fakeTranscript(dir, name, entries) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return f;
}

test('digest: 요청·진행·결과·파일·도구·활동량을 대화 기록에서 뽑는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-'));
  const t0 = Date.parse('2026-11-23T02:00:00Z');
  const iso = (m) => new Date(t0 + m * 60000).toISOString();
  const asst = (m, blocks) => ({ type: 'assistant', timestamp: iso(m), cwd: '/proj', message: { content: blocks } });
  const user = (m, content) => ({ type: 'user', timestamp: iso(m), cwd: '/proj', message: { content } });
  const f = fakeTranscript(dir, 'a.jsonl', [
    user(-30, '옛날 요청은 빠져야 한다'),
    user(0, '배달 계산표 엑셀로 만들어줘 <system-reminder>숨김</system-reminder>'),
    asst(1, [{ type: 'text', text: '먼저 기존 폴더를 확인하겠습니다. 프로젝트 폴더에 계산표가 있는지 봅니다.' }, { type: 'tool_use', name: 'Read', input: { file_path: '/proj/a.md' } }]),
    user(1, [{ type: 'tool_result', content: '도구 결과는 요청이 아니다' }]),
    asst(2, [{ type: 'tool_use', name: 'Skill', input: { skill: 'xlsx' } }, { type: 'tool_use', name: 'Bash', input: { command: 'SECRET=abc node x', description: '엑셀 도구 확인' } }]),
    asst(3, [{ type: 'tool_use', name: 'Write', input: { file_path: '/proj/out/calc.py' } }, { type: 'tool_use', name: 'Edit', input: { file_path: '/proj/out/calc.py' } }, { type: 'tool_use', name: 'mcp__ms__outlook_email_search', input: {} }]),
    asst(5, [{ type: 'text', text: '계산표를 만들었습니다.\n\n수식 12개가 모두 맞게 계산됩니다.' }]),
  ]);
  const sec = digestSection('proj', [f], t0 - 60000, t0 + 10 * 60000);
  assert.equal(sec.request, '배달 계산표 엑셀로 만들어줘'); // 시스템 알림 조각은 빠진다
  assert.equal(sec.requests.length, 1); // 도구 결과·옛 요청은 요청이 아니다
  assert.match(sec.result, /계산표를 만들었습니다\.\n\n수식 12개/); // 결과는 줄바꿈을 살려 통째로
  assert.equal(sec.notes.length, 1); // 앞선 말 한 줄이 진행 과정
  assert.deepEqual(sec.files, [{ name: 'out/calc.py', kind: 'write' }]); // 프로젝트 기준 상대경로, 새 파일이 우선
  assert.deepEqual(sec.skills, ['xlsx']);
  assert.deepEqual(sec.tools, ['outlook_email_search']);
  assert.deepEqual(sec.flow, ['엑셀 도구 확인']); // 명령 원문(SECRET)은 읽지 않는다
  assert.equal(JSON.stringify(sec).includes('SECRET'), false);
  assert.deepEqual([sec.counts.read, sec.counts.edit, sec.counts.write, sec.counts.bash], [1, 1, 1, 1]);
  assert.equal(sec.minutes, 5);
  assert.equal(digestTranscript(path.join(dir, 'none.jsonl'), 0), null);
  assert.equal(digestSection('x', [f], t0 + 3600000), null); // 기간에 일이 없으면 구역 없음
});

test('enrich: 대화 기록으로 구역을 자세하게 바꾸고, 못 읽으면 간단한 구역을 그대로 둔다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-'));
  const at = Date.now();
  const f = fakeTranscript(dir, 'b.jsonl', [{ type: 'assistant', timestamp: new Date(at - 1000).toISOString(), cwd: '/p', message: { content: [{ type: 'text', text: '끝냈습니다' }] } }]);
  const simple = [{ who: 'gone', result: '간단', files: [], fileCount: 0, skills: [], agents: [], tools: [], flow: [], cmds: 0 }];
  const r = enrich({ at, startedAt: at - 60000, n: 1, tasks: [], who: ['p', 'gone'], sections: simple, sources: { p: [f], gone: [path.join(dir, 'none.jsonl')] }, sinceMs: at - 60000 });
  assert.deepEqual(r.sections.map((s) => s.who).sort(), ['gone', 'p']);
  assert.equal(r.sections.find((s) => s.who === 'p').result, '끝냈습니다');
  assert.equal(r.sections.find((s) => s.who === 'gone').result, '간단');
  assert.equal(enrich({ at, sections: simple }).sections, simple); // 출처가 없으면 그대로
  assert.equal(clipText('가'.repeat(10), 5), '가가가가…');
});
