// 커리어 한눈에 보기 — AI 글 + 기록 → HTML(글자는 모두 이스케이프, CSP 로 잠금), AI HTML 잠그기. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

const { lockHtml, renderCareerHtml, VISUAL_CSP, visualInput, visualOrder, visualSignature } = await import("../src/lib/careerVisual.ts");

const entry = (id, title, start, extra = {}) => ({
  id,
  title,
  kind: "project",
  start_day: start,
  end_day: start,
  raw: "",
  polished: "",
  skills: [],
  task_ids: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  ...extra,
});

const visual = {
  headline: "데이터로 문제를 푸는 학생",
  summary: "요약 <b>굵게</b>",
  highlights: [{ n: 2, why: "본선 진출" }, { n: 9, why: "없는 번호" }],
  items: [{ n: 1, line: "앱 단독 개발 중" }, { n: 2, line: "해커톤 장려상" }],
  skill_groups: [{ name: "개발", skills: ["React", "Next.js"] }],
};

test("보내는 순서는 최근 것부터, 글은 다듬은 글 먼저·600자까지, 지운 기록은 빼기", () => {
  const list = [
    entry("a", "옛날 것", "2024-03-01", { raw: "원문" }),
    entry("b", "최근 것", "2026-09-20", { raw: "원문", polished: "다듬은 글\n- 한 줄" }),
    entry("c", "지운 것", "2026-10-01", { deleted_at: "2026-10-02T00:00:00Z" }),
    entry("d", "긴 것", "2025-01-01", { raw: "가".repeat(900) }),
    entry("e", "   ", "2026-10-05"), // 제목 없음 — 서버도 빼므로 번호가 어긋나지 않게 여기서도 뺀다
  ];
  const ordered = visualOrder(list);
  assert.deepEqual(ordered.map((e) => e.id), ["b", "d", "a"]);
  const input = visualInput(ordered);
  assert.equal(input[0].text, "다듬은 글\n- 한 줄");
  assert.equal(input[1].text.length, 600);
  assert.equal(visualSignature(ordered), "b@2026-01-01T00:00:00Z|d@2026-01-01T00:00:00Z|a@2026-01-01T00:00:00Z");
});

for (const theme of ["resume", "portfolio"]) {
  test(`${theme} — 모든 기록·대표 경험·기술이 들어가고, 글자는 이스케이프, CSP 로 잠금`, () => {
    const ordered = [
      entry("a", "일정 앱 <script>alert(1)</script>", "2026-09-20", { skills: ["Next.js"], polished: "혼자 개발\n- AI 로 캡처를 일정으로" }),
      entry("b", "교내 해커톤", "2025-11-14", { kind: "award" }),
      null, // 만든 뒤 지운 기록
      entry("n", "새로 쓴 기록", "2026-10-01", { raw: "AI 한 줄 없이 원문 첫 줄" }),
    ];
    const html = renderCareerHtml(visual, ordered, theme, { name: "홍길동 & 친구", made: "2026.10.20" });
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes(VISUAL_CSP));
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("일정 앱 &lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(html.includes("요약 &lt;b&gt;굵게&lt;/b&gt;"));
    assert.ok(html.includes("홍길동 &amp; 친구"));
    for (const t of ["교내 해커톤", "새로 쓴 기록", "AI 한 줄 없이 원문 첫 줄", "앱 단독 개발 중", "본선 진출", "React", "2026.10.20"]) assert.ok(html.includes(t), t);
    assert.ok(!html.includes("없는 번호"));
  });
}

test("AI HTML 잠그기 — head 맨 앞에 CSP, head 가 없어도", () => {
  const a = lockHtml('<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>b{}</style></head><body>x</body></html>');
  assert.ok(a.indexOf("Content-Security-Policy") < a.indexOf('charset="utf-8"'));
  const b = lockHtml("<html><body>x</body></html>");
  assert.ok(b.includes("<html><head><meta http-equiv=\"Content-Security-Policy\""));
  const c = lockHtml("<p>조각</p>");
  assert.ok(c.startsWith("<!doctype html>") && c.includes(VISUAL_CSP) && c.includes("<p>조각</p>"));
});
