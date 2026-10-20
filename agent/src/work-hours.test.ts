import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkAlerts, WORK_DEFAULTS, inWindow, minsToLeave, workHoursLine, workHoursOf, type WorkHours } from "./work-hours.ts";
import { loadConfig } from "./config.ts";
import { Settings } from "./settings.ts";
import { Bus } from "./bus.ts";
import { CHARACTER_IDS, characterClips, installCharacters, setCharacter } from "./characters.ts";
import { localLine, localThought } from "./local-mode.ts";
import { linesSchema } from "./character-store.ts";
import { contextHeader } from "./ctx-tools.ts";

afterEach(() => { installCharacters({}); setCharacter("shisa"); });
const tmp = () => mkdtempSync(join(tmpdir(), "cy-work-"));
// 테스트는 TZ=Asia/Seoul(scripts/test.mjs). 2026-10-17 은 토요일, 10-19 는 월요일
const at = (iso: string) => new Date(iso);
const wh = (over: Partial<WorkHours> = {}): WorkHours => ({ ...workHoursOf({}), ...over });

test("기본값: 출근 09:00 · 점심 12:00 · 퇴근 18:00 · 월~금 · 알림 셋 다 켬, 이상한 값은 기본값", () => {
  assert.deepEqual(workHoursOf({}), { ...WORK_DEFAULTS, workDays: [1, 2, 3, 4, 5] });
  assert.deepEqual(workHoursOf({ workStart: "9:00", lunchTime: "25:00", workEnd: "18:60", workDays: [1, 9] }), workHoursOf({}));
  assert.deepEqual(workHoursOf({ workStart: "19:00", workEnd: "18:00" }).workStart, "09:00", "출근이 퇴근보다 늦으면 기본값");
  assert.deepEqual(workHoursOf({ workDays: [5, 1, 1] }).workDays, [1, 5]);
  const c = loadConfig({}, {});
  assert.equal(c.workStart, "09:00"); assert.equal(c.lunchTime, "12:00"); assert.equal(c.workEnd, "18:00");
  assert.deepEqual(c.workDays, [1, 2, 3, 4, 5]);
  assert.equal(c.startAlert, true); assert.equal(c.leaveAlert, true); assert.equal(c.leaveTimer, true); assert.equal(c.lunchAlert, true);
  assert.equal(loadConfig({}, { lunchAlert: false, leaveAlert: false }).leaveAlert, false);
});

test("시간 안: 출근은 출근~퇴근 전, 점심은 그 시각부터 한 시간, 퇴근은 10분 전~퇴근 전(자정은 넘기지 않는다)", () => {
  const w = wh();
  const t = (hm: string) => at(`2026-10-19T${hm}:00+09:00`);
  assert.equal(inWindow("start", w, t("08:59")), false);
  assert.equal(inWindow("start", w, t("09:00")), true);
  assert.equal(inWindow("start", w, t("17:59")), true);
  assert.equal(inWindow("start", w, t("18:00")), false, "퇴근 뒤엔 아침 인사 안 함");
  assert.equal(inWindow("lunch", w, t("11:59")), false);
  assert.equal(inWindow("lunch", w, t("12:00")), true);
  assert.equal(inWindow("lunch", w, t("12:59")), true, "예전 12시대와 같다");
  assert.equal(inWindow("lunch", w, t("13:00")), false);
  assert.equal(inWindow("lunch", wh({ lunchTime: "11:30" }), t("12:29")), true);
  assert.equal(inWindow("lunch", wh({ lunchTime: "11:30" }), t("12:30")), false);
  assert.equal(inWindow("leave", w, t("17:49")), false);
  assert.equal(inWindow("leave", w, t("17:50")), true);
  assert.equal(inWindow("leave", w, t("17:59")), true);
  assert.equal(inWindow("leave", w, t("18:00")), false);
  // 퇴근 00:05 → 10분 전은 0시부터(전날로 넘기지 않는다)
  const early = wh({ workStart: "00:00", workEnd: "00:05" });
  assert.equal(inWindow("leave", early, t("00:00")), true);
  assert.equal(inWindow("leave", early, at("2026-10-18T23:57:00+09:00")), false);
  assert.equal(minsToLeave(w, at("2026-10-19T17:50:00+09:00")), 10);
  assert.equal(minsToLeave(w, at("2026-10-19T17:52:30+09:00")), 8, "올림");
  assert.equal(minsToLeave(w, at("2026-10-19T18:00:00+09:00")), null);
  assert.equal(minsToLeave(w, at("2026-10-17T17:50:00+09:00")), null, "토요일");
});

