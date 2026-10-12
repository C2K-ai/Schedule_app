// 시간표 계산(학기 짐작·묶기·칸 배치). npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { blocksFor, colorFor, gridDays, guessSemester, hourRange, isSameClass, pickGroup, semesterGroups, semesterLabel } from "../src/lib/timetable.ts";

const h = (o) => ({ id: o.title, updated_at: "", title: "x", color: "violet", days: [1], start_time: "09:00", duration_min: 75, reminder_offsets: [], sound_id: null, strict: false, active: true, created_at: "", deleted_at: null, start_day: "2026-09-01", end_day: "2026-12-21", in_timetable: true, place: null, ...o });

test("학기 짐작: 2학기 중·방학·연말", () => {
  assert.deepEqual(guessSemester(new Date(2026, 9, 12)), { start: "2026-09-01", end: "2026-12-21" });
  assert.deepEqual(guessSemester(new Date(2026, 6, 20)), { start: "2026-09-01", end: "2026-12-21" }); // 여름방학 → 다가오는 2학기
  assert.deepEqual(guessSemester(new Date(2026, 0, 10)), { start: "2026-03-02", end: "2026-06-21" }); // 겨울방학 → 1학기
  assert.deepEqual(guessSemester(new Date(2026, 11, 28)), { start: "2027-03-02", end: "2027-06-21" });
  assert.equal(semesterLabel("2026-09-01"), "2026년 2학기");
  assert.equal(semesterLabel("2026-03-02"), "2026년 1학기");
  assert.equal(semesterLabel("2027-01-04"), "2026년 겨울학기");
  assert.equal(semesterLabel(null), "기간 없는 시간표");
});

test("학기별로 묶고, 오늘이 든 학기 → 다음 학기 → 최근 학기 순으로 고른다", () => {
  const list = [
    h({ title: "지난 학기", start_day: "2026-03-02", end_day: "2026-06-21" }),
    h({ title: "자료구조", days: [1, 3] }),
    h({ title: "운영체제", days: [2, 4] }),
  ];
  const g = semesterGroups(list);
  assert.deepEqual(g.map((x) => [x.label, x.habits.length]), [["2026년 1학기", 1], ["2026년 2학기", 2]]);
  assert.equal(pickGroup(g, "2026-10-12")?.label, "2026년 2학기");
  assert.equal(pickGroup(g, "2026-07-10")?.label, "2026년 2학기"); // 방학 → 다음 학기
  assert.equal(pickGroup(g, "2027-01-10")?.label, "2026년 2학기"); // 다 끝남 → 최근
  assert.equal(pickGroup([], "2026-10-12"), null);
});

test("요일·시간대: 주말 수업이 있으면 그 칸만 늘리고, 이른·늦은 수업이면 시간대를 넓힌다", () => {
  assert.deepEqual(gridDays([h({ days: [1, 3] })]), [1, 2, 3, 4, 5]);
  assert.deepEqual(gridDays([h({ days: [6] })]), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(gridDays([h({ days: [0] })]), [1, 2, 3, 4, 5, 0]);
  assert.deepEqual(hourRange([h({ start_time: "10:30", duration_min: 75 })]), { from: 9, to: 18 });
  assert.deepEqual(hourRange([h({ start_time: "08:00" }), h({ start_time: "18:30", duration_min: 150 })]), { from: 8, to: 21 });
});

test("겹치는 수업은 나란히(줄 나누기), 안 겹치면 한 줄", () => {
  const b = blocksFor([h({ title: "A", start_time: "09:00", duration_min: 90 }), h({ title: "B", start_time: "10:00", duration_min: 60 }), h({ title: "C", start_time: "13:00", duration_min: 60 })], [1]);
  const by = Object.fromEntries(b.map((x) => [x.habit.title, [x.lane, x.lanes, x.start, x.end]]));
  assert.deepEqual(by.A, [0, 2, 540, 630]);
  assert.deepEqual(by.B, [1, 2, 600, 660]);
  assert.deepEqual(by.C, [0, 1, 780, 840]);
});

test("사진으로 넣을 때: 같은 과목은 같은 색, 이미 넣은 수업 알아보기", () => {
  const taken = new Map();
  const a = colorFor("자료구조", taken), b = colorFor("운영체제", taken), c = colorFor("자료구조 ", taken);
  assert.equal(a, c);
  assert.notEqual(a, b);
  const sem = { start: "2026-09-01", end: "2026-12-21" };
  const cls = h({ title: "자료구조", days: [1, 3], start_time: "10:30" });
  assert.equal(isSameClass(cls, { title: "자료구조", start: "10:30", days: [3] }, sem), true);
  assert.equal(isSameClass(cls, { title: "자료구조", start: "10:30", days: [5] }, sem), false);
  assert.equal(isSameClass(cls, { title: "자료구조", start: "10:30", days: [1] }, { start: "2027-03-02", end: "2027-06-21" }), false);
});
