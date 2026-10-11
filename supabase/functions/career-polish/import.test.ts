// deno test career-polish/import.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildImportPrompt, cleanImport, cleanImported, cut, IMPORT_MAX_ENTRIES, IMPORT_SCHEMA, partialDate } from "./import.ts";

const TODAY = "2026-10-10";
const base = { title: "토익", kind: "cert", start: "", end: "", ongoing: false, date_guess: false, text: "토익 900", skills: [] };

Deno.test("부분 날짜 → 그 기간의 첫날·마지막 날", () => {
  assertEquals(partialDate("2026"), { first: "2026-01-01", last: "2026-12-31" });
  assertEquals(partialDate("2026-09"), { first: "2026-09-01", last: "2026-09-30" });
  assertEquals(partialDate("2026-2"), { first: "2026-02-01", last: "2026-02-28" });
  assertEquals(partialDate("2024-02"), { first: "2024-02-01", last: "2024-02-29" });
  assertEquals(partialDate("2024-11-05"), { first: "2024-11-05", last: "2024-11-05" });
  for (const bad of ["", "2026.09", "2026-13", "2026-02-30", "1900", "26-09", null, 2026]) assertEquals(partialDate(bad), null, String(bad));
});

Deno.test("날짜 하나(달) → 그 달 전체, 날짜 하나(날) → 그날", () => {
  const m = cleanImported({ ...base, start: "2024-04" }, TODAY)!;
  assertEquals([m.start_day, m.end_day, m.date_guess], ["2024-04-01", "2024-04-30", false]);
  const d = cleanImported({ ...base, start: "2024-02-07" }, TODAY)!;
  assertEquals([d.start_day, d.end_day], ["2024-02-07", "2024-02-07"]);
});

Deno.test("기간·진행 중·앞날 끝", () => {
  const r = cleanImported({ ...base, start: "2023-06-12", end: "2023-08-25" }, TODAY)!;
  assertEquals([r.start_day, r.end_day], ["2023-06-12", "2023-08-25"]);
  const ongoing = cleanImported({ ...base, start: "2023-05", ongoing: true }, TODAY)!;
  assertEquals([ongoing.start_day, ongoing.end_day, ongoing.date_guess], ["2023-05-01", null, false]);
  // 진행 중이어도 끝 날짜가 적혀 있으면 그 날짜
  const future = cleanImported({ ...base, start: "2026-06-10", end: "2026-11-20", ongoing: true }, TODAY)!;
  assertEquals(future.end_day, "2026-11-20");
  // 달 → 달: 시작 달 1일 ~ 끝 달 말일
  const months = cleanImported({ ...base, start: "2026-03", end: "2026-06" }, TODAY)!;
  assertEquals([months.start_day, months.end_day], ["2026-03-01", "2026-06-30"]);
});

Deno.test("끝이 시작보다 앞이면 — 해를 넘긴 것(12월 ~ 2월)은 다음 해로, 아니면 버리고 둘 다 '날짜 확인'", () => {
  const wrap = cleanImported({ ...base, start: "2023-12-18", end: "2023-02-24" }, TODAY)!;
  assertEquals([wrap.start_day, wrap.end_day, wrap.date_guess], ["2023-12-18", "2024-02-24", true]);
  // 잘못 적은 것('2024.06 ~ 2024.03')도 1년 안이면 다음 해로 읽히지만 '날짜 확인'이 붙어 사용자가 본다
  const typo = cleanImported({ ...base, start: "2024-06", end: "2024-03" }, TODAY)!;
  assertEquals([typo.start_day, typo.end_day, typo.date_guess], ["2024-06-01", "2025-03-31", true]);
  // 다음 해로 옮겨도 시작보다 앞이면(해가 두 해 이상 앞) 버림
  const far = cleanImported({ ...base, start: "2024-06-10", end: "2022-06-01" }, TODAY)!;
  assertEquals([far.end_day, far.date_guess], ["2024-06-10", true]);
});