test("하루 한 번: 근무일·시간 안·켜져 있을 때만, 다시 켜도 같은 날은 또 안 뜬다, 점심 기록은 예전 모양(last)", () => {
  const path = join(tmp(), "lunch.json");
  writeFileSync(path, JSON.stringify({ last: "2026-10-16" })); // 예전 점심 기록
  let now = at("2026-10-19T11:59:00+09:00");
  const a = new WorkAlerts(path, { now: () => now });
  const w = wh();
  assert.equal(a.due("lunch", w), null, "11시 59분");
  now = at("2026-10-19T12:05:00+09:00");
  assert.equal(a.due("lunch", { ...w, lunchAlert: false }), null, "끔");
  assert.equal(a.due("lunch", w), "2026-10-19");
  assert.equal(a.due("lunch", w), null, "같은 날 두 번 안 뜬다");
  assert.equal(new WorkAlerts(path, { now: () => now }).due("lunch", w), null, "데몬을 다시 켜도");
  assert.equal(a.due("start", w), "2026-10-19", "출근 인사는 퇴근 전까지 처음 확인할 때");
  assert.equal(a.due("start", w), null);
  assert.equal(a.due("leave", w), null, "아직 퇴근 10분 전이 아님");
  now = at("2026-10-19T17:51:00+09:00");
  assert.equal(a.due("leave", { ...w, leaveAlert: false }), null, "끔");
  assert.equal(a.due("leave", w), "2026-10-19");
  assert.equal(a.due("leave", w), null);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { last: "2026-10-19", start: "2026-10-19", leave: "2026-10-19" });
  // 주말엔 없음, 요일을 고르면 그날만
  now = at("2026-10-17T12:10:00+09:00");
  const b = new WorkAlerts(join(tmp(), "x.json"), { now: () => now });
  assert.equal(b.due("lunch", w), null, "토요일");
  assert.equal(b.due("lunch", wh({ workDays: [6] })), "2026-10-17");
  // 아침 인사 기록은 브리핑과 나눠 쓴다(claim 이 먼저면 출근 인사는 안 뜬다)
  now = at("2026-10-20T08:30:00+09:00");
  assert.ok(a.claim("start"));
  now = at("2026-10-20T09:00:00+09:00");
  assert.equal(a.due("start", w), null);
  assert.equal(a.done("start"), true);
});

test("일정 알림 춤 중이면 점심·퇴근은 건너뛰고(남기지 않는다) 다음 확인 때 뜬다, 출근 인사(영상 없음)는 그대로", () => {
  let now = at("2026-10-19T12:00:00+09:00");
  const a = new WorkAlerts(join(tmp(), "lunch.json"), { now: () => now });
  const w = wh();
  assert.equal(a.due("lunch", w, true), null, "일정 알림 춤 중");
  assert.equal(a.due("start", w, true), "2026-10-19", "출근 인사는 영상이 없어 겹쳐도 된다");
  now = at("2026-10-19T12:01:00+09:00");
  assert.equal(a.due("lunch", w), "2026-10-19", "춤이 끝난 다음 확인");
  now = at("2026-10-19T17:50:00+09:00");
  assert.equal(a.due("leave", w, true), null);
  now = at("2026-10-19T17:51:00+09:00");
  assert.equal(a.due("leave", w), "2026-10-19");
});

test("설정: 근무 시간 저장·바로 반영, 잘못된 HH:MM·요일·출근≥퇴근은 400", () => {
  const path = join(tmp(), "config.json");
  const cfg = loadConfig({}, {});
  const s = new Settings(cfg, { path, env: {} });
  const v = s.view();
  assert.equal(v.workStart, "09:00"); assert.equal(v.workEnd, "18:00"); assert.equal(v.lunchTime, "12:00");
  assert.deepEqual(v.workDays, [1, 2, 3, 4, 5]); assert.equal(v.startAlert, true); assert.equal(v.leaveAlert, true); assert.equal(v.lunchAlert, true);
  for (const bad of [{ workEnd: "6:00" }, { workStart: "24:00" }, { lunchTime: "12:5" }, { workEnd: 1800 }, { workDays: [7] }, { workDays: [] }, { workDays: "월" }, { leaveAlert: "yes" }, { leaveTimer: "yes" }, { startAlert: 1 }]) {
    const r = s.put(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal((r as any).status, 400, JSON.stringify(bad));
  }
  const late = s.put({ workStart: "19:00" });
  assert.equal(late.ok, false);
  assert.match((late as any).error, /출근 시각은 퇴근 시각보다 앞/);
  const r = s.put({ workStart: "10:00", workEnd: "19:00", lunchTime: "12:30", workDays: [5, 1, 3], leaveAlert: false, startAlert: false });
  assert.ok(r.ok);
  assert.equal(cfg.workEnd, "19:00"); assert.deepEqual(cfg.workDays, [1, 3, 5]); assert.equal(cfg.leaveAlert, false);
  const r2 = s.put({ leaveTimer: false }); assert.equal(r2.ok, true); assert.equal(cfg.leaveTimer, false);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).leaveTimer, false);
  const f = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual([f.workStart, f.workEnd, f.lunchTime, f.workDays, f.leaveAlert, f.startAlert], ["10:00", "19:00", "12:30", [1, 3, 5], false, false]);
  assert.deepEqual(loadConfig({}, f).workDays, [1, 3, 5]);
  // 점심 켜기·끄기는 예전 그대로
  assert.equal(s.put({ lunchAlert: "no" }).ok, false);
  assert.ok(s.put({ lunchAlert: false }).ok);
  assert.equal(s.view().lunchAlert, false);
});

