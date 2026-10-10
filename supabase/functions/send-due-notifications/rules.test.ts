// deno test send-due-notifications/rules.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { badgeCounts, skipEndedOverdue } from "./rules.ts";

const now = Date.parse("2026-10-09T05:00:00Z"); // 서울 14:00
const at = (h: string) => `2026-10-09T${h}:00+09:00`;

Deno.test("끝난 일정의 미시작 알림은 안 보낸다", () => {
  assertEquals(skipEndedOverdue("overdue", { ends_at: at("13:50") }, now), true);
  assertEquals(skipEndedOverdue("overdue", { ends_at: at("14:30") }, now), false);
  assertEquals(skipEndedOverdue("start", { ends_at: at("13:50") }, now), false);
});

Deno.test("배지 = 시간 안의 미시작 강제 일정 + 끝났는데 체크 안 한 일정(7일)", () => {
  const u = "u1";
  const rows = [
    { user_id: u, strict: true, starts_at: at("13:30"), ends_at: at("14:30") }, // 시간 안 미시작(유예 지남) → 1
    { user_id: u, strict: false, starts_at: at("13:30"), ends_at: at("14:30") }, // 강제 아님, 시간 안 → 0
    { user_id: u, strict: true, starts_at: at("13:58"), ends_at: at("15:00") }, // 유예 안 → 0
    { user_id: u, strict: false, starts_at: at("10:00"), ends_at: at("11:00") }, // 끝남(강제 아니어도) → 1
    { user_id: u, strict: true, starts_at: "2026-09-30T10:00:00+09:00", ends_at: "2026-09-30T11:00:00+09:00" }, // 7일 넘음 → 0
  ];
  assertEquals(badgeCounts(rows, now, () => 5).get(u), 2);
});
