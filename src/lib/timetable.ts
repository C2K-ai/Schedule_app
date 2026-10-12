// 시간표 — 반복(습관) 중 '시간표에 보이기'(in_timetable)인 것을 학기(= start_day ~ end_day)별로 묶어 주간 칸으로 그린다.
// 화면은 TimetableView(캘린더 탭 '시간표'), 사진으로 넣기는 TimetableImport.

import { dayKey } from "./time";
import type { ColorKey, Habit } from "./types";

export interface Semester {
  start: string;
  end: string;
}

/** 한국 대학 학기 짐작 — 1학기 3/2~6/21, 2학기 9/1~12/21(16주). 오늘이 끝나기 전인 가장 가까운 학기 */
export function guessSemester(today: Date): Semester {
  const y = today.getFullYear();
  const key = dayKey(today);
  const list: Semester[] = [
    { start: `${y - 1}-09-01`, end: `${y - 1}-12-21` },
    { start: `${y}-03-02`, end: `${y}-06-21` },
    { start: `${y}-09-01`, end: `${y}-12-21` },
    { start: `${y + 1}-03-02`, end: `${y + 1}-06-21` },
  ];
  return list.find((s) => s.end >= key)!;
}

/** '2026년 2학기' — 시작 달로 짐작(2~5월 1학기, 6~8월 여름, 9~11월 2학기, 12~1월 겨울) */
export function semesterLabel(start: string | null | undefined): string {
  if (!start) return "내 시간표";
  const y = Number(start.slice(0, 4)),
    m = Number(start.slice(5, 7));
  if (m >= 2 && m <= 5) return `${y}년 1학기`;
  if (m >= 6 && m <= 8) return `${y}년 여름학기`;
  if (m >= 9 && m <= 11) return `${y}년 2학기`;
  return `${m === 1 ? y - 1 : y}년 겨울학기`;
}

/** '9/1~12/21' */
export const periodText = (s: string | null | undefined, e: string | null | undefined) => {
  const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
  return s && e ? `${md(s)}~${md(e)}` : s ? `${md(s)}부터` : e ? `~${md(e)}` : "계속";
};

/** 시간표에 보이는 반복 — 지운 것·멈춘 것 빼고 */
export const timetableHabits = (habits: Habit[]) => habits.filter((h) => h.in_timetable && h.active && !h.deleted_at);

export interface SemesterGroup extends Semester {
  key: string;
  label: string;
  /** 이 학기 기간을 가진 수업(학기 기간을 바꾸면 같이 바뀜) */
  own: Habit[];
  /** 칸에 보일 것 — 수업 + 기간이 없거나 일부만 있는 것 중 이 학기와 겹치는 것(알바·동아리) */
  habits: Habit[];
}