test("퇴근 인사: 일정 알림(plan) 영상, 대사는 local.leave(영상 한마디 말고), 모든 캐릭터에 있다", () => {
  const bus = new Bus();
  for (const id of CHARACTER_IDS) {
    setCharacter(id);
    const d = bus.activity.play(1000, "plan");
    assert.equal(bus.state().danceClip, "plan", id);
    assert.ok(characterClips("plan").length > 0, `${id}: 일정 알림 영상`);
    const leave = localLine("leave");
    assert.ok(leave && leave !== localLine("lunch"), `${id}: 퇴근 인사`);
    assert.match(leave, /퇴근/, id);
    for (const m of leave.matchAll(/\{(\w+)\}/g)) assert.equal(m[1], "mins", `${id}: {${m[1]}}`);
    void d;
  }
  // 치이카와 plan2 처럼 영상에 일정용 한마디가 있어도 퇴근 인사엔 쓰지 않는다(main.ts) — 그 한마디는 {title} 이 있는 일정 글
  setCharacter("chiikawa");
  assert.ok(characterClips("plan").some((x) => /\{title\}/.test(x.say ?? "")));
  assert.doesNotMatch(localLine("leave"), /\{title\}/);
  setCharacter("shisa");
  assert.equal(localLine("leave"), "{mins}분 뒤면 퇴근이에요. 오늘도 고생 많으셨어요, 안녕히 가세요.");
  setCharacter("hachi");
  assert.match(localLine("leave"), /퇴근/); // 글은 lines.json(사용자가 고친다)
  // 사용자 캐릭터 대사 칸에도 local.leave(자리표시 {mins})
  assert.deepEqual(linesSchema().find((d) => d.path === "local.leave")?.vars, ["mins"]);
  bus.activity.stop();
});

test("아침 인사 표시: 로컬 브리핑 말풍선이 시간대 인사일 때만 greet", () => {
  assert.equal(localThought(at("2026-10-19T09:30:00+09:00")).greet, "morning");
  assert.equal(localThought(at("2026-10-19T09:30:00+09:00"), [{ title: "급한 일", priority: 1 }]).greet, undefined);
  assert.equal(localThought(at("2026-10-19T09:30:00+09:00"), [], [{ title: "끝낸 일" }]).greet, undefined);
});

test("AI 맥락: 근무 시간 한 줄 — 퇴근까지 남은 시간", () => {
  const cfg = { ...loadConfig({}, {}), user: { name: "홍길동", aliases: [] } };
  assert.match(contextHeader(cfg, { now: at("2026-10-19T16:55:00+09:00") }), /- 근무: 월~금 09:00~18:00 · 점심 12:00 · 퇴근까지 1시간 5분/);
  assert.match(contextHeader(cfg, { now: at("2026-10-19T17:00:00+09:00") }), /퇴근까지 1시간$/m);
  assert.match(contextHeader(cfg, { now: at("2026-10-19T08:00:00+09:00") }), /아직 출근 전/);
  assert.doesNotMatch(contextHeader(cfg, { now: at("2026-10-19T19:00:00+09:00") }), /퇴근까지/);
  assert.match(workHoursLine(wh({ workDays: [1, 3] }), at("2026-10-17T10:00:00+09:00")), /근무: 월·수 09:00~18:00 · 점심 12:00$/);
});
test("점심 영상: 먹는 영상이 있으면 그것, 없으면(모몽가) 그 캐릭터의 일정 알림 영상, 대사는 점심 인사", () => {
  const bus = new Bus();
  for (const id of ["shisa", "hachi", "rakko", "momonga", "usagi", "kani", "chiikawa", "kuri"]) {
    setCharacter(id);
    if (id !== "momonga") assert.deepEqual(characterClips("lunch").map((x) => x.file), ["lunch"], `${id}: 먹는 영상`);
    else assert.deepEqual(characterClips("lunch").map((x) => x.file), characterClips("plan").map((x) => x.file), id);
    const d = bus.activity.play(1000, "lunch");
    assert.equal(bus.state().danceClip, "lunch");
    assert.equal(d.say, undefined, `${id}: 점심 인사(local lunch)`);
    assert.ok(localLine("lunch").length > 0);
  }
  // 사용자 캐릭터: 점심 칸에 넣은 영상의 한마디
  installCharacters({ users: [{ id: "u-lunch000", lines: { name: "까망" }, clips: { plan: [{ file: "plan-aaaaaaaa.gif" }], lunch: [{ file: "lunch-aaaaaaaa.gif", say: "밥 먹자!" }] } }] });
  setCharacter("u-lunch000");
  assert.equal(bus.activity.play(1000, "lunch").say, "밥 먹자!");
  installCharacters({ users: [{ id: "u-lunch000", lines: { name: "까망" }, clips: { plan: [{ file: "plan-aaaaaaaa.gif" }] } }] });
  assert.deepEqual(characterClips("lunch").map((x) => x.file), ["plan-aaaaaaaa.gif"], "점심 칸이 비면 일정 알림");
  bus.activity.stop();
});
