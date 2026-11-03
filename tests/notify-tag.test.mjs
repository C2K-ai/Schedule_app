// 알림 자리(tag) — 한 일정의 곧 시작·정각·미시작이 한 자리, 앱(reminders.ts) = 서버(send-due-notifications/rules.ts). npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage ??= { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: () => null, length: 0 };

const { PlannerStore } = await import("../src/lib/store.ts");
const { createTask } = await import("../src/lib/planner.ts");
const { DEFAULT_SETTINGS } = await import("../src/lib/settings.ts");
const { computeTriggers, triggerTag } = await import("../src/lib/reminders.ts");
const { taskTag } = await import("../supabase/functions/send-due-notifications/rules.ts");

test("일정 하나 = 알림창 한 자리: 곧 시작·정각·미시작 모두 같은 tag, 앱 = 서버, 일정마다 다름", () => {
  const store = new PlannerStore(`n${Math.random()}`, null, null);
  const at = (m) => new Date(Date.now() + m * 60_000).toISOString();
  const a = createTask(store, { title: "택배 갖고 오기", schedule: "timed", starts_at: at(60), ends_at: at(120), reminder_offsets: [30, 10, 0], strict: true }, DEFAULT_SETTINGS);
  const b = createTask(store, { title: "운동", schedule: "timed", starts_at: at(90), ends_at: at(150), strict: true }, DEFAULT_SETTINGS);
  const trig = computeTriggers([a, b], DEFAULT_SETTINGS, []);
  const ofA = trig.filter((t) => t.task.id === a.id);
  assert.ok(new Set(ofA.map((t) => t.kind)).size >= 3, `곧 시작·정각·미시작이 다 있다: ${ofA.map((t) => t.kind)}`);
  assert.deepEqual([...new Set(ofA.map((t) => t.tag))], [taskTag(a.id)]);
  assert.equal(triggerTag(a.id), `must-${a.id}`);
  assert.notEqual(trig.find((t) => t.task.id === b.id).tag, taskTag(a.id));
});
