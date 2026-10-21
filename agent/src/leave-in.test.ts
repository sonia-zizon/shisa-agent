import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIn, workHoursFromIn, findTodayIn, hhmm, parseChannel, parseUser, leaveInTarget, autoWorkHoursOn } from "./leave-in.ts";

const LEAVE_IN_USER = "UTESTUSR1";
const CH = "CTESTCHN1";
const at = (h: number, m: number) => new Date(2026, 9, 19, h, m, 0);
const ts = (d: Date) => d.getTime() / 1000;

test("parseIn: in 만이면 메시지 시각, 시간이 붙으면 그 시간", () => {
  const d = at(9, 41);
  assert.equal(hhmm(parseIn("in", ts(d))!), "09:41");
  assert.equal(hhmm(parseIn("IN", ts(d))!), "09:41");
  assert.equal(hhmm(parseIn("in 26분", ts(at(10, 0)))!), "10:26");
  assert.equal(hhmm(parseIn("in 9시38분", ts(at(10, 0)))!), "09:38");
  assert.equal(hhmm(parseIn("in 9시 38분", ts(at(10, 0)))!), "09:38");
  assert.equal(hhmm(parseIn("in 9:20", ts(at(10, 0)))!), "09:20");
  assert.equal(hhmm(parseIn("in 9시", ts(at(10, 0)))!), "09:00");
  assert.equal(parseIn("in progress", ts(d)), null);
  assert.equal(parseIn("hello in", ts(d)), null);
  assert.equal(parseIn("in 99:99", ts(d)), null);
});

test("workHoursFromIn: in → 근무 시작, in+9시간 → 퇴근", () => {
  assert.deepEqual(workHoursFromIn(at(9, 30)), { workStart: "09:30", workEnd: "18:30" });
  assert.deepEqual(workHoursFromIn(at(0, 5)), { workStart: "00:05", workEnd: "09:05" });
  assert.deepEqual(workHoursFromIn(at(14, 59)), { workStart: "14:59", workEnd: "23:59" });
});

test("workHoursFromIn: 퇴근이 자정을 넘으면 null", () => {
  assert.equal(workHoursFromIn(at(15, 0)), null);
  assert.equal(workHoursFromIn(at(22, 30)), null);
});

test("findTodayIn: 내 계정의 첫 in 만, 늦게 쓴 in 26분도 인식", async () => {
  const now = at(18, 0);
  const calls: any[] = [];
  const direct = { call: async (_t: string, a: any) => { calls.push(a); return { messages: [
    { user: "UOTHER", text: "in", ts: String(ts(at(8, 0))) },
    { user: LEAVE_IN_USER, text: "점심 먹고 올게요", ts: String(ts(at(12, 0))) },
    { user: LEAVE_IN_USER, text: "in 9:20", ts: String(ts(at(9, 45))) },
  ] }; } };
  assert.equal(hhmm((await findTodayIn(direct, now, CH, LEAVE_IN_USER))!), "09:20");
  assert.equal(calls[0].channel_id, CH);
  assert.equal(await findTodayIn({ call: async () => ({ messages: [] }) }, now, CH, LEAVE_IN_USER), null);
  await assert.rejects(findTodayIn({ call: async () => ({ error: "nope" }) }, now, CH, LEAVE_IN_USER));
});

test("parseChannel · parseUser: 링크·ID 파싱, 형식이 틀리면 null", () => {
  assert.equal(parseChannel("CABC12345"), "CABC12345");
  assert.equal(parseChannel(" https://ws.slack.com/archives/CABC12345 "), "CABC12345");
  assert.equal(parseChannel("https://ws.slack.com/archives/CABC12345/p1700000000000000?thread_ts=1.2"), "CABC12345");
  assert.equal(parseChannel("https://ws.slack.com/archives/CABC12345?x=1"), "CABC12345");
  for (const bad of ["", "   ", "abc", "https://ws.slack.com/", "https://ws.slack.com/archives/xyz", undefined, 3]) assert.equal(parseChannel(bad), null);
  assert.equal(parseUser("UABC12345"), "UABC12345");
  assert.equal(parseUser(" WABC12345 "), "WABC12345");
  for (const bad of ["", "CABC12345", "uabc12345", "U12", undefined]) assert.equal(parseUser(bad), null);
});

test("leaveInTarget · autoWorkHoursOn: 켬 + 채널·ID 둘 다 올바를 때만 동작", () => {
  const ok = { leaveInChannel: "https://x.slack.com/archives/CABC12345", leaveInUser: "UABC12345" };
  assert.deepEqual(leaveInTarget(ok), { channel: "CABC12345", user: "UABC12345" });
  assert.equal(leaveInTarget({ ...ok, leaveInChannel: "" }), null);
  assert.equal(leaveInTarget({ ...ok, leaveInUser: "" }), null);
  assert.equal(leaveInTarget({ ...ok, leaveInUser: "nope" }), null);
  assert.equal(leaveInTarget({}), null);
  assert.equal(autoWorkHoursOn({ ...ok, autoWorkHours: true }), true);
  assert.equal(autoWorkHoursOn(ok), false, "기본 끔");
  assert.equal(autoWorkHoursOn({ autoWorkHours: true }), false, "채널·ID 없으면 안 함");
  assert.equal(autoWorkHoursOn({ autoWorkHours: true, leaveInChannel: ok.leaveInChannel }), false);
});
