// 퇴근 타이머 — 순수 로직. 캐릭터 말풍선 자리에 「⌛05:30:45」(퇴근까지 남은 시간)를 보여 줄지·무슨 글인지.
// 설정(GET /settings)의 workStart·workEnd·workDays·leaveTimer 만 쓴다(데몬 agent/src/work-hours.ts 와 같은 규칙).
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const mins = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
const pad = (n) => String(n).padStart(2, '0');

// 설정 값 → 타이머에 쓸 값. 빠지거나 이상하면 기본(09:00~18:00, 월~금, 켬). 출근 >= 퇴근이면 둘 다 기본값
export function leaveTimerConfig(s) {
  const o = s && typeof s === 'object' ? s : {};
  let workStart = HHMM.test(o.workStart) ? o.workStart : '09:00';
  let workEnd = HHMM.test(o.workEnd) ? o.workEnd : '18:00';
  if (mins(workStart) >= mins(workEnd)) { workStart = '09:00'; workEnd = '18:00'; }
  const days = Array.isArray(o.workDays) && o.workDays.length && o.workDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ? [...new Set(o.workDays)] : [1, 2, 3, 4, 5];
  return { workStart, workEnd, workDays: days, leaveTimer: o.leaveTimer !== false };
}

// 남은 초 → 「HH:MM:SS」
export function fmtLeft(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// 지금 보여 줄 글. 켜져 있고(leaveTimer) 근무일이며 출근 시각 이후 ~ 퇴근 시각 전일 때만, 아니면 null
export function leaveTimerText(cfg, now = new Date()) {
  if (!cfg || cfg.leaveTimer === false || !cfg.workDays.includes(now.getDay())) return null;
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  if (nowSec < mins(cfg.workStart) * 60) return null;
  const left = mins(cfg.workEnd) * 60 - nowSec;
  return left > 0 ? `⌛${fmtLeft(left)}` : null;
}
