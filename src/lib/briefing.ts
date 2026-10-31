// 오늘 브리핑 문구 — 앱을 켤 때(components/Briefing.tsx)와 서버 아침 푸시(supabase/functions/send-due-notifications/briefing.ts)가 같은 모양.
//   1줄: 시각 있는 일정 "09:00 회의 · 14:30 병원"(시간표 수업·알바 포함)
//   2줄: "시간 미정 · 장보기, 보고서" — 날짜만 정한 일정도 이름으로
//   끝줄: 미시작 n건 · 했는지 확인할 일정 n건
import { checkinQueue, enforcementQueue, isTimed, tasksOnDay } from "./planner";
import { dayKey, fmtTime, startOfDay } from "./time";
import { timetableHabits } from "./timetable";
import type { Habit, Task } from "./types";

/** 이름을 적는 일정 수 — 넘으면 '외 n개' */
export const BRIEF_MAX = 8;
const short = (s: string) => (s.length > 20 ? `${s.slice(0, 19)}…` : s);

export interface Briefing {
  title: string;
  /** 알림 본문(줄바꿈으로 나눔) */
  body: string;
  /** 작업 탭 맨 위 한 줄 */
  line: string;
  open: number;
  overdue: number;
}

/** 오늘(현지) 시간표 수업·알바 — 시간표는 일정을 만들지 않아 따로 센다 */
export function timetableOn(habits: Habit[], day: Date): Habit[] {
  const key = dayKey(day);
  const dow = day.getDay();
  return timetableHabits(habits).filter(
    (h) =>
      /^([01][0-9]|2[0-3]):[0-5][0-9]/.test(h.start_time ?? "") &&
      h.days.includes(dow) &&
      (!h.start_day || h.start_day <= key) &&
      (!h.end_day || h.end_day >= key),
  );
}

export function buildBriefing(tasks: Task[], habits: Habit[], now: number, graceMin: number): Briefing {
  const day = startOfDay(new Date(now));
  const open = tasksOnDay(tasks, day).filter((t) => t.status === "planned" || t.status === "in_progress");
  const classes = timetableOn(habits, day);
  // 모두 오늘 안이라 "HH:MM" 순서 = 시각 순서
  const withTime = [
    ...open.filter(isTimed).map((t) => ({ at: fmtTime(t.starts_at), title: t.title })),
    ...classes.map((h) => ({ at: h.start_time.slice(0, 5), title: h.title })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const noTime = open.filter((t) => !isTimed(t)).map((t) => t.title);
  const total = withTime.length + noTime.length;
  // 시간 미정 일정이 있으면 그 자리를 남겨 둔다(둘 다 보이게)
  const shownTimed = withTime.slice(0, noTime.length ? BRIEF_MAX - Math.min(noTime.length, 3) : BRIEF_MAX);
  const shownNoTime = noTime.slice(0, BRIEF_MAX - shownTimed.length);
  const rest = total - shownTimed.length - shownNoTime.length;
  const overdue = enforcementQueue(tasks, now, graceMin).length;
  const unchecked = checkinQueue(tasks, now).length;
  const lines = [
    shownTimed.map((x) => `${x.at} ${short(x.title)}`).join(" · "),
    shownNoTime.length ? `시간 미정 · ${shownNoTime.map(short).join(", ")}` : "",
    rest > 0 ? `외 ${rest}개` : "",
    [overdue ? `미시작 ${overdue}건` : "", unchecked ? `했는지 확인할 일정 ${unchecked}건` : ""].filter(Boolean).join(" · "),
  ].filter(Boolean);
  if (!total) lines.unshift("오늘 남은 일정이 없어요");
  const hour = new Date(now).getHours();
  const hello = hour < 11 ? "좋은 아침이에요" : hour < 17 ? "오늘 브리핑" : "저녁 브리핑";
  return {
    title: total ? `☀ 오늘 일정 ${total}개` : `☀ ${hello}`,
    body: lines.join("\n"),
    line: lines.join(" · "),
    open: total,
    overdue,
  };
}
