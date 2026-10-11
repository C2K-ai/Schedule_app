// 표시 — 생일·기념일·시험·여행처럼 날짜만 있는 것(할 일도 한 일도 아님). 화면은 MarkEditor·캘린더·작업 탭 '다가오는 표시'.
import type { PlannerStore } from "./store";
import { DAY, nowIso, parseDayKey, uuid } from "./time";
import type { DB, Mark } from "./types";

export function liveMarks(db: DB): Mark[] {
  return Object.values(db.marks ?? {})
    .filter((m) => !m.deleted_at)
    .sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 그해의 같은 달·날 — 2월 29일은 평년엔 2월 28일 */
export function yearlyOn(day: string, year: number): string {
  const m = Number(day.slice(5, 7)),
    d = Number(day.slice(8, 10));
  const last = new Date(year, m, 0).getDate();
  return `${year}-${pad(m)}-${pad(Math.min(d, last))}`;
}

/** 이 날(YYYY-MM-DD)에 걸린 표시 — 매년 반복은 처음 날 이후 해마다 같은 날, 여러 날은 처음~끝 */
export function marksOnDay(list: Mark[], key: string): Mark[] {
  return list.filter((m) =>
    m.yearly ? key >= m.day && yearlyOn(m.day, Number(key.slice(0, 4))) === key : key >= m.day && key <= (m.end_day ?? m.day),
  );
}

export interface Upcoming {
  mark: Mark;
  /** 다가오는 그 날(진행 중인 여러 날 표시는 오늘) */
  on: string;
  /** 오늘부터 며칠 뒤(0 = 오늘) */
  inDays: number;
}

/** 오늘부터 days 일 안의 표시 — 가까운 날 먼저 */
export function upcomingMarks(list: Mark[], today: string, days = 7): Upcoming[] {
  const out: Upcoming[] = [];
  const t0 = parseDayKey(today).getTime();
  for (const m of list) {
    let on: string | null = null;
    if (m.yearly) {
      const y = Number(today.slice(0, 4));
      for (const yy of [y, y + 1]) {
        const d = yearlyOn(m.day, yy);
        if (d >= today && d >= m.day) {
          on = d;
          break;
        }
      }
    } else if ((m.end_day ?? m.day) >= today) on = m.day > today ? m.day : today;
    if (!on) continue;
    const inDays = Math.round((parseDayKey(on).getTime() - t0) / DAY);
    if (inDays <= days) out.push({ mark: m, on, inDays });
  }
  return out.sort((a, b) => a.on.localeCompare(b.on) || a.mark.title.localeCompare(b.mark.title));
}

/** 0 → "오늘", 1 → "내일", 2 → "모레", 그 밖엔 "D-5" */
export const whenLabel = (n: number) => (n <= 0 ? "오늘" : n === 1 ? "내일" : n === 2 ? "모레" : `D-${n}`);

export function saveMark(store: PlannerStore, input: Omit<Mark, "created_at" | "updated_at" | "deleted_at" | "id"> & { id?: string }) {
  const id = input.id ?? uuid();
  const cur = store.db.marks[id];
  const row: Mark = { ...input, id, created_at: cur?.created_at ?? nowIso(), updated_at: nowIso(), deleted_at: null };
  store.put("marks", row);
  return row;
}

export function deleteMark(store: PlannerStore, id: string) {
  store.patch("marks", id, { deleted_at: nowIso() });
}