Deno.test("해만 적힌 시작은 '날짜 확인'(한 해 전체 하나는 그대로)", () => {
  assertEquals(cleanImported({ ...base, start: "2022", ongoing: true }, TODAY)!.date_guess, true);
  assertEquals(cleanImported({ ...base, start: "2022", end: "2023-06" }, TODAY)!.date_guess, true);
  const year = cleanImported({ ...base, start: "2022" }, TODAY)!;
  assertEquals([year.start_day, year.end_day, year.date_guess], ["2022-01-01", "2022-12-31", false]);
  assertEquals(cleanImported({ ...base, start: "2021", end: "2023" }, TODAY)!.date_guess, false);
});

Deno.test("날짜가 없으면 오늘 하루 + 날짜 확인", () => {
  const r = cleanImported({ ...base, start: "", date_guess: false }, TODAY)!;
  assertEquals([r.start_day, r.end_day, r.date_guess], [TODAY, TODAY, true]);
  const bad = cleanImported({ ...base, start: "2026.09" }, TODAY)!;
  assertEquals([bad.start_day, bad.date_guess], [TODAY, true]);
});

Deno.test("글은 그대로 — 줄바꿈 정리, 빈 표 칸의 ' · ' 만 지움", () => {
  const r = cleanImported({ ...base, text: "OPIc · IH · \r\n\r\n  - 세부 내용  \n · 앞 칸 · 뒤 칸" }, TODAY)!;
  assertEquals(r.raw, "OPIc · IH\n  - 세부 내용\n앞 칸 · 뒤 칸");
});

Deno.test("글머리표 '·' 는 지우지 않는다(원문에 있든 없든)", () => {
  const text = "캡스톤 프로젝트 2025.03~2025.06\n  · 백엔드 담당\n· 결제 API 개발";
  assertEquals(cleanImported({ ...base, text }, TODAY, text)!.raw, text);
  assertEquals(cleanImported({ ...base, text }, TODAY)!.raw, text);
});

Deno.test("자르기는 글자 단위 — 이모지 반쪽이 남지 않는다", () => {
  const t = `${"가".repeat(119)}🏆더`;
  const r = cleanImported({ ...base, title: t }, TODAY)!;
  assertEquals(r.title, `${"가".repeat(119)}🏆`);
  assert(!/[\ud800-\udbff]$/.test(cut(`${"가".repeat(5)}🏆`, 6)));
  assertEquals(cut("abc", 10), "abc");
});

Deno.test("제목이 없으면 글 첫 줄, 둘 다 없으면 버림", () => {
  assertEquals(cleanImported({ ...base, title: "  ", text: "○○ 면접: 2030.04.07\n둘째 줄" }, TODAY)!.title, "○○ 면접: 2030.04.07");
  assertEquals(cleanImported({ ...base, title: "", text: "" }, TODAY), null);
});

Deno.test("종류·기술 정리", () => {
  const r = cleanImported({ ...base, kind: "hobby", title: "React 공부", skills: ["React", " React ", "", "React 공부", "TypeScript", 3] }, TODAY)!;
  assertEquals(r.kind, "etc");
  assertEquals(r.skills, ["React", "TypeScript"]);
});

Deno.test("목록 — 이상한 답·너무 많은 항목", () => {
  assertEquals(cleanImport({}, TODAY), []);
  assertEquals(cleanImport({ entries: "x" }, TODAY), []);
  const many = Array.from({ length: 80 }, (_, i) => ({ ...base, title: `항목 ${i}` }));
  assertEquals(cleanImport({ entries: [...many, null] }, TODAY).length, IMPORT_MAX_ENTRIES);
});

Deno.test("스키마 — 필드 순서(제목 먼저)·필수 값", () => {
  const item = IMPORT_SCHEMA.properties.entries.items;
  assertEquals(Object.keys(item.properties), item.required);
  assertEquals(item.required[0], "title");
  assert(buildImportPrompt("글", TODAY).includes(`오늘: ${TODAY}`));
});
