// 돌아보기 — 한 기간(주·달)의 계획 대비 실제, 시간을 어디에 썼는지, 습관, 잘 안 지켜지는 시간대. 화면은 LogSheet.
// 이미 모으는 것(일정·습관 일정·한 일 기록·미룸 기록)만으로 계산한다 — 새로 모으는 데이터 없음.

import { dayKey, MIN } from "./time";
import type { Activity, Category, ColorKey, Habit, Task, TaskLog } from "./types";

export interface CatUse {
  /** 카테고리 id, 없으면 "none" */
  id: string;
  name: string;
  color: ColorKey;
  /** 시각을 정한 일정의 계획 시간(이미 시작한 것만) */
  planMin: number;
  /** 그중 해낸 일정의 시간 */
  doneMin: number;
  /** 한 일 기록(시각을 넣은 것)의 시간 */
  actMin: number;
  actCount: number;
}

export interface HabitUse {
  id: string;
  title: string;
  color: ColorKey;
  done: number;
  total: number;
}

export type SlotKey = "morning" | "afternoon" | "evening" | "night";
export interface SlotUse {
  key: SlotKey;
  label: string;
  /** 이 시간대에 시작해 이미 끝난 일정 수 */
  total: number;
  kept: number;
  /** 놓침·건너뜀 + 미룬 횟수 */
  slipped: number;
}

export interface Review {
  planMin: number;
  doneMin: number;
  actMin: number;
  actCount: number;
  cats: CatUse[];
  habits: HabitUse[];
  slots: SlotUse[];
  /** 가장 많이 어긴 시간대(3번 이상일 때만) */
  weakSlot: SlotUse | null;
  /** 가장 많이 어긴 요일(0=일, 3번 이상일 때만) */
  weakDow: { dow: number; slipped: number } | null;
}

const SLOTS: { key: SlotKey; label: string }[] = [
  { key: "morning", label: "아침" },
  { key: "afternoon", label: "오후" },
  { key: "evening", label: "저녁" },
  { key: "night", label: "밤" },
];

/** 아침 5~12시, 오후 12~18시, 저녁 18~23시, 밤 23~5시(기기 현지 시각) */
export function slotOf(ms: number): SlotKey {
  const h = new Date(ms).getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "afternoon";
  if (h >= 18 && h < 23) return "evening";
  return "night";
}

const live = <T extends { deleted_at?: string | null }>(r: T) => !r.deleted_at;
const mins = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / MIN);

export function buildReview(
  input: { tasks: Task[]; activities: Activity[]; categories: Category[]; habits: Habit[]; logs: TaskLog[] },
  from: number,
  to: number,
  now: number,
): Review {
  const catById = new Map(input.categories.map((c) => [c.id, c]));
  const cats = new Map<string, CatUse>();
  const cat = (id: string | null, fallback: ColorKey): CatUse => {
    const c = id ? catById.get(id) : undefined;
    const key = c ? c.id : "none";
    let u = cats.get(key);
    if (!u) {
      u = { id: key, name: c ? c.name : "분류 없음", color: c ? c.color : fallback, planMin: 0, doneMin: 0, actMin: 0, actCount: 0 };
      cats.set(key, u);
    }
    return u;
  };

  const slots = new Map(SLOTS.map((s) => [s.key, { ...s, total: 0, kept: 0, slipped: 0 } as SlotUse]));
  const dowSlip = [0, 0, 0, 0, 0, 0, 0];
  const habitById = new Map(input.habits.map((h) => [h.id, h]));
  const habits = new Map<string, HabitUse>();
  let planMin = 0,
    doneMin = 0;

  const end = Math.min(to, now);
  for (const t of input.tasks) {
    if (!live(t) || t.schedule !== "timed") continue;
    const s = Date.parse(t.starts_at);
    if (!(s >= from && s < end)) continue;
    const m = mins(t.starts_at, t.ends_at);
    const u = cat(t.category_id, t.color);
    u.planMin += m;
    planMin += m;
    if (t.status === "done") {
      u.doneMin += m;
      doneMin += m;
    }
    // 끝난 일정만 '지켰나'를 본다(진행 중·아직 안 끝난 건 빼고)
    if (Date.parse(t.ends_at) <= now) {
      const sl = slots.get(slotOf(s))!;
      sl.total++;
      if (t.status === "done") sl.kept++;
      else if (t.status === "missed" || t.status === "skipped") {
        sl.slipped++;
        dowSlip[new Date(s).getDay()]++;
      }
      if (t.habit_id) {
        const h = habitById.get(t.habit_id);
        let hu = habits.get(t.habit_id);
        if (!hu) {
          hu = { id: t.habit_id, title: h?.title ?? t.title, color: h?.color ?? t.color, done: 0, total: 0 };
          habits.set(t.habit_id, hu);
        }
        hu.total++;
        if (t.status === "done") hu.done++;
      }
    }
  }

  // 미룬 기록: 원래 시작하려던 시각의 시간대·요일로 센다
  for (const l of input.logs) {
    if (!live(l) || l.kind !== "postponed" || !l.from_starts_at) continue;
    const s = Date.parse(l.from_starts_at);
    if (!(s >= from && s < to)) continue;
    slots.get(slotOf(s))!.slipped++;
    dowSlip[new Date(s).getDay()]++;
  }

  let actMin = 0,
    actCount = 0;
  const k0 = dayKey(new Date(from)),
    k1 = dayKey(new Date(to));
  for (const a of input.activities) {
    if (!live(a) || a.day < k0 || a.day >= k1) continue;
    const u = cat(a.category_id, a.color);
    u.actCount++;
    actCount++;
    if (a.starts_at && a.ends_at) {
      const m = mins(a.starts_at, a.ends_at);
      u.actMin += m;
      actMin += m;
    }
  }

  const slotList = SLOTS.map((s) => slots.get(s.key)!);
  const worst = slotList.reduce((a, b) => (b.slipped > a.slipped ? b : a));
  let wd = 0;
  for (let i = 1; i < 7; i++) if (dowSlip[i] > dowSlip[wd]) wd = i;

  return {
    planMin: Math.round(planMin),
    doneMin: Math.round(doneMin),
    actMin: Math.round(actMin),
    actCount,
    cats: [...cats.values()]
      .map((u) => ({ ...u, planMin: Math.round(u.planMin), doneMin: Math.round(u.doneMin), actMin: Math.round(u.actMin) }))
      .sort((a, b) => b.doneMin + b.actMin - (a.doneMin + a.actMin) || b.planMin - a.planMin),
    habits: [...habits.values()].sort((a, b) => b.total - a.total),
    slots: slotList,
    weakSlot: worst.slipped >= 3 ? worst : null,
    weakDow: dowSlip[wd] >= 3 ? { dow: wd, slipped: dowSlip[wd] } : null,
  };
}

/** 125 → "2시간 5분", 45 → "45분", 0 → "0분" */
export function fmtMin(m: number): string {
  const h = Math.floor(m / 60),
    r = Math.round(m % 60);
  if (!h) return `${r}분`;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}
