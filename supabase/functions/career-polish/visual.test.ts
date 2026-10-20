// deno test career-polish/visual.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildVisualPrompt, cleanHtml, cleanVisual, readEntries, VISUAL_BUDGET } from "./visual.ts";

Deno.test("항목 정리 — 날짜 없는 것·빈 제목은 빼고, 종류는 모르면 기타, 글자 예산을 넘으면 뒤를 버린다", () => {
  const list = readEntries([
    { title: "캡스톤 발표", kind: "project", start_day: "2026-05-01", end_day: "2026-06-20", text: "본선 진출", skills: ["Python", ""] },
    { title: "", kind: "work", start_day: "2026-01-01" },
    { title: "날짜 없음", kind: "work" },
    { title: "이상한 종류", kind: "hack", start_day: "2025-03-02", end_day: "bad", text: "", skills: "x" },
  ]);
  assertEquals(list.length, 2);
  assertEquals(list[0].skills, ["Python"]);
  assertEquals(list[1].kind, "etc");
  assertEquals(list[1].end_day, null);
  const many = readEntries(Array.from({ length: 80 }, (_, i) => ({ title: `항목 ${i}`, start_day: "2026-01-01", text: "가".repeat(600) })));
  assert(many.length < 80 && many.length > 30);
  assert(many.reduce((n, e) => n + e.title.length + e.text.length + 40, 0) <= VISUAL_BUDGET);
});

Deno.test("프롬프트 — 번호·종류·기간·기술·원하는 느낌", () => {
  const p = buildVisualPrompt(
    readEntries([{ title: "토익 905점", kind: "cert", start_day: "2025-11-05", end_day: null, text: "", skills: [] }]),
    "2026-10-20",
    "파란색으로 깔끔하게",
  );
  assert(p.includes("[1] 토익 905점 · 자격증 · 2025-11-05 ~ 진행 중"));
  assert(p.includes('사용자가 원하는 느낌: """파란색으로 깔끔하게"""'));
});

Deno.test("visual 답 정리 — 없는 번호·겹치는 것 빼기, 대표 3개까지, 기술은 한 번씩", () => {
  const v = cleanVisual(
    {
      headline: "  데이터로 문제를 푸는 경영학도  ",
      summary: "요약",
      highlights: [{ n: 2, why: "a" }, { n: 2, why: "dup" }, { n: 9, why: "없는 번호" }, { n: 1, why: "b" }, { n: 3, why: "c" }, { n: 4, why: "d" }],
      items: [{ n: 1, line: "한 줄" }, { n: 1, line: "또" }, { n: 0, line: "x" }, { n: 2, line: "" }],
      skill_groups: [
        { name: "개발", skills: ["Python", "python", "React"] },
        { name: "", skills: ["SQL"] },
        { name: "언어", skills: [] },
      ],
    },
    4,
  );
  assertEquals(v.headline, "데이터로 문제를 푸는 경영학도");
  assertEquals(v.highlights.map((h) => h.n), [2, 1, 3]);
  assertEquals(v.items, [{ n: 1, line: "한 줄" }]);
  assertEquals(v.skill_groups, [{ name: "개발", skills: ["Python", "React"] }]);
  assertEquals(cleanVisual(null, 3).items, []);
});

Deno.test("AI HTML 에서 실행될 수 있는 것·바깥 주소를 걷어 낸다", () => {
  const h = cleanHtml(`설명 글\n<!doctype html><html><head><link rel="stylesheet" href="https://x.example/a.css"><meta http-equiv="refresh" content="0;url=https://evil.example">
<style>@import url(https://x.example/f.css); body{background:url("https://x.example/bg.png")}</style><script>alert(1)</script></head>
<body onload="steal()"><a href="javascript:alert(1)">a</a><a href="https://evil.example">b</a><img src="https://x.example/p.png" onerror=go()><iframe src="https://x.example"></iframe><svg><circle r="3"/></svg></body></html>`);
  assert(h.startsWith("<!doctype html>"));
  for (const bad of ["<script", "alert(1)", "onload", "onerror", "javascript:", "https://", "<iframe", "<link", "http-equiv", "@import"]) {
    assert(!h.includes(bad), bad);
  }
  assert(h.includes("<svg><circle"));
  assertEquals(cleanHtml(42), "");
});
