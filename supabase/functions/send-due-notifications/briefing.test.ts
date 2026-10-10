// deno test send-due-notifications/briefing.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { briefingText, retryable, type BriefTask } from "./briefing.ts";

const now = Date.parse("2026-10-08T01:00:00Z"); // 서울 10:00
const t = (title: string, startsAt: string, extra: Partial<BriefTask> = {}): BriefTask => ({
  title,
  status: "planned",
  starts_at: startsAt,
  schedule: "timed",
  strict: true,
  ...extra,
});

Deno.test("할 일 수 · 다음 일정(서울 시각) · 미시작", () => {
  const r = briefingText(
    [
      t("치과", "2026-10-08T06:00:00Z"),
      t("보고서", "2026-10-07T15:00:00Z", { schedule: "day" }),
      t("아침 운동", "2026-10-07T22:00:00Z"),
      t("끝낸 일", "2026-10-07T23:00:00Z", { status: "done" }),
    ],
    now,
    "Asia/Seoul",
    5,
    2,
  );
  assertEquals(r.body, "오늘 할 일 3개 · 다음 15:00 치과 · 미시작 2건");
});

Deno.test("유예 시간 안의 일정은 '다음'으로 보인다", () => {
  const r = briefingText([t("방금 시작", "2026-10-08T00:55:00Z")], now, "Asia/Seoul", 10, 0);
  assertEquals(r.body, "오늘 할 일 1개 · 다음 09:55 방금 시작");
});

Deno.test("끝났는데 체크 안 한 일정은 '확인할 일정'으로(실패 아님)", () => {
  const r = briefingText([t("치과", "2026-10-08T06:00:00Z")], now, "Asia/Seoul", 5, 0, 3);
  assertEquals(r.body, "오늘 할 일 1개 · 다음 15:00 치과 · 했는지 확인할 일정 3건");
});

Deno.test("할 일이 없으면 그렇게 말한다", () => {
  assertEquals(briefingText([], now, "Asia/Seoul", 5, 0).body, "오늘 잡힌 할 일이 없어요");
});

Deno.test("다시 보낼 오류만 재시도", () => {
  assertEquals([retryable("? fetch failed"), retryable("429 too many"), retryable("503 down"), retryable("403 forbidden"), retryable("400 bad")], [
    true,
    true,
    true,
    false,
    false,
  ]);
});
