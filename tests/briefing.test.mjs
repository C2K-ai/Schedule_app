// 오늘 브리핑 — 시각 순서 목록 + 시간 미정 이름 + 시간표 수업(서버 아침 푸시와 같은 모양). npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage ??= { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: () => null, length: 0 };

const { PlannerStore } = await import("../src/lib/store.ts");
const { createTask } = await import("../src/lib/planner.ts");
const { DEFAULT_SETTINGS } = await import("../src/lib/settings.ts");
const { dayKey } = await import("../src/lib/time.ts");
const { buildBriefing } = await import("../src/lib/briefing.ts");

// 아침 7시(현지) — 오늘 일정은 모두 아직 안 지남
const now = new Date();
now.setHours(7, 0, 0, 0);
const at = (h, m = 0) => {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const live = (store) => Object.values(store.db.tasks).filter((t) => !t.deleted_at);
const timed = (store, title, h) => createTask(store, { title, schedule: "timed", starts_at: at(h), ends_at: at(h + 1) }, DEFAULT_SETTINGS);
const klass = (o) => ({ id: o.title, updated_at: "", color: "violet", duration_min: 75, reminder_offsets: [], sound_id: null, strict: false, active: true, created_at: "", deleted_at: null, start_day: null, end_day: null, in_timetable: true, place: null, ...o });

test("시각 순서 목록 · 시간표 수업도 끼움 · 시간 미정은 이름으로 · 끝낸 일·언젠가는 빼고", () => {
  const store = new PlannerStore(`b${Math.random()}`, null, null);
  timed(store, "치과", 15);
  timed(store, "아침 운동", 8);
  createTask(store, { title: "보고서", schedule: "day", day: dayKey(now) }, DEFAULT_SETTINGS);
  createTask(store, { title: "언젠가 책장 정리", schedule: "someday" }, DEFAULT_SETTINGS);
  const done = timed(store, "끝낸 일", 9);
  store.patch("tasks", done.id, { status: "done", completed_at: now.toISOString() });
  const habits = [
    klass({ title: "자료구조", start_time: "10:30", days: [now.getDay()] }),
    klass({ title: "다른 요일 수업", start_time: "11:00", days: [(now.getDay() + 1) % 7] }),
    klass({ title: "지난 학기", start_time: "12:00", days: [now.getDay()], start_day: "2020-03-02", end_day: "2020-06-21" }),
  ];
  const b = buildBriefing(live(store), habits, now.getTime(), 5);
  assert.equal(b.title, "☀ 오늘 일정 4개");
  assert.equal(b.body, "08:00 아침 운동 · 10:30 자료구조 · 15:00 치과\n시간 미정 · 보고서");
  assert.equal(b.line, "08:00 아침 운동 · 10:30 자료구조 · 15:00 치과 · 시간 미정 · 보고서");
});

test("오늘 일정이 없으면 그렇게 말한다", () => {
  const store = new PlannerStore(`b${Math.random()}`, null, null);
  const b = buildBriefing(live(store), [], now.getTime(), 5);
  assert.equal(b.title, "☀ 좋은 아침이에요");
  assert.equal(b.body, "오늘 남은 일정이 없어요");
});
