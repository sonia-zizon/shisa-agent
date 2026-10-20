// 설정 창 「근무 시간」: 출근·점심·퇴근 시각(HH:MM)·요일·알림 셋. 데몬 agent/src/work-hours.ts 와 같은 규칙
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanitizeSettingsPatch, workHoursView, workDaysNext, workTimeNext, WORK_DEFAULT, WORK_DAY_ORDER, DAY_LABEL } from '../src/settings.js';
import { slotRows } from '../src/character-edit.js';
import { CHARACTER_LINES } from '../src/character-lines.js';

test('근무 시간 저장 본문: HH:MM·요일·켜기만 넘기고 이상한 값은 거절', () => {
  assert.deepEqual(sanitizeSettingsPatch({ workStart: '09:30', lunchTime: '12:00', workEnd: '18:30' }), { workStart: '09:30', lunchTime: '12:00', workEnd: '18:30' });
  assert.deepEqual(sanitizeSettingsPatch({ workDays: [5, 1, 1] }), { workDays: [1, 5] });
  assert.deepEqual(sanitizeSettingsPatch({ startAlert: false, leaveAlert: true }), { startAlert: false, leaveAlert: true });
  for (const bad of [{ workStart: '9:30' }, { workEnd: '24:00' }, { lunchTime: 1200 }, { workDays: [] }, { workDays: [7] }, { leaveAlert: 'no' }, { leaveTimer: 'no' }, { workHours: {} }]) {
    assert.equal(sanitizeSettingsPatch(bad), null, JSON.stringify(bad));
  }
});

test('근무 시간 화면 값: 기본 09:00·12:00·18:00·월~금·다 켬, 요일은 하나 이상, 출근은 퇴근보다 앞', () => {
  assert.deepEqual(workHoursView({}), WORK_DEFAULT);
  assert.deepEqual(sanitizeSettingsPatch({ leaveTimer: false }), { leaveTimer: false });
  assert.equal(workHoursView({}).leaveTimer, true);
  assert.deepEqual(workHoursView({ workStart: 'x', workDays: [9], leaveAlert: false }), { ...WORK_DEFAULT, leaveAlert: false });
  assert.deepEqual(WORK_DAY_ORDER.map((d) => DAY_LABEL[d]).join(''), '월화수목금토일');
  assert.deepEqual(workDaysNext([1, 2, 3, 4, 5], 6, true), { workDays: [1, 2, 3, 4, 5, 6] });
  assert.deepEqual(workDaysNext([1, 2], 2, false), { workDays: [1] });
  assert.match(workDaysNext([1], 1, false).error, /하나 이상/);
  assert.deepEqual(workTimeNext({}, 'workEnd', '17:00'), { patch: { workEnd: '17:00' } });
  assert.match(workTimeNext({}, 'workStart', '18:00').error, /퇴근 시각보다 앞/);
  assert.match(workTimeNext({}, 'workStart', '').error, /HH:MM/);
});

test('설정 창: 「근무 시간」 묶음에 시각 셋(time)·요일·알림 셋·퇴근 10분 전 설명, 해요체', () => {
  const html = fs.readFileSync(new URL('../renderer/settings.html', import.meta.url), 'utf8');
  for (const id of ['work-start', 'work-lunch', 'work-end']) assert.match(html, new RegExp(`id="${id}" type="time"`));
  for (const id of ['work-days', 'start-on', 'lunch-on', 'leave-on', 'work-err']) assert.match(html, new RegExp(`id="${id}"`));
  const sec = html.slice(html.indexOf('h-work'), html.indexOf('</section>', html.indexOf('h-work')));
  assert.match(sec, /근무 시간/);
  assert.match(sec, /퇴근 10분 전/);
  assert.doesNotMatch(sec, /—|습니다/);
});

test('퇴근 인사 대사: 기본 캐릭터마다 local.leave, 자리표시는 {mins} 만, 만든 캐릭터 일정 알림 칸 설명에 퇴근', () => {
  for (const [id, c] of Object.entries(CHARACTER_LINES)) {
    assert.ok(c.local?.leave?.trim(), `${id}: local.leave`);
    for (const m of c.local.leave.matchAll(/\{(\w+)\}/g)) assert.equal(m[1], 'mins', id);
  }
  assert.match(slotRows().find((r) => r.slot === 'plan').hint, /퇴근 10분 전/);
});
