// AI 일정 정리 — 기존 일정 목록(지우기·옮기기)과 날짜 고치기. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { existingForAi } from "../src/lib/ai.ts";
import { fixDayKey } from "../src/lib/time.ts";

const mk = (o) => ({ id: o.title, updated_at: "", title: "x", notes: null, day: "2026-10-11", end_day: null, yearly: false, emoji: null, color: "pink", created_at: "", deleted_at: null, ...o });

test("없는 날짜는 말일로, 꼴이 틀리면 null", () => {
  assert.equal(fixDayKey("2026-11-31"), "2026-11-30");
  assert.equal(fixDayKey("2027-02-29"), "2027-02-28");
  assert.equal(fixDayKey("2028-02-29"), "2028-02-29");
  assert.equal(fixDayKey("2026-10-11"), "2026-10-11");
  assert.deepEqual([fixDayKey("2026-13-01"), fixDayKey("2026-10-00"), fixDayKey("0000-01-01"), fixDayKey(null), fixDayKey("내일")], [null, null, null, null, null]);
});

test("표시도 m1… 로 AI 에게 보낸다 — 매년 것과 아직 안 지난 것만", () => {
  const marks = Object.fromEntries(
    [
      mk({ title: "엄마 생신", day: "1970-10-15", yearly: true }),
      mk({ title: "제주 여행", day: "2026-10-20", end_day: "2026-10-23" }),
      mk({ title: "지난 시험", day: "2026-10-01" }),
      mk({ title: "지운 표시", day: "2026-10-30", deleted_at: "2026-10-10T00:00:00Z" }),
    ].map((m) => [m.id, m]),
  );
  const ex = existingForAi({ tasks: {}, habits: {}, marks }, new Date(2026, 9, 11, 14));
  assert.deepEqual(ex.lines, [
    { ref: "m1", when: "매년 10/15 (표시)", title: "엄마 생신" },
    { ref: "m2", when: "10/20(화)~10/23(금) (표시)", title: "제주 여행" },
  ]);
  assert.deepEqual(ex.byRef.get("m2"), { kind: "mark", id: "제주 여행", title: "제주 여행", when: "10/20(화)~10/23(금) (표시)" });
});
