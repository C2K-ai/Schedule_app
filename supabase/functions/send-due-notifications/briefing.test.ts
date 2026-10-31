// deno test send-due-notifications/briefing.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { briefingText, retryable, timetableToday, type BriefTask } from "./briefing.ts";

const t = (title: string, startsAt: string, extra: Partial<BriefTask> = {}): BriefTask => ({
  title,
  status: "planned",
  starts_at: startsAt,
  schedule: "timed",
  strict: true,
  ...extra,
});

Deno.test("오늘 일정을 서울 시각 순서로 · 시간 미정은 이름으로 · 끝낸 일은 빼고 · 미시작", () => {
  const r = briefingText(
    [
      t("치과", "2026-10-08T06:00:00Z"),
      t("보고서", "2026-10-07T15:00:00Z", { schedule: "day" }),
      t("아침 운동", "2026-10-07T22:00:00Z"),
      t("끝낸 일", "2026-10-07T23:00:00Z", { status: "done" }),
    ],
    "Asia/Seoul",
    2,
  );
  assertEquals(r.title, "☀ 오늘 일정 3개");
  assertEquals(r.body, "07:00 아침 운동 · 15:00 치과\n시간 미정 · 보고서\n미시작 2건");
});

Deno.test("시간표 수업·알바도 오늘 요일·학기 기간이면 시각 순서에 끼운다", () => {
  // 2026-10-08 = 목요일(4)
  const classes = timetableToday(
    [
      { title: "자료구조", start_time: "09:00", days: [2, 4], start_day: "2026-09-01", end_day: "2026-12-21" },
      { title: "지난 학기", start_time: "10:00", days: [4], start_day: "2026-03-02", end_day: "2026-06-21" },
      { title: "다른 요일", start_time: "11:00", days: [1], start_day: null, end_day: null },
      { title: "시각 없음", start_time: null, days: [4], start_day: null, end_day: null },
      { title: "알바", start_time: "18:00", days: [4], start_day: null, end_day: null },
    ],
    "2026-10-08",
  );
  assertEquals(classes.map((c) => c.title), ["자료구조", "알바"]);
  const r = briefingText([t("치과", "2026-10-08T06:00:00Z"), ...classes], "Asia/Seoul", 0);
  assertEquals(r.body, "09:00 자료구조 · 15:00 치과 · 18:00 알바");
});

Deno.test("끝났는데 체크 안 한 일정은 '확인할 일정'으로(실패 아님)", () => {
  const r = briefingText([t("치과", "2026-10-08T06:00:00Z")], "Asia/Seoul", 0, 3);
  assertEquals(r.body, "15:00 치과\n했는지 확인할 일정 3건");
});

Deno.test("일정이 없으면 그렇게 말한다", () => {
  assertEquals(briefingText([], "Asia/Seoul", 0), { title: "☀ 좋은 아침이에요", body: "오늘 잡힌 일정이 없어요" });
  assertEquals(briefingText([], "Asia/Seoul", 0, 2).body, "오늘 잡힌 일정이 없어요\n했는지 확인할 일정 2건");
});

Deno.test("많으면 8개까지 이름 · 시간 미정 자리는 남기고 · 나머지는 '외 n개' · 긴 제목은 줄임", () => {
  const many = Array.from({ length: 10 }, (_, i) => t(`일정${i}`, `2026-10-08T0${i}:00:00Z`));
  const r = briefingText(
    [...many, t("장보기", "2026-10-07T15:00:00Z", { schedule: "day" }), t("가".repeat(25), "2026-10-07T15:00:00Z", { schedule: "day" })],
    "Asia/Seoul",
    0,
  );
  const [timedLine, noTimeLine, restLine] = r.body.split("\n");
  assertEquals(timedLine.split(" · ").length, 6);
  assertEquals(noTimeLine, `시간 미정 · 장보기, ${"가".repeat(19)}…`);
  assertEquals(restLine, "외 4개");
  assertEquals(r.title, "☀ 오늘 일정 12개");
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
