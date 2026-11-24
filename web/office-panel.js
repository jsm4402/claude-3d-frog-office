"use strict";
// 오른쪽 패널 — 사무실 사람들(누르면 펼쳐 자세히: 경로·세션·커밋·서브에이전트·지금 하는 일)
// + 살아 움직이는 활동 로그(한 줄씩 흘려 넣는다). 글은 전부 textContent 로만 넣는다.

const OfficePanel = (() => {
  const $ = id => document.getElementById(id);
  const t = (k, v) => I18N.t(k, v);
  const P = { people: [], sel: null, items: [], seen: new Set(), queue: [], primed: false, pick: null, report: null, reportAt: 0 };
  const LOG_MAX = 60;

  // 화면의 상태 = 승인 대기 > 일(본체가 쉬어도 서브에이전트가 일하면 일하는 중) > 쉼 — office-life.js 와 같은 잣대
  const modeOf = d => (d.status === "decision" ? "decision" : d.status === "working" || d.subCount > 0 ? "working" : "rest");
  const STATUS = { decision: "ask", working: "work", rest: "rest" };
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function dot(color) { const d = el("i", "o-dot"); d.style.background = color; return d; }

  // ---------- 사람 목록 ----------
  function what(d, open) {
    const mode = modeOf(d);
    if (mode === "decision") return I18N.cut(I18N.ask(d.ask) || t("needs"), open ? 80 : 40);
    if (mode === "working") return I18N.act(d.doing) || (d.subCount ? t("doing.subs") : t("doing.work"));
    return open ? t("d.idle") : "";
  }
  function subLine(s) {
    const name = [s.type, s.desc].filter(Boolean).join(" · ") || t("d.subs");
    return `🐣 ${name}`;
  }
  function details(d) {
    const box = el("div", "o-more");
    if (d.path) {
      const p = el("p", "o-path");
      p.append(el("span", "o-k", t("d.path")), el("code", null, d.path));
      box.append(p);
    }
    const facts = [t("d.sessions", { n: d.sessions || 1 })];
    if (d.commits != null) facts.push(t("d.commits", { n: d.commits }));
    if (d.pending > 1) facts.push(t("d.pending", { n: d.pending }));
    if (d.source === "transcript") facts.push(t("d.transcript"));
    box.append(el("p", "o-facts", facts.join(" · ")));
    const subs = d.subs || [];
    if (subs.length || d.subCount) {
      box.append(el("p", "o-k o-subhead", `${t("d.subs")} ${d.subCount || subs.length}`));
      const ul = el("ul", "o-subs");
      for (const s of subs) {
        const li = el("li", null);
        li.append(el("span", "o-subname", subLine(s)), el("span", "o-subdoing", I18N.act(s.doing) || t("d.subIdle")));
        ul.append(li);
      }
      const more = (d.subCount || 0) - subs.length;
      if (more > 0) ul.append(el("li", "o-submore", t("d.more", { n: more })));
      box.append(ul);
    }
    if (d.lead) {                                    // 팀장: 가장 최근 보고서를 펼쳐 보여 준다
      box.append(el("p", "o-k o-subhead", "최근 보고"));
      box.append(reportView(P.report));
      loadReport();
    }
    return box;
  }
  // 확인 완료 — 누르면 팀장이 손을 내리고 보고서에 확인 시각이 남는다(사무실 화면에서 서버로 가는 유일한 쓰기)
  function ackRow(r) {
    const row = el("p", "o-report-ack");
    if (r.acked) { row.append(el("span", "o-chip rest", "확인 완료 " + r.acked)); return row; }
    const b = el("button", "o-ackbtn", "확인 완료");
    b.type = "button";
    b.onclick = async () => {
      b.disabled = true;
      try {
        const res = await fetch("/api/report/ack", { method: "POST", headers: { "x-office-ack": "1" } });
        const j = await res.json();
        if (j.report) { P.report = j.report; render(P.people, P.sel); }
      } catch { b.disabled = false; }
    };
    row.append(b);
    return row;
  }
  // 보고서 — 직원(프로젝트)별로 결과·파일·쓴 도구·작업 흐름을 한눈에. 구역이 없는 옛 보고는 글 그대로 보여 준다
  function reportView(r) {
    const box = el("div", "o-reportbox");
    if (!r) { box.append(el("p", "o-report-empty", "아직 보고가 없습니다")); return box; }
    const head = el("p", "o-report-head", (r.text.split("\n")[0] || "").replace(/^##\s*/, ""));
    box.append(head, ackRow(r));
    if (!r.sections || !r.sections.length) { box.append(el("pre", "o-report", r.text)); return box; }
    for (const s of r.sections) {
      const sec = el("div", "o-report-sec");
      sec.append(el("b", "o-report-who", s.who + (s.minutes ? " · 약 " + s.minutes + "분" : "")));
      const row = (k, v, cls) => { if (v) { const p = el("p", "o-report-row" + (cls ? " " + cls : "")); p.append(el("span", "o-k", k), el("span", null, " " + v)); sec.append(p); } };
      row("요청", s.request ? s.request + (s.requests && s.requests.length > 1 ? " (외 " + (s.requests.length - 1) + "건)" : "") : "");
      row("결과", s.result, "o-report-long");
      if (s.notes && s.notes.length) {
        sec.append(el("p", "o-k o-report-row", "진행 과정"));
        const ol = el("ol", "o-report-notes");
        for (const n of s.notes) ol.append(el("li", null, n));
        sec.append(ol);
      }
      row("바뀐 파일 " + (s.fileCount || 0) + "개", (s.files || []).map(f => f.name + (f.kind === "write" ? "(새로)" : "")).join(", ") + (s.fileCount > (s.files || []).length ? " 외" : ""));
      row("쓴 도구", [s.skills.length ? "스킬 " + s.skills.join(", ") : "", s.agents.length ? "에이전트 " + s.agents.join(", ") : "", s.tools.length ? "외부 " + s.tools.join(", ") : ""].filter(Boolean).join(" / "));
      row("작업 흐름", s.flow.join(" → ") + (s.cmds > s.flow.length ? " (명령 " + s.cmds + "번)" : ""));
      const c = s.counts || {};
      row("활동량", [["read", "읽기"], ["edit", "수정"], ["write", "새 파일"], ["bash", "명령"], ["find", "찾기"], ["web", "웹"], ["agent", "에이전트"], ["mcp", "외부 연결"]].filter(([k]) => c[k]).map(([k, l]) => l + " " + c[k]).join(" · "));
      box.append(sec);
    }
    return box;
  }
  // 보고서는 팀장을 펼쳤을 때만, 5초에 한 번 서버에서 읽는다
  async function loadReport() {
    if (Date.now() - P.reportAt < 5000) return;
    P.reportAt = Date.now();
    try {
      const r = await (await fetch("/api/report", { cache: "no-store" })).json();
      const next = r.report || null, key = x => (x ? x.at + "|" + (x.acked || "") + "|" + x.text : "");
      if (key(next) !== key(P.report)) { P.report = next; render(P.people, P.sel); }
    } catch { /* 서버가 잠깐 바쁘면 다음에 */ }
  }
  function item(d) {
    const open = d.id === P.sel, mode = modeOf(d), cls = STATUS[mode];
    const li = el("li", "o-person" + (open ? " open" : ""));
    li.dataset.id = d.id;
    const head = el("button", "o-head");
    head.type = "button";
    head.setAttribute("aria-expanded", open ? "true" : "false");
    head.append(dot(OfficeLife.colorOf(d.name)), el("b", null, d.name), el("span", `o-chip ${cls}`, t("status." + mode)));
    if (d.subCount) head.append(el("span", "o-chip sub", t("chip.subs", { n: d.subCount })));
    head.onclick = () => P.pick?.(d.id);
    li.append(head);
    const w = what(d, open);
    if (w) li.append(el("p", `o-doing ${cls}`, open && mode !== "rest" ? `${t("d.now")} · ${w}` : w));
    if (open) li.append(details(d));
    else for (const s of (d.subs || []).slice(0, 3)) {
      li.append(el("p", "o-sub", `${subLine(s)}${s.doing ? " — " + I18N.act(s.doing) : ""}`));
    }
    return li;
  }
  // 고른 항목이 목록 안에서 보이게 — 목록 칸만 움직이고 페이지는 그대로 둔다(폰에서 캔버스가 안 밀려나게)
  function reveal(li) {
    const box = $("office-people"), b = box.getBoundingClientRect(), r = li.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top + 4;
    else if (r.bottom > b.bottom) box.scrollTop += Math.min(r.top - b.top - 4, r.bottom - b.bottom + 4);
  }
  function render(people, sel, o = {}) {
    P.people = people || [];
    P.sel = sel || null;
    const list = $("office-people");
    const order = { decision: 0, working: 1 };
    const sorted = [...P.people].sort((a, b) => (order[modeOf(a)] ?? 2) - (order[modeOf(b)] ?? 2) || a.name.localeCompare(b.name));
    $("office-count").textContent = t("count", { n: sorted.length, w: sorted.filter(p => modeOf(p) === "working").length });
    const keep = list.scrollTop;
    // 목록은 3초마다 새로 그려진다 — 보고서 칸처럼 안쪽에서 스크롤되는 곳도 읽던 위치를 기억했다가 되돌린다
    const inner = [...list.querySelectorAll(".o-reportbox, pre.o-report")].map(e => e.scrollTop);
    list.replaceChildren(...sorted.map(item));
    list.scrollTop = keep;
    list.querySelectorAll(".o-reportbox, pre.o-report").forEach((e, i) => { if (inner[i]) e.scrollTop = inner[i]; });
    if (o.focus && P.sel) {
      const li = list.querySelector(`li[data-id="${CSS.escape(P.sel)}"]`);
      if (li) {
        reveal(li);
        li.classList.remove("flash");
        void li.offsetWidth;
        li.classList.add("flash");
      }
    }
  }

  // ---------- 활동 로그 ----------
  // 서버 기록(Act)과 화면이 만든 사건(출근·퇴근 등)을 같은 줄에 섞는다. 글은 그릴 때 지금 언어로 만든다.
  // uid = 중복 거르기용 열쇠(서버 기록 한 줄 = 사람 + 시각 + 활동). 사건의 key(문구 열쇠)와 다른 칸이다.
  const uidOf = (d, e) => `${d.id}|${e.at}|${e.k}|${e.a}`;
  const textOf = e => (e.act ? I18N.act(e.act) : I18N.ev(e.key, e.arg));
  function collect(people, events) {
    const now = new Set();
    for (const d of people || []) {
      for (const e of d.log || []) {
        const ms = Date.parse(e.at);
        if (!ms) continue;
        const uid = uidOf(d, e);
        now.add(uid);
        if (P.seen.has(uid) || P.items.some(x => x.uid === uid) || P.queue.some(x => x.uid === uid)) continue;
        const row = { uid, at: ms, id: d.id, name: d.name, color: OfficeLife.colorOf(d.name), act: { k: e.k, a: e.a } };
        if (P.primed) P.queue.push(row); else add(row, true);
      }
    }
    P.seen = now;                               // 지금 서버가 주는 것만 기억 — 오래 켜 둬도 안 불어난다
    for (const e of events || []) P.queue.push({ ...e, uid: `ev|${e.at}|${e.id}|${e.key}|${e.arg}`, mine: true });
    P.queue.sort((a, b) => a.at - b.at);
    P.primed = true;
  }
  function row(e, quiet) {
    const li = el("li", quiet ? "o-log" : "o-log fresh");
    li.append(el("time", null, I18N.time(e.at)), dot(e.color), el("b", null, e.name), el("span", e.mine ? "o-ev" : null, textOf(e)));
    li.dataset.at = e.at;
    li.dataset.id = e.id;
    li.onclick = () => P.pick?.(e.id, true);
    return li;
  }
  // 시간순 자리에 끼운다(맨 위가 최신) — 서버 기록은 조금 늦게 와도 제 시각 자리로
  function add(e, quiet) {
    const box = $("office-log");
    const k = P.items.findIndex(x => x.at <= e.at);
    const at = k < 0 ? P.items.length : k;
    P.items.splice(at, 0, e);
    box.insertBefore(row(e, quiet), box.children[at] || null);
    while (P.items.length > LOG_MAX) { P.items.pop(); box.lastChild?.remove(); }
  }
  function drip() {
    const e = P.queue.shift();
    if (e) add(e, false);
  }
  // 언어가 바뀌면 지금 있는 글을 전부 새 언어로
  function relabel() {
    $("office-log").replaceChildren(...P.items.map(e => row(e, true)));
    render(P.people, P.sel);
  }

  return { render, collect, drip, relabel, modeOf, onPick: f => { P.pick = f; } };
})();
