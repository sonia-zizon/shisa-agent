// 예약 알림(위젯 말풍선) — 순수 로직. 메인(타이머)·설정 창(검증)·시험이 같이 쓴다.
// 알림: { id, text, time: 'HH:MM', repeat: 'daily'|'weekdays'|'days'|'once', days: [0~6](repeat=days), date: 'YYYY-MM-DD'(repeat=once), sticky, enabled, last }
export const REPEATS = ['daily', 'weekdays', 'days', 'once'];
export const REMINDER_MAX = 50;
export const TEXT_MAX = 100;
export const AUTO_CLOSE_MS = 12000;

const okTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
const okDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00`);
  return !Number.isNaN(d.getTime()) && ymd(d) === v;
};
const okId = (v) => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// 알림 하나 정리. 이상하면 null
export function cleanReminder(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const text = typeof r.text === 'string' ? r.text.trim().slice(0, TEXT_MAX) : '';
  if (!text || !okId(r.id) || !okTime(r.time) || !REPEATS.includes(r.repeat)) return null;
  const out = { id: r.id, text, time: r.time, repeat: r.repeat, sticky: r.sticky === true, enabled: r.enabled !== false };
  if (r.repeat === 'days') {
    if (!Array.isArray(r.days) || !r.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return null;
    out.days = [...new Set(r.days)].sort((a, b) => a - b);
    if (!out.days.length) return null;
  }
  if (r.repeat === 'once') {
    if (!okDate(r.date)) return null;
    out.date = r.date;
  }
  if (typeof r.last === 'string' && r.last.length <= 20) out.last = r.last;
  return out;
}

// 목록 통째로. 하나라도 이상하거나 id 가 겹치면 null
export function cleanReminders(list) {
  if (!Array.isArray(list) || list.length > REMINDER_MAX) return null;
  const out = [];
  const seen = new Set();
  for (const r of list) {
    const c = cleanReminder(r);
    if (!c || seen.has(c.id)) return null;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

// 저장된 값 → 목록(이상한 건 버린다)
export function loadReminders(v) {
  return Array.isArray(v) ? v.map(cleanReminder).filter(Boolean).slice(0, REMINDER_MAX) : [];
}

// 이 알림이 now(분 단위)에 울릴 차례인가
export function isDue(r, now) {
  if (!r.enabled || r.time !== hhmm(now)) return false;
  if (r.last === `${ymd(now)} ${r.time}`) return false; // 같은 분에 두 번 안 울린다
  const day = now.getDay();
  if (r.repeat === 'daily') return true;
  if (r.repeat === 'weekdays') return day >= 1 && day <= 5;
  if (r.repeat === 'days') return r.days.includes(day);
  return r.date === ymd(now);
}

// 지금 울릴 알림 처리 → { list: 새 목록(last 기록, 한 번짜리는 끔), fire: 울릴 알림들 }
export function tick(list, now) {
  const fire = [];
  const next = list.map((r) => {
    if (!isDue(r, now)) return r;
    fire.push(r);
    const upd = { ...r, last: `${ymd(now)} ${r.time}` };
    if (r.repeat === 'once') upd.enabled = false;
    return upd;
  });
  return { list: next, fire };
}

// 말풍선 payload(src/bubbles.js normalizeBubble 이 받는 모양). sticky 면 ✕ 로 닫을 때까지 둔다
export function reminderBubble(r, now = Date.now()) {
  const b = { id: `reminder-${r.id}-${now}`, text: r.text, kind: 'info', closable: true };
  if (r.sticky) b.sticky = true;
  else b.ttlMs = AUTO_CLOSE_MS;
  return b;
}
