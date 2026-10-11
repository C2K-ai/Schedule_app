// 표시(생일·기념일) 날짜 계산. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { marksOnDay, upcomingMarks, whenLabel, yearlyOn } from "../src/lib/marks.ts";

const mk = (o) => ({ id: o.title, updated_at: "", title: "x", notes: null, day: "2026-10-11", end_day: null, yearly: false, emoji: null, color: "pink", created_at: "", ...o });

test("매년 반복·여러 날·하루짜리가 그 날에 걸린다", () => {
  const list = [
    mk({ title: "생일", day: "2000-10-11", yearly: true }),
    mk({ title: "여행", day: "2026-10-20", end_day: "2026-10-23" }),
    mk({ title: "시험", day: "2026-10-15" }),
  ];
  assert.deepEqual(marksOnDay(list, "2026-10-11").map((m) => m.title), ["생일"]);
  assert.deepEqual(marksOnDay(list, "1999-10-11").map((m) => m.title), []); // 처음 날 전엔 없음
  assert.deepEqual(marksOnDay(list, "2026-10-22").map((m) => m.title), ["여행"]);
  assert.deepEqual(marksOnDay(list, "2026-10-24").map((m) => m.title), []);
  assert.deepEqual(marksOnDay(list, "2026-10-15").map((m) => m.title), ["시험"]);
});

test("2월 29일 생일은 평년엔 2월 28일", () => {
  assert.equal(yearlyOn("2004-02-29", 2027), "2027-02-28");
  assert.equal(yearlyOn("2004-02-29", 2028), "2028-02-29");
  assert.deepEqual(marksOnDay([mk({ title: "윤일", day: "2004-02-29", yearly: true })], "2027-02-28").length, 1);
});

test("다가오는 표시: 내일 생일, 진행 중인 여행은 오늘, 지난 건 내년 생일로 넘어감", () => {
  const list = [
    mk({ title: "생일", day: "2000-10-11", yearly: true }),
    mk({ title: "여행", day: "2026-10-08", end_day: "2026-10-12" }),
    mk({ title: "먼 시험", day: "2026-11-30" }),
    mk({ title: "지난 기념일", day: "2020-10-01", yearly: true }),
  ];
  const up = upcomingMarks(list, "2026-10-10", 7);
  assert.deepEqual(up.map((u) => [u.mark.title, u.on, u.inDays]), [
    ["여행", "2026-10-10", 0],
    ["생일", "2026-10-11", 1],
  ]);
  assert.deepEqual(upcomingMarks(list, "2026-09-28", 7).map((u) => u.mark.title), ["지난 기념일"]);
  assert.equal(whenLabel(0) + whenLabel(1) + whenLabel(2) + whenLabel(5), "오늘내일모레D-5");
});
