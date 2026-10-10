// 돌아보기 계산. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReview, fmtMin, slotOf } from "../src/lib/review.ts";

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).toISOString();
let n = 0;
const task = (o) => ({
  id: `t${++n}`,
  updated_at: at(1, 0),
  habit_id: null,
  occurrence_date: null,
  title: "일정",
  notes: null,
  color: "blue",
  status: "planned",
  started_at: null,
  completed_at: null,
  reminder_offsets: [],
  sound_id: null,
  strict: false,
  postpone_count: 0,
  created_at: at(1, 0),
  schedule: "timed",
  category_id: null,
  starred: false,
  ...o,
});
const cats = [{ id: "c1", name: "공부", color: "violet", sort: 0, created_at: at(1, 0), updated_at: at(1, 0) }];
const from = new Date(2026, 9, 5).getTime(); // 10/5(월) 0시
const to = new Date(2026, 9, 12).getTime();
const now = new Date(2026, 9, 9, 12).getTime(); // 10/9(금) 정오

test("계획 대비 실제·카테고리별 시간 — 아직 시작 안 한 일정은 계획에서 뺀다", () => {
  const r = buildReview(
    {
      tasks: [
        task({ starts_at: at(6, 9), ends_at: at(6, 11), status: "done", category_id: "c1" }), // 2시간 해냄
        task({ starts_at: at(7, 20), ends_at: at(7, 21), status: "missed", category_id: "c1" }), // 1시간 놓침(저녁)
        task({ starts_at: at(8, 14), ends_at: at(8, 14, 30), status: "done" }), // 분류 없음 30분
        task({ starts_at: at(10, 9), ends_at: at(10, 10) }), // 미래 — 빼기
        task({ starts_at: at(6, 0), ends_at: at(6, 0), schedule: "day" }), // 날짜만 — 빼기
        task({ starts_at: at(6, 9), ends_at: at(6, 10), status: "done", deleted_at: at(6, 12) }), // 지움 — 빼기
      ],
      activities: [
        { id: "a1", updated_at: at(1, 0), title: "산책", notes: null, day: "2026-10-07", starts_at: at(7, 18), ends_at: at(7, 18, 40), color: "green", category_id: null, created_at: at(7, 19) },
        { id: "a2", updated_at: at(1, 0), title: "책", notes: null, day: "2026-10-08", starts_at: null, ends_at: null, color: "green", category_id: "c1", created_at: at(8, 19) },
        { id: "a3", updated_at: at(1, 0), title: "기간 밖", notes: null, day: "2026-10-12", starts_at: null, ends_at: null, color: "green", category_id: null, created_at: at(12, 9) },
      ],
      categories: cats,
      habits: [],
      logs: [],
    },
    from,
    to,
    now,
  );
  assert.equal(r.planMin, 210);
  assert.equal(r.doneMin, 150);
  assert.equal(r.actCount, 2);
  assert.equal(r.actMin, 40);
  const study = r.cats.find((c) => c.id === "c1");
  assert.deepEqual([study.name, study.planMin, study.doneMin, study.actCount], ["공부", 180, 120, 1]);
  const none = r.cats.find((c) => c.id === "none");
  assert.deepEqual([none.name, none.planMin, none.doneMin, none.actMin], ["분류 없음", 30, 30, 40]);
  assert.equal(r.cats[0].id, "c1"); // 해낸 시간 많은 순
});

test("시간대·요일별로 어긴 횟수 — 미룬 기록은 원래 시각으로 센다, 3번부터 알려 준다", () => {
  const evening = (d, status) => task({ starts_at: at(d, 19), ends_at: at(d, 20), status });
  const r = buildReview(
    {
      tasks: [evening(5, "missed"), evening(6, "skipped"), evening(7, "done"), task({ starts_at: at(6, 8), ends_at: at(6, 9), status: "done" })],
      activities: [],
      categories: cats,
      habits: [],
      logs: [{ id: "l1", updated_at: at(1, 0), task_id: null, kind: "postponed", reason: "피곤", from_starts_at: at(8, 21), to_starts_at: at(9, 9), title: "x", created_at: at(8, 21) }],
    },
    from,
    to,
    now,
  );
  const ev = r.slots.find((s) => s.key === "evening");
  assert.deepEqual([ev.total, ev.kept, ev.slipped], [3, 1, 3]);
  assert.equal(r.slots.find((s) => s.key === "morning").kept, 1);
  assert.equal(r.weakSlot?.key, "evening");
  assert.equal(r.weakDow, null); // 요일마다 1번씩 — 3번이 안 됨
});

test("습관은 끝난 날만 센다", () => {
  const h = { id: "h1", updated_at: at(1, 0), title: "운동", color: "amber", days: [1, 2, 3, 4, 5], start_time: "07:00", duration_min: 30, reminder_offsets: [], sound_id: null, strict: false, active: true, created_at: at(1, 0) };
  const ht = (d, status) => task({ habit_id: "h1", title: "운동", starts_at: at(d, 7), ends_at: at(d, 7, 30), status });
  const r = buildReview({ tasks: [ht(5, "done"), ht(6, "missed"), ht(7, "done"), ht(8, "done"), ht(9, "planned")], activities: [], categories: [], habits: [h], logs: [] }, from, to, now);
  // 10/9 7시 일정은 끝났지만 답을 안 함 → total 에는 들어가고 done 은 아님
  assert.deepEqual(r.habits.map((x) => [x.title, x.done, x.total]), [["운동", 3, 5]]);
});

test("slotOf·fmtMin", () => {
  assert.equal(slotOf(new Date(2026, 9, 5, 4, 59).getTime()), "night");
  assert.equal(slotOf(new Date(2026, 9, 5, 5).getTime()), "morning");
  assert.equal(slotOf(new Date(2026, 9, 5, 22, 59).getTime()), "evening");
  assert.equal(fmtMin(0), "0분");
  assert.equal(fmtMin(45), "45분");
  assert.equal(fmtMin(120), "2시간");
  assert.equal(fmtMin(125), "2시간 5분");
});
