// '했나요?' — 시각 일정은 끝나면, 날짜만 일정은 그날이 지나면(다음 날) 묻는다. 날짜 없음은 묻지 않는다. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage ??= { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: () => null, length: 0 };

const { PlannerStore } = await import("../src/lib/store.ts");
const { checkinQueue, confirmDone, createTask, postponeToDay, taskState } = await import("../src/lib/planner.ts");
const { DEFAULT_SETTINGS } = await import("../src/lib/settings.ts");
const { addDays, dayKey, startOfDay } = await import("../src/lib/time.ts");

const day = (n) => dayKey(addDays(startOfDay(new Date()), n));
const live = (store) => Object.values(store.db.tasks).filter((t) => !t.deleted_at);
const setup = () => new PlannerStore(`c${Math.random()}`, null, null);

test("날짜만 일정은 그날이 지나야 묻고, 날짜 없음·오늘 것·7일 넘은 것은 묻지 않는다", () => {
  const store = setup();
  const yesterday = createTask(store, { title: "보고서 내기", schedule: "day", day: day(-1) }, DEFAULT_SETTINGS);
  createTask(store, { title: "오늘 할 일", schedule: "day", day: day(0) }, DEFAULT_SETTINGS);
  createTask(store, { title: "언젠가 책장 정리", schedule: "someday" }, DEFAULT_SETTINGS);
  createTask(store, { title: "열흘 전 일", schedule: "day", day: day(-10) }, DEFAULT_SETTINGS);
  const done = createTask(store, { title: "어제 한 일", schedule: "day", day: day(-1) }, DEFAULT_SETTINGS);
  store.patch("tasks", done.id, { status: "done", completed_at: new Date().toISOString() });
  const q = checkinQueue(live(store), Date.now());
  assert.deepEqual(
    q.map((t) => t.id),
    [yesterday.id],
  );
});

test("시각 일정은 끝나면 그날 바로 묻는다(예전 그대로)", () => {
  const store = setup();
  const end = Date.now() - 60_000;
  const t = createTask(
    store,
    { title: "치과", schedule: "timed", starts_at: new Date(end - 3600_000).toISOString(), ends_at: new Date(end).toISOString(), strict: false },
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(
    checkinQueue(live(store), Date.now()).map((x) => x.id),
    [t.id],
  );
});

test("날짜만 일정을 '했어요' 하면 그날 한 걸로(다음 날 0시가 아니라)", () => {
  const store = setup();
  const t = createTask(store, { title: "보고서 내기", schedule: "day", day: day(-2) }, DEFAULT_SETTINGS);
  confirmDone(store, t.id);
  const after = store.db.tasks[t.id];
  assert.equal(after.status, "done");
  assert.equal(dayKey(new Date(after.completed_at)), day(-2));
});

test("날짜만 일정 '다시 잡기'는 고른 날 하루로 옮기고 다시 묻지 않는다", () => {
  const store = setup();
  const t = createTask(store, { title: "보고서 내기", schedule: "day", day: day(-1) }, DEFAULT_SETTINGS);
  postponeToDay(store, t.id, day(1), "못 했어요");
  const after = store.db.tasks[t.id];
  assert.equal(after.schedule, "day");
  assert.equal(after.status, "planned");
  assert.equal(after.postpone_count, 1);
  assert.equal(after.starts_at, startOfDay(addDays(new Date(), 1)).toISOString());
  assert.equal(after.ends_at, startOfDay(addDays(new Date(), 2)).toISOString());
  assert.equal(checkinQueue(live(store), Date.now()).length, 0);
});

test("목록 동그라미도 같게 — 지난 날짜만 할 일은 '했나요?'(누르면 그날 한 걸로), 오늘 것·날짜 없음은 그대로", () => {
  const store = setup();
  const past = createTask(store, { title: "보고서 내기", schedule: "day", day: day(-1) }, DEFAULT_SETTINGS);
  const today = createTask(store, { title: "오늘 할 일", schedule: "day", day: day(0) }, DEFAULT_SETTINGS);
  const some = createTask(store, { title: "언젠가", schedule: "someday" }, DEFAULT_SETTINGS);
  assert.equal(taskState(past, Date.now(), 5), "unchecked");
  assert.equal(taskState(today, Date.now(), 5), "upcoming");
  assert.equal(taskState(some, Date.now() + 30 * 86_400_000, 5), "upcoming");
});
