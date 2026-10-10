// deno test career-polish/import.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildImportPrompt, cleanImport, cleanImported, IMPORT_MAX_ENTRIES, IMPORT_SCHEMA, partialDate } from "./import.ts";

const TODAY = "2026-10-10";
const base = { title: "토익", kind: "cert", start: "", end: "", ongoing: false, date_guess: false, text: "토익 900", skills: [] };

Deno.test("부분 날짜 → 그 기간의 첫날·마지막 날", () => {
  assertEquals(partialDate("2026"), { first: "2026-01-01", last: "2026-12-31" });
  assertEquals(partialDate("2026-09"), { first: "2026-09-01", last: "2026-09-30" });
  assertEquals(partialDate("2026-2"), { first: "2026-02-01", last: "2026-02-28" });
  assertEquals(partialDate("2024-02"), { first: "2024-02-01", last: "2024-02-29" });
  assertEquals(partialDate("2025-09-09"), { first: "2025-09-09", last: "2025-09-09" });
  for (const bad of ["", "2026.09", "2026-13", "2026-02-30", "1900", "26-09", null, 2026]) assertEquals(partialDate(bad), null, String(bad));
});

Deno.test("날짜 하나(달) → 그 달 전체, 날짜 하나(날) → 그날", () => {
  const m = cleanImported({ ...base, start: "2025-08" }, TODAY)!;
  assertEquals([m.start_day, m.end_day, m.date_guess], ["2025-08-01", "2025-08-31", false]);
  const d = cleanImported({ ...base, start: "2026-03-13" }, TODAY)!;
  assertEquals([d.start_day, d.end_day], ["2026-03-13", "2026-03-13"]);
});

Deno.test("기간·진행 중·앞날 끝", () => {
  const r = cleanImported({ ...base, start: "2025-07-22", end: "2025-08-11" }, TODAY)!;
  assertEquals([r.start_day, r.end_day], ["2025-07-22", "2025-08-11"]);
  const ongoing = cleanImported({ ...base, start: "2025-07", ongoing: true }, TODAY)!;
  assertEquals([ongoing.start_day, ongoing.end_day], ["2025-07-01", null]);
  // 진행 중이어도 끝 날짜가 적혀 있으면 그 날짜
  const future = cleanImported({ ...base, start: "2026-06-02", end: "2026-10-17", ongoing: true }, TODAY)!;
  assertEquals(future.end_day, "2026-10-17");
  // 달 → 달: 시작 달 1일 ~ 끝 달 말일
  const months = cleanImported({ ...base, start: "2026-03", end: "2026-06" }, TODAY)!;
  assertEquals([months.start_day, months.end_day], ["2026-03-01", "2026-06-30"]);
});

Deno.test("끝이 시작보다 앞이면 끝을 버린다", () => {
  const r = cleanImported({ ...base, start: "2026-05-18", end: "2026-05-01" }, TODAY)!;
  assertEquals(r.end_day, "2026-05-18");
});

Deno.test("날짜가 없으면 오늘 하루 + 날짜 확인", () => {
  const r = cleanImported({ ...base, start: "", date_guess: false }, TODAY)!;
  assertEquals([r.start_day, r.end_day, r.date_guess], [TODAY, TODAY, true]);
  const bad = cleanImported({ ...base, start: "2026.09" }, TODAY)!;
  assertEquals([bad.start_day, bad.date_guess], [TODAY, true]);
});

Deno.test("글은 그대로 — 줄바꿈 정리, 빈 표 칸의 ' · ' 만 지움", () => {
  const r = cleanImported({ ...base, text: "OPIc · IH · \r\n\r\n  - 세부 내용  \n · 앞 칸 비었음" }, TODAY)!;
  assertEquals(r.raw, "OPIc · IH\n  - 세부 내용\n앞 칸 비었음");
});

Deno.test("제목이 없으면 글 첫 줄, 둘 다 없으면 버림", () => {
  assertEquals(cleanImported({ ...base, title: "  ", text: "KT 면접: 2026.03.13\n둘째 줄" }, TODAY)!.title, "KT 면접: 2026.03.13");
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
