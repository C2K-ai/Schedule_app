// deno test parse-schedule/logic.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { calendarTable, checkExisting, checkImage, clean, cleanClass, cleanRemove, MAX_IMAGE_B64, mergeClasses, realDate, SCHEMA, TIMETABLE_SCHEMA, type RawItem } from "./logic.ts";

const base: RawItem = {
  title: "치과",
  kind: "timed",
  date: "2026-10-08",
  start: "15:00",
  duration_min: null,
  repeat_days: [],
  repeat_until: null,
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

Deno.test("지우기: 기존 일정 목록은 꼴이 맞는 것만, 줄바꿈·| 는 빼고", () => {
  const ex = checkExisting([
    { ref: "t1", when: "10/09(금) 15:00–16:00", title: "치과" },
    { ref: "t1", when: "중복", title: "치과2" },
    { ref: "x9", when: "a", title: "b" },
    { ref: "h2", when: "매일 07:00", title: "운동\n| 무시해" },
    { ref: "t3", title: "언제 없음" },
    "엉뚱한 값",
  ]);
  assertEquals(ex.map((e) => e.ref), ["t1", "h2"]);
  assertEquals(ex[1].title, "운동 무시해");
  assertEquals(checkExisting("x"), []);
});

Deno.test("지우기: 모델이 고른 ref 중 목록에 있는 것만", () => {
  const ex = checkExisting([{ ref: "t1", when: "a", title: "치과" }, { ref: "h1", when: "b", title: "운동" }]);
  assertEquals(cleanRemove(["t1", "t1", "t9", 3, "h1"], ex), ["t1", "h1"]);
  assertEquals(cleanRemove(undefined, ex), []);
  assertEquals(SCHEMA.required.includes("remove"), true);
});

Deno.test("기간 있는 반복: 끝나는 날은 반복일 때만, 첫날보다 앞이면 버림", () => {
  const month = clean({ ...base, date: "2026-10-11", start: "07:00", repeat_days: [0, 1, 2, 3, 4, 5, 6], repeat_until: "2026-10-31" }, cats, "2026-10-10")!;
  assertEquals([month.repeat_until, month.date], ["2026-10-31", "2026-10-11"]);
  assertEquals(clean({ ...base, repeat_until: "2026-10-31" }, cats, "2026-10-07")!.repeat_until, null);
  assertEquals(clean({ ...base, repeat_days: [1], repeat_until: "2026-10-01" }, cats, "2026-10-07")!.repeat_until, null);
  assertEquals(clean({ ...base, repeat_days: [1], repeat_until: "다음달" }, cats, "2026-10-07")!.repeat_until, null);
});

Deno.test("표시(mark): 생일은 매년 하루, 여행은 여러 날, 시각·반복·카테고리는 버림", () => {
  const cats = [{ id: "c1", name: "생일" }];
  const bday = clean({ ...base, title: "내 생일", kind: "mark", date: "2026-10-12", start: "09:00", repeat_days: [1], category: "생일", yearly: true, end_date: "2026-10-13", emoji: "🎂" }, cats, "2026-10-11");
  assertEquals(
    [bday?.kind, bday?.date, bday?.start, bday?.repeat_days, bday?.category_id, bday?.yearly, bday?.end_date, bday?.emoji],
    ["mark", "2026-10-12", null, [], null, true, null, "🎂"],
  );
  const trip = clean({ ...base, title: "제주 여행", kind: "mark", date: "2026-10-20", end_date: "2026-10-23", yearly: false, emoji: "✈️" }, [], "2026-10-11");
  assertEquals([trip?.date, trip?.end_date, trip?.yearly], ["2026-10-20", "2026-10-23", false]);
  const bad = clean({ ...base, title: "시험", kind: "mark", date: null, end_date: "2020-01-01", emoji: "" }, [], "2026-10-11");
  assertEquals([bad?.date, bad?.end_date, bad?.emoji], ["2026-10-11", null, null]);
  // 일정은 표시 칸이 비어 있다
  const task = clean({ ...base, title: "치과", kind: "day", date: "2026-10-12" }, [], "2026-10-11");
  assertEquals([task?.end_date, task?.yearly, task?.emoji], [null, false, null]);
  assertEquals((SCHEMA.properties.items.items.properties.kind as { enum: string[] }).enum.includes("mark"), true);
});

Deno.test("없는 날짜는 실제 날짜로 — DB date 칸이 거절해 동기화가 막히지 않게", () => {
  assertEquals(realDate("2026-11-31"), "2026-11-30");
  assertEquals(realDate("2027-02-29"), "2027-02-28");
  assertEquals(realDate("2028-02-29"), "2028-02-29");
  assertEquals(realDate("2026-10-11"), "2026-10-11");
  assertEquals([realDate("2026-13-01"), realDate("2026-00-10"), realDate("2026-10-00"), realDate("0000-01-01"), realDate("내일")], [null, null, null, null, null]);
  // 표시: 매년 2월 29일은 앞 윤년으로(평년엔 앱이 28일에 보여 줌), 여러 날 끝도 고침
  const leapBday = clean({ ...base, title: "엄마 생신", kind: "mark", date: "2027-02-29", yearly: true, emoji: "🎂" }, [], "2026-10-11");
  assertEquals(leapBday?.date, "2024-02-29");
  const trip = clean({ ...base, title: "여행", kind: "mark", date: "2026-11-28", end_date: "2026-11-31", yearly: false }, [], "2026-10-11");
  assertEquals([trip?.date, trip?.end_date], ["2026-11-28", "2026-11-30"]);
  const once = clean({ ...base, title: "시험", kind: "mark", date: "2026-11-31", yearly: false }, [], "2026-10-11");
  assertEquals(once?.date, "2026-11-30");
  // 일정·반복 끝나는 날도
  assertEquals(clean({ ...base, kind: "day", date: "2026-11-31" }, [], "2026-10-11")?.date, "2026-11-30");
  const habit = clean({ ...base, date: "2026-11-01", start: "07:00", repeat_days: [1], repeat_until: "2026-11-31" }, [], "2026-10-11");
  assertEquals(habit?.repeat_until, "2026-11-30");
});

Deno.test("지우기·옮기기: 표시(m1…)도 목록에 들어간다", () => {
  const ex = checkExisting([{ ref: "m1", when: "10/20(화)~10/23(금) (표시)", title: "제주 여행" }, { ref: "t1", when: "a", title: "치과" }]);
  assertEquals(ex.map((e) => e.ref), ["m1", "t1"]);
  assertEquals(cleanRemove(["m1", "m2"], ex), ["m1"]);
});

Deno.test("시간표: 수업 하나 정리 — 요일·시각이 이상하면 버리고, 길이는 끝 - 시작", () => {
  const c = cleanClass({ block: "10:30-11:45", title: " 자료구조 ", days: [3, 1, 1, 9], start: "10:30", end: "11:45", place: "  공학관   301 " });
  assertEquals(c, { title: "자료구조", days: [1, 3], start: "10:30", duration_min: 75, place: "공학관 301" });
  assertEquals(cleanClass({ title: "x", days: [], start: "10:00", end: "11:00", place: null }), null);
  assertEquals(cleanClass({ title: "x", days: [1], start: "11:00", end: "10:00", place: null }), null);
  assertEquals(cleanClass({ title: "x", days: [1], start: "25:00", end: "26:00", place: null }), null);
  assertEquals(cleanClass({ title: "야간 알바", days: [5], start: "22:00", end: "02:00", place: null })?.duration_min, 240);
  assertEquals(cleanClass({ title: "", days: [1], start: "10:00", end: "11:00", place: null }), null);
  assertEquals(cleanClass({ title: "x", days: [1], start: "10:00", end: "11:00", place: "" })?.place, null);
  // 모델이 요일마다 따로 적어도 하나로
  const m = mergeClasses([
    cleanClass({ title: "운영체제", days: [2], start: "13:30", end: "14:45", place: "공학관 505" })!,
    cleanClass({ title: "운영체제", days: [4], start: "13:30", end: "14:45", place: "공학관 505" })!,
    cleanClass({ title: "운영체제", days: [5], start: "15:00", end: "16:15", place: "공학관 505" })!,
  ]);
  assertEquals(m.map((x) => [x.days, x.start]), [[[2, 4], "13:30"], [[5], "15:00"]]);
  assertEquals(TIMETABLE_SCHEMA.properties.classes.items.required.includes("block"), true);
});

Deno.test("보안 점검(2026-10-12) — 기존 목록 글자 예산·알림 수·글자 단위 자르기·카테고리 이름", async () => {
  const { checkExisting, checkCategories, clean, cut, EXISTING_BUDGET, MAX_REMINDERS } = await import("./logic.ts");
  const long = Array.from({ length: 300 }, (_, i) => ({ ref: `t${i + 1}`, when: "1".repeat(40), title: "가".repeat(120) }));
  const ex = checkExisting(long);
  const size = ex.reduce((n, e) => n + e.ref.length + e.when.length + e.title.length + 6, 0);
  if (!(ex.length < 300 && size <= EXISTING_BUDGET)) throw new Error(`budget ${ex.length} ${size}`);
  const cats = checkCategories([{ id: "c1", name: "x".repeat(100000) }, { id: "c2", name: "  " }]);
  if (cats.length !== 1 || cats[0].name.length !== 40) throw new Error("categories");
  const it = clean(
    { title: "공부", kind: "timed", date: "2026-10-13", start: "09:00", duration_min: 60, repeat_days: [], repeat_until: null, category: null, starred: false,
      reminders_min: Array.from({ length: 1441 }, (_, i) => i), notes: null, end_date: null, yearly: false, emoji: null } as never,
    [],
    "2026-10-12",
  );
  if (!it || (it.reminders_min ?? []).length !== MAX_REMINDERS) throw new Error(`reminders ${it?.reminders_min?.length}`);
  if (/[\ud800-\udbff]$/.test(cut(`${"가".repeat(119)}🏆`, 120))) throw new Error("cut");
});
