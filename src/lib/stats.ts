// 프로필(통계) 탭 계산 — 화면과 떨어진 순수 함수
import { isSomeday, studyDayStart, studySeconds, tasksOnDay } from "./planner";
import { addDays, DAY, dayKey, startOfDay, startOfWeek } from "./time";
import type { StudySession, Task } from "./types";

/** 날짜별 완료 개수(완료 시각 기준) */
export function completionsByDay(tasks: Task[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tasks) {
    if (t.status !== "done" || !t.completed_at) continue;
    const k = dayKey(new Date(t.completed_at));
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** 완벽한 하루 — 그날 잡힌 일(건너뛴 것 포함)을 전부 끝낸 날. 오늘은 다 끝냈을 때만 센다 */
export function perfectDays(tasks: Task[], today: Date, days = 365): { perfect: number; tracked: number; streak: number } {
  let perfect = 0,
    tracked = 0,
    streak = 0,
    streakOpen = true;
  for (let i = 0; i < days; i++) {
    const d = addDays(startOfDay(today), -i);
    const list = tasksOnDay(tasks, d);
    if (!list.length) continue;
    const all = list.every((t) => t.status === "done");
    if (i === 0 && !all) continue; // 오늘은 아직 진행 중
    tracked++;
    if (all) perfect++;
    if (streakOpen) {
      if (all) streak++;
      else streakOpen = false;
    }
  }
  return { perfect, tracked, streak };
}

/** 지난 n일 동안 잡힌 일정(날짜 있는 것) 중 끝낸 비율 */
export function completionRate(tasks: Task[], now: Date, days = 30): { rate: number; done: number; total: number } {
  const from = addDays(startOfDay(now), -days + 1).getTime();
  const list = tasks.filter((t) => !isSomeday(t) && Date.parse(t.starts_at) >= from && Date.parse(t.starts_at) <= now.getTime());
  const done = list.filter((t) => t.status === "done").length;
  return { rate: list.length ? Math.round((done / list.length) * 100) : 0, done, total: list.length };
}

/** 최근 8주 요일별 평균 완료 — 가장 생산적인 요일 */
export function weekdayAverages(byDay: Map<string, number>, today: Date, weeks = 8): number[] {
  const sum = Array(7).fill(0);
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(startOfDay(today), -i);
    sum[d.getDay()] += byDay.get(dayKey(d)) ?? 0;
  }
  return sum.map((s) => s / weeks);
}

/** 연간 히트맵 칸 — 53주 × 7일(월요일 시작), 수준 0~4 */
export function yearGrid(byDay: Map<string, number>, today: Date) {
  const end = startOfDay(today);
  const start = addDays(startOfWeek(end), -52 * 7);
  const weeks: { key: string; level: number; count: number; date: Date; future: boolean }[][] = [];
  for (let w = 0; w < 53; w++) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, w * 7 + i);
      const k = dayKey(d);
      const n = byDay.get(k) ?? 0;
      col.push({ key: k, count: n, date: d, future: d > end, level: n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4 });
    }
    weeks.push(col);
  }
  return weeks;
}

/** 이번 주(월~일) 공부 시간(초) — 공부 하루 경계(dayStartHour) 기준 */
export function studyWeek(sessions: StudySession[], today: Date, dayStartHour: number, now: number): number[] {
  const monday = startOfWeek(today);
  return Array.from({ length: 7 }, (_, i) => {
    const s = studyDayStart(new Date(addDays(monday, i).getTime() + dayStartHour * 3600_000), dayStartHour).getTime();
    return studySeconds(sessions, s, s + DAY, now);
  });
}

/** 공부 달력 칸 수준 — 열품타처럼 많이 할수록 진하게 */
export function studyLevel(sec: number): number {
  const h = sec / 3600;
  return sec < 60 ? 0 : h < 1 ? 1 : h < 3 ? 2 : h < 5 ? 3 : 4;
}
