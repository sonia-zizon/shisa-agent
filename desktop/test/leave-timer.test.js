import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaveTimerConfig, fmtLeft, leaveTimerText } from '../src/leave-timer.js';

const mon = (h, m, s = 0) => new Date(2026, 9, 19, h, m, s); // 2026-10-19 월요일
const sat = (h, m) => new Date(2026, 9, 24, h, m, 0);

test('fmtLeft: HH:MM:SS', () => {
  assert.equal(fmtLeft(5 * 3600 + 30 * 60 + 45), '05:30:45');
  assert.equal(fmtLeft(59), '00:00:59');
  assert.equal(fmtLeft(-3), '00:00:00');
});

test('leaveTimerConfig: 기본값·이상한 값', () => {
  assert.deepEqual(leaveTimerConfig(null), { workStart: '09:00', workEnd: '18:00', workDays: [1, 2, 3, 4, 5], leaveTimer: true });
  assert.equal(leaveTimerConfig({ leaveTimer: false }).leaveTimer, false);
  const bad = leaveTimerConfig({ workStart: '19:00', workEnd: '18:00' });
  assert.equal(bad.workStart, '09:00'); assert.equal(bad.workEnd, '18:00');
  assert.deepEqual(leaveTimerConfig({ workDays: [9] }).workDays, [1, 2, 3, 4, 5]);
});

test('leaveTimerText: 근무일 출근 후 ~ 퇴근 전에만', () => {
  const cfg = leaveTimerConfig({ workStart: '09:30', workEnd: '18:30' });
  assert.equal(leaveTimerText(cfg, mon(9, 29, 59)), null); // 출근 전
  assert.equal(leaveTimerText(cfg, mon(9, 30, 0)), '⌛09:00:00');
  assert.equal(leaveTimerText(cfg, mon(13, 0, 15)), '⌛05:29:45');
  assert.equal(leaveTimerText(cfg, mon(18, 29, 59)), '⌛00:00:01');
  assert.equal(leaveTimerText(cfg, mon(18, 30, 0)), null); // 퇴근 시각이 지나면 숨김
  assert.equal(leaveTimerText(cfg, sat(12, 0)), null); // 근무일이 아님
});

test('leaveTimerText: 끄면 안 보임', () => {
  assert.equal(leaveTimerText(leaveTimerConfig({ leaveTimer: false }), mon(12, 0)), null);
});
