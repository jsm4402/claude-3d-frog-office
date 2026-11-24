#!/usr/bin/env node
// 적용 — 훅 설치 → config.json(없으면) → 서버 시작 → 브라우저 열기. 사용법: node scripts/setup.mjs [--no-open] [--dry-run]
import fs from 'node:fs';
import { configFile, logFile, officeHome, settingsFile } from '../server/paths.mjs';
import { defaultConfigText, loadConfig, resolvePort } from '../server/config.mjs';
import { EVENTS, buildCommand, installHooks, readSettingsStrict, writeSettings } from '../server/hooks-config.mjs';
import { health, openBrowser, portBusy, startDetached, urlOf, waitHealth } from '../server/control.mjs';
import { reportDir } from '../server/report.mjs';
import { fail, has, requireNode, say } from './common.mjs';

requireNode();
const dryRun = has('--dry-run');
const noOpen = has('--no-open');

const file = settingsFile();
let current;
try {
  current = readSettingsStrict(file);
} catch (e) {
  // 못 읽는 settings.json 은 절대 덮어쓰지 않는다 — 사용자의 다른 설정이 날아간다
  fail(`${e.message}\n→ ${file} 를 고친 뒤 다시 실행하세요. 아무것도 바꾸지 않았습니다.`,
    `→ Fix ${file} and run again. Nothing was changed.`);
}
const command = buildCommand();
const plan = installHooks(current.settings, command);
const cfgExists = fs.existsSync(configFile());

if (dryRun) {
  say('[미리보기] 실제로는 아무것도 바꾸지 않습니다.', '[dry run] Nothing will be changed.');
  console.log(`settings.json: ${file}${current.existed ? '' : ' (새로 만듦 / will be created)'}`);
  console.log(`hook command: ${command}`);
  console.log(`  add: ${plan.added.join(', ') || '-'}`);
  console.log(`  update: ${plan.updated.join(', ') || '-'}`);
  console.log(`  already: ${plan.skipped.join(', ') || '-'}`);
  console.log(`config.json: ${configFile()}${cfgExists ? ' (있음 / exists)' : ' (가짜 직원·팀장 보고를 켠 채로 만듦 / will be created with guests and the team-lead report on)'}`);
  console.log(`server: ${urlOf(resolvePort())}`);
  process.exit(0);
}

let backup = null;
if (plan.changed) {
  try {
    backup = writeSettings(file, plan.settings);
  } catch (e) {
    fail(`settings.json 을 쓰지 못했습니다: ${e.message}`, `Could not write settings.json: ${e.message}`);
  }
}
try {
  fs.mkdirSync(officeHome(), { recursive: true });
  if (!cfgExists) fs.writeFileSync(configFile(), defaultConfigText());
} catch (e) {
  fail(`상태 폴더를 만들지 못했습니다: ${e.message}`, `Could not create ${officeHome()}: ${e.message}`);
}

const port = resolvePort(loadConfig());
const url = urlOf(port);
let h = await health(port);
if (!h) {
  if (await portBusy(port)) {
    fail(`포트 ${port} 를 다른 프로그램이 쓰고 있습니다. ${configFile()} 의 "port" 를 바꾼 뒤 다시 실행하세요.`,
      `Port ${port} is used by another program. Change "port" in ${configFile()} and run again.`);
  }
  startDetached();
  h = await waitHealth(port, 8000);
}
if (!h) {
  fail(`훅은 설치했지만 서버가 8초 안에 응답하지 않았습니다. 로그: ${logFile()}`,
    `Hooks are installed, but the server did not answer within 8 seconds. Log: ${logFile()}`);
}
if (!noOpen) openBrowser(url);

const n = EVENTS.length;
const hookKo = `훅 ${n}개(새로 ${plan.added.length}·고침 ${plan.updated.length}·이미 ${plan.skipped.length})`;
const hookEn = `${n} hooks (${plan.added.length} new, ${plan.updated.length} updated, ${plan.skipped.length} already there)`;
if (backup) console.log(`backup: ${backup}`);
say(`완료: 3D 사무실 ${url} — ${hookKo}. 이미 열려 있던 Claude 세션은 다시 켜면 승인 대기까지 보입니다.`,
  `Done: 3D office at ${url} — ${hookEn}. Restart Claude sessions that were already open to see permission prompts too.`);

// 가짜 직원·팀장 보고가 켜져 있는지, 보고 파일이 어디에 쌓이는지 알린다(대화 요약이 파일로 남으니 숨기지 않는다)
const cfg = loadConfig();
if (cfg.lead && cfg.guests.includes(cfg.lead)) {
  say(`가짜 직원 ${cfg.guests.length}명과 팀장 보고(${cfg.lead})가 켜져 있습니다. 일이 끝나면 작업 요약이 ${reportDir(cfg)} 에 파일로 쌓입니다${cfg.notify ? ' (윈도우 알림 포함)' : ''}. 내 컴퓨터 밖으로는 나가지 않습니다. 끄려면 ${configFile()} 에서 "lead" 를 "" 로 바꾸세요.`,
    `${cfg.guests.length} guest employees and the team-lead report (${cfg.lead}) are on. When work finishes, a summary is appended to a file in ${reportDir(cfg)}${cfg.notify ? ' (with a Windows notification)' : ''}. Nothing leaves this computer. To turn it off, set "lead" to "" in ${configFile()}.`);
} else if (cfgExists) {
  say(`이미 있던 config.json 은 건드리지 않았습니다. 가짜 직원·스킬 꼬마·팀장 보고를 켜려면 Claude 에게 "가짜 직원 넣어줘"라고 말하거나 README 의 '이 판에서 더한 것'을 보세요.`,
    `Your existing config.json was left as is. To turn on guests, skill minis and the team-lead report, see the README (Korean section '이 판에서 더한 것').`);
}
