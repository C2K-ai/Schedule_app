// deno test career-polish/logic.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildPrompt, cleanPolished } from "./logic.ts";

Deno.test("재료가 하나도 없으면 null", () => {
  assertEquals(buildPrompt({ raw: "  ", events: [], notes: [] }), null);
});

Deno.test("메모·일정·노트를 프롬프트로", () => {
  const p = buildPrompt({
    title: "플래너 앱",
    kind: "project",
    start_day: "2026-10-01",
    end_day: null,
    raw: "혼자 만듦",
    events: [{ date: "2026-10-05", title: "알림 서버 만들기", notes: "푸시" }, { date: "bad", title: "버림" }],
    notes: [{ day: "2026-10-06", body: "오늘   배포함" }],
  })!;
  assert(p.includes("종류: 프로젝트"));
  assert(p.includes("2026-10-01 ~ 진행 중"));
  assert(p.includes("- 2026-10-05 알림 서버 만들기 (푸시)"));
  assert(!p.includes("버림"));
  assert(p.includes("- 2026-10-06: 오늘 배포함"));
});

Deno.test("모르는 종류는 기타", () => {
  assert(buildPrompt({ kind: "hobby", raw: "x" })!.includes("종류: 기타"));
});

Deno.test("결과 정리: 중복·빈 값 제거", () => {
  const r = cleanPolished({ title: " 제목 ", summary: "요약", bullets: ["a", "a", " ", "b"], skills: ["Next.js", "Next.js"] });
  assertEquals(r, { title: "제목", summary: "요약", bullets: ["a", "b"], skills: ["Next.js"] });
});
