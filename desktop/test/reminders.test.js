import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReminder, cleanReminders, isDue, tick, reminderBubble, loadReminders } from '../src/reminders.js';
import { normalizeBubble } from '../src/bubbles.js';

const base = { id: 'a1', text: ' 🍕점심 10분전! ', time: '12:20', repeat: 'weekdays', sticky: false, enabled: true };
const at = (s) => new Date(s); // 로컬 시각

test('cleanReminder: 문구 다듬기·잘못된 값 거르기', () => {
  assert.equal(cleanReminder(base).text, '🍕점심 10분전!');
  assert.equal(cleanReminder({ ...base, text: '  ' }), null);
  assert.equal(cleanReminder({ ...base, time: '25:00' }), null);
  assert.equal(cleanReminder({ ...base, repeat: 'monthly' }), null);
  assert.equal(cleanReminder({ ...base, repeat: 'days', days: [] }), null);
  assert.deepEqual(cleanReminder({ ...base, repeat: 'days', days: [3, 1, 3] }).days, [1, 3]);
  assert.equal(cleanReminder({ ...base, repeat: 'once' }), null);
  assert.equal(cleanReminder({ ...base, repeat: 'once', date: '2026-02-31' }), null);
  assert.equal(cleanReminder({ ...base, repeat: 'once', date: '2026-10-20' }).date, '2026-10-20');
  assert.equal(cleanReminder({ ...base, text: 'x'.repeat(300) }).text.length, 100);
});

test('cleanReminders: 같은 id 는 거부, 잘못된 하나가 있으면 전체 거부', () => {
  assert.equal(cleanReminders([base, base]), null);
  assert.equal(cleanReminders([base, { ...base, id: 'b', time: 'x' }]), null);
  assert.equal(cleanReminders([base, { ...base, id: 'b' }]).length, 2);
  assert.deepEqual(loadReminders([base, { bad: 1 }]).map((r) => r.id), ['a1']);
});

test('isDue: 평일 12:20 — 월요일은 울리고 일요일은 안 울린다', () => {
  const r = cleanReminder(base);
  assert.equal(isDue(r, at('2026-10-19T12:20:30')), true); // 월
  assert.equal(isDue(r, at('2026-10-19T12:21:00')), false);
  assert.equal(isDue(r, at('2026-10-18T12:20:00')), false); // 일
  assert.equal(isDue({ ...r, enabled: false }, at('2026-10-19T12:20:00')), false);
});

test('isDue: 요일 선택·매일·한 번만', () => {
  assert.equal(isDue(cleanReminder({ ...base, repeat: 'days', days: [0] }), at('2026-10-18T12:20:00')), true);
  assert.equal(isDue(cleanReminder({ ...base, repeat: 'days', days: [0] }), at('2026-10-19T12:20:00')), false);
  assert.equal(isDue(cleanReminder({ ...base, repeat: 'daily' }), at('2026-10-18T12:20:00')), true);
  const once = cleanReminder({ ...base, repeat: 'once', date: '2026-10-20' });
  assert.equal(isDue(once, at('2026-10-20T12:20:00')), true);
  assert.equal(isDue(once, at('2026-10-21T12:20:00')), false);
});

test('tick: 같은 분에 두 번 안 울리고, 한 번만 알림은 울린 뒤 꺼진다', () => {
  const now = at('2026-10-20T12:20:10');
  const once = cleanReminder({ ...base, id: 'o', repeat: 'once', date: '2026-10-20' });
  const wk = cleanReminder({ ...base, id: 'w' });
  const r1 = tick([once, wk], now);
  assert.deepEqual(r1.fire.map((r) => r.id), ['o', 'w']);
  assert.equal(r1.list.find((r) => r.id === 'o').enabled, false);
  const r2 = tick(r1.list, at('2026-10-20T12:20:40'));
  assert.equal(r2.fire.length, 0);
  const r3 = tick(r1.list, at('2026-10-21T12:20:00')); // 다음 날 평일엔 다시
  assert.deepEqual(r3.fire.map((r) => r.id), ['w']);
});

test('reminderBubble: 기본은 몇 초 뒤 닫힘, 유지 옵션이면 안 사라짐', () => {
  const auto = normalizeBubble(reminderBubble(cleanReminder(base)));
  assert.ok(auto.ttlMs > 0);
  assert.equal(auto.closable, true);
  const sticky = normalizeBubble(reminderBubble(cleanReminder({ ...base, sticky: true })));
  assert.equal(sticky.ttlMs, null);
  assert.equal(sticky.closable, true);
});