/** 시작·끝 날이 같은 수업끼리 한 학기(시작 순). 기간이 없는 것(알바·동아리)은 겹치는 모든 학기에 같이 보인다 */
export function semesterGroups(list: Habit[]): SemesterGroup[] {
  const m = new Map<string, SemesterGroup>();
  const rest: Habit[] = [];
  for (const h of list) {
    if (!h.start_day || !h.end_day) {
      rest.push(h);
      continue;
    }
    const key = `${h.start_day}~${h.end_day}`;
    let g = m.get(key);
    if (!g) {
      g = { key, start: h.start_day, end: h.end_day, label: semesterLabel(h.start_day), own: [], habits: [] };
      m.set(key, g);
    }
    g.own.push(h);
  }
  if (!m.size) return rest.length ? [{ key: "~", start: "", end: "", label: semesterLabel(null), own: rest, habits: rest }] : [];
  const groups = [...m.values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  for (const g of groups) g.habits = [...g.own, ...rest.filter((h) => (!h.start_day || h.start_day <= g.end) && (!h.end_day || h.end_day >= g.start))];
  return groups;
}

/** 처음 보여 줄 학기 — 오늘이 들어 있는 것 → 가장 가까운 다음 학기 → 가장 최근 학기 */
export function pickGroup(groups: SemesterGroup[], today: string): SemesterGroup | null {
  const now = groups.filter((g) => (!g.start || g.start <= today) && (!g.end || g.end >= today));
  if (now.length) return now[now.length - 1];
  const next = groups.find((g) => g.start > today);
  return next ?? groups[groups.length - 1] ?? null;
}

export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** 시작 → 끝 길이(분). 끝이 시작보다 이르면 다음 날까지(밤 알바 22:00~02:00 = 240) */
export const spanMin = (start: string, end: string) => {
  const d = toMin(end) - toMin(start);
  return d < 0 ? d + 1440 : d;
};
export const toHHMM = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** 보일 요일(월~금 + 수업 있는 토·일) — 월요일부터 */
export function gridDays(list: Habit[]): number[] {
  const days = [1, 2, 3, 4, 5];
  if (list.some((h) => h.days.includes(6))) days.push(6);
  if (list.some((h) => h.days.includes(0))) days.push(0);
  return days;
}

/** 보일 시간대 — 기본 9~18시, 수업이 더 이르거나 늦으면 넓힌다 */
export function hourRange(list: Habit[]): { from: number; to: number } {
  let from = 9,
    to = 18;
  for (const h of list) {
    const s = toMin(h.start_time);
    from = Math.min(from, Math.floor(s / 60));
    to = Math.max(to, Math.ceil((s + h.duration_min) / 60));
  }
  return { from: Math.max(0, from), to: Math.min(24, Math.max(to, from + 1)) };
}

export interface Block {
  habit: Habit;
  day: number;
  /** 하루 0시부터 분 */
  start: number;
  end: number;
  /** 겹치는 수업은 칸을 나눠 쓴다 — 몇 번째 줄 / 모두 몇 줄 */
  lane: number;
  lanes: number;
}

/** 요일별 수업 칸 — 시간이 겹치면 나란히 */
export function blocksFor(list: Habit[], days: number[]): Block[] {
  const out: Block[] = [];
  for (const day of days) {
    const items = list
      .filter((h) => h.days.includes(day))
      .map((h) => ({ habit: h, day, start: toMin(h.start_time), end: Math.min(24 * 60, toMin(h.start_time) + h.duration_min), lane: 0, lanes: 1 }))
      .sort((a, b) => a.start - b.start || b.end - a.end);
    // 겹치는 묶음마다 줄 나누기
    let cluster: Block[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const n = cluster.reduce((m, b) => Math.max(m, b.lane + 1), 1);
      for (const b of cluster) b.lanes = n;
      out.push(...cluster);
      cluster = [];
    };
    for (const b of items) {
      if (cluster.length && b.start >= clusterEnd) flush();
      const used = new Set(cluster.filter((c) => c.end > b.start).map((c) => c.lane));
      let lane = 0;
      while (used.has(lane)) lane++;
      b.lane = lane;
      cluster.push(b);
      clusterEnd = Math.max(clusterEnd, b.end);
    }
    if (cluster.length) flush();
  }
  return out;
}

/** 사진으로 넣을 때 과목마다 다른 색 — 같은 과목 이름은 같은 색 */
export const CLASS_COLORS: ColorKey[] = ["violet", "blue", "cyan", "green", "amber", "orange", "pink", "lime", "slate"];
export function colorFor(title: string, taken: Map<string, ColorKey>): ColorKey {
  const key = title.trim();
  const had = taken.get(key);
  if (had) return had;
  const c = CLASS_COLORS[taken.size % CLASS_COLORS.length];
  taken.set(key, c);
  return c;
}

/** 이미 넣은 수업인가 — 같은 학기에 이름·시작 시각이 같고 요일이 겹침 */
export function isSameClass(h: Habit, c: { title: string; start: string; days: number[] }, sem: Semester): boolean {
  return (
    h.title.trim() === c.title.trim() &&
    h.start_time === c.start &&
    (h.start_day ?? "") === sem.start &&
    (h.end_day ?? "") === sem.end &&
    h.days.some((d) => c.days.includes(d))
  );
}
