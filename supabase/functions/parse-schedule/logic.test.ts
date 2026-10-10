// deno test parse-schedule/logic.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { calendarTable, checkImage, clean, MAX_IMAGE_B64, type RawItem } from "./logic.ts";

const base: RawItem = {
  title: "치과",
  kind: "timed",
  date: "2026-10-08",
  start: "15:00",
  duration_min: null,
  repeat_days: [],
  category: null,
  starred: false,
  reminders_min: null,
  notes: null,
};
const cats = [{ id: "c1", name: "개인" }, { id: "c2", name: "생일" }];

Deno.test("달력 표: 오늘·내일 표시와 요일", () => {
  const rows = calendarTable("2026-10-07").split("\n");
  assertEquals(rows[0], "2026-10-07 수 (오늘 · 이번 주)");
  assertEquals(rows[1], "2026-10-08 목 (내일 · 이번 주)");
  assertEquals(rows[4], "2026-10-11 일 (이번 주)");
  assertEquals(rows[5], "2026-10-12 월 (다음 주)");
  assertEquals(rows.length, 42);
  // "29일"처럼 3주 넘게 먼 날짜도 표에 있어야 모델이 계산하지 않고 고른다
  assertEquals(rows.some((r) => r.startsWith("2026-10-29 목")), true);
  assertEquals(rows[41], "2026-11-17 화 (6주 뒤)");
  assertEquals(calendarTable("2026-12-31").split("\n")[1], "2027-01-01 금 (내일 · 이번 주)");
  assertEquals(calendarTable("2026-10-11").split("\n")[1], "2026-10-12 월 (내일 · 다음 주)");
});

Deno.test("시각 일정은 그대로, 카테고리 이름 → id", () => {
  const r = clean({ ...base, category: "생일" }, cats, "2026-10-07")!;
  assertEquals([r.kind, r.date, r.start, r.category_id], ["timed", "2026-10-08", "15:00", "c2"]);
});

Deno.test("시각이 이상하면 날짜만 일정으로", () => {
  const r = clean({ ...base, start: "25:00" }, cats, "2026-10-07")!;
  assertEquals([r.kind, r.start, r.date], ["day", null, "2026-10-08"]);
});

Deno.test("언젠가 일정은 날짜·시각 없음", () => {
  const r = clean({ ...base, kind: "someday" }, cats, "2026-10-07")!;
  assertEquals([r.kind, r.date, r.start], ["someday", null, null]);
});

Deno.test("반복은 시각 일정으로 강제, 요일 정리", () => {
  const r = clean({ ...base, kind: "day", start: null, repeat_days: [5, 1, 1, 9, 3] }, cats, "2026-10-07")!;
  assertEquals([r.kind, r.start, r.repeat_days], ["timed", "09:00", [1, 3, 5]]);
});

Deno.test("길이·알림 범위 정리, 빈 제목은 버림", () => {
  const r = clean({ ...base, duration_min: 2, reminders_min: [0, 30, 30, -5] }, cats, "2026-10-07")!;
  assertEquals([r.duration_min, r.reminders_min], [5, [30, 0]]);
  assertEquals(clean({ ...base, title: "  " }, cats, "2026-10-07"), null);
});

Deno.test("모르는 카테고리는 없음, 날짜 빠지면 오늘", () => {
  const r = clean({ ...base, kind: "day", date: null, category: "회사" }, cats, "2026-10-07")!;
  assertEquals([r.date, r.category_id], ["2026-10-07", null]);
});

Deno.test("사진: 받는 꼴·크기 확인", () => {
  assertEquals(checkImage(undefined), null);
  assertEquals(checkImage({ media_type: "image/jpeg", data: "QUJD" }), { media_type: "image/jpeg", data: "QUJD" });
  assertEquals(checkImage({ media_type: "image/bmp", data: "QUJD" }), "bad_image");
  assertEquals(checkImage({ media_type: "image/png", data: "not base64!" }), "bad_image");
  assertEquals(checkImage({ media_type: "image/png", data: "A".repeat(MAX_IMAGE_B64 + 4) }), "image_too_big");
  assertEquals(checkImage("x"), "bad_image");
});
