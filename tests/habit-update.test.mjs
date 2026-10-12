// 습관(수업)을 고칠 때 회차 — 기간 줄였다 되돌리기·멈췄다 다시 시작하면 되살리고, 옮긴 회차는 건드리지 않는다. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage ??= { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: () => null, length: 0 };

const { PlannerStore } = await import("../src/lib/store.ts");
const { createHabit, materializeHabits, updateHabit } = await import("../src/lib/planner.ts");
const { addDays, dayKey, startOfDay } = await import("../src/lib/time.ts");

const day = (n) => dayKey(addDays(startOfDay(new Date()), n));
function setup() {
  const store = new PlannerStore(`t${Math.random()}`, null, null);
  // 내일부터 20일 동안 매일 10:00 수업
  const h = createHabit(store, { title: "자료구조", color: "blue", days: [0, 1, 2, 3, 4, 5, 6], start_time: "10:00", duration_min: 75, reminder_offsets: [10], sound_id: null, strict: false, start_day: day(1), end_day: day(20), in_timetable: true, place: "공학관 301" });
  const mat = () => materializeHabits(store, Array.from({ length: 30 }, (_, i) => addDays(startOfDay(new Date()), i)));
  mat();
  const occ = () => Object.values(store.db.tasks).filter((t) => t.habit_id === h.id);
  const live = () => occ().filter((t) => !t.deleted_at);
  const on = (n) => occ().find((t) => t.occurrence_date === day(n));
  return { store, h, mat, live, on };
}

test("학기 기간을 줄였다 되돌리면 지워졌던 회차가 되살아난다", () => {
  const { store, h, mat, live } = setup();
  assert.equal(live().length, 20);
  updateHabit(store, h.id, { end_day: day(3) });
  mat();
  assert.equal(live().length, 3);
  updateHabit(store, h.id, { end_day: day(20) });
  mat();
  assert.equal(live().length, 20);
});

test("기간 안에서 사용자가 지운 회차(휴강)는 기간을 늘려도 그대로, 멈췄다 다시 시작하면 다 되살아난다", () => {
  const { store, h, mat, live, on } = setup();
  store.patch("tasks", on(5).id, { deleted_at: new Date().toISOString() }); // 휴강
  updateHabit(store, h.id, { end_day: day(25) });
  mat();
  assert.equal(Boolean(on(5).deleted_at), true, "휴강은 기간을 늘려도 그대로");
  updateHabit(store, h.id, { active: false });
  assert.equal(live().length, 0);
  updateHabit(store, h.id, { active: true });
  mat();
  // 멈춘 동안엔 모든 날이 규칙 밖이라 휴강도 같이 되살아난다(사용자가 지운 것과 구별할 표시가 없음) — 회차를 다 잃는 것보다 낫다
  assert.equal(live().length, 25);
});

test("학기 기간·강의실만 바꾸면 옮긴 회차(보강)는 그대로, 시각을 바꾸면 안 옮긴 회차만 새 시각", () => {
  const { store, h, on } = setup();
  const moved = on(4);
  const s = new Date(moved.starts_at);
  s.setHours(15, 0, 0, 0);
  store.patch("tasks", moved.id, { starts_at: s.toISOString(), ends_at: new Date(s.getTime() + 75 * 60000).toISOString() });
  updateHabit(store, h.id, { end_day: day(22), place: "공학관 302" });
  assert.equal(new Date(on(4).starts_at).getHours(), 15, "기간만 바꿨는데 보강 시각이 돌아가면 안 됨");
  assert.equal(new Date(on(6).starts_at).getHours(), 10);
  updateHabit(store, h.id, { start_time: "11:00" });
  assert.equal(new Date(on(4).starts_at).getHours(), 15, "옮긴 회차는 그대로");
  assert.equal(new Date(on(6).starts_at).getHours(), 11, "안 옮긴 회차는 새 시각");
  updateHabit(store, h.id, { title: "자료구조(분반2)" });
  assert.equal(on(4).title, "자료구조(분반2)", "이름은 옮긴 회차도 바뀜");
});

test("서버가 만든 회차(시각 글자 꼴 +00:00)도 안 옮긴 것으로 본다", () => {
  const { store, h, on } = setup();
  const t = on(7);
  store.patch("tasks", t.id, { starts_at: t.starts_at.replace(".000Z", "+00:00"), ends_at: t.ends_at.replace(".000Z", "+00:00") });
  updateHabit(store, h.id, { start_time: "09:00" });
  assert.equal(new Date(on(7).starts_at).getHours(), 9);
});
