// deno test send-due-notifications/briefing.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { briefingText, type BriefTask } from "./briefing.ts";

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
  );
  assertEquals(r.body, "오늘 할 일 3개 · 다음 15:00 치과 · 미시작 1건");
});

Deno.test("할 일이 없으면 그렇게 말한다", () => {
  assertEquals(briefingText([], now, "Asia/Seoul").body, "오늘 잡힌 할 일이 없어요");
});
