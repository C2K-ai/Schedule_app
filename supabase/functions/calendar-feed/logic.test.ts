// deno test calendar-feed/logic.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildIcs, esc, fold, localDate, TOKEN_RE, utc, validTz, type FeedTask } from "./logic.ts";

const t = (o: Partial<FeedTask>): FeedTask => ({
  id: "11111111-0000-4000-8000-000000000001",
  title: "치과",
  notes: null,
  starts_at: "2026-10-10T05:00:00.000Z",
  ends_at: "2026-10-10T06:00:00.000Z",
  schedule: "timed",
  status: "planned",
  updated_at: "2026-10-09T00:00:00.000Z",
  ...o,
});
const now = new Date("2026-10-10T00:00:00Z");

Deno.test("시각 일정은 UTC, 날짜만은 그 사람 시간대의 종일, 건너뛴 건 빠지고 끝낸 건 ✓", () => {
  const ics = buildIcs(
    [
      t({}),
      // 서울 10/12 0시 = UTC 10/11 15시
      t({ id: "d", title: "보고서 마감", schedule: "day", starts_at: "2026-10-11T15:00:00.000Z", ends_at: "2026-10-12T15:00:00.000Z" }),
      t({ id: "s", title: "건너뜀", status: "skipped" }),
      t({ id: "x", title: "끝냄", status: "done" }),
      t({ id: "n", title: "날짜 없음", schedule: "someday" }),
    ],
    "Asia/Seoul",
    now,
  );
  assert(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert(ics.includes("DTSTART:20261010T050000Z\r\nDTEND:20261010T060000Z"));
  assert(ics.includes("DTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261013"));
  assert(!ics.includes("건너뜀") && !ics.includes("날짜 없음"));
  assert(ics.includes("SUMMARY:✓ 끝냄"));
  assertEquals(ics.split("BEGIN:VEVENT").length - 1, 3);
});

Deno.test("이스케이프·줄 접기(75바이트, 한글 안 쪼갬)", () => {
  assertEquals(esc("a,b;c\\d\ne"), "a\\,b\;c\\\\d\\ne");
  const long = `SUMMARY:${"가".repeat(60)}`;
  const folded = fold(long);
  const enc = new TextEncoder();
  for (const l of folded.split("\r\n")) assert(enc.encode(l).length <= 75, l);
  assertEquals(folded.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join(""), long);
});

Deno.test("날짜·시간대·토큰 모양", () => {
  assertEquals(utc("2026-01-02T03:04:05.678Z"), "20260102T030405Z");
  assertEquals(localDate("2026-10-11T15:30:00Z", "Asia/Seoul"), "20261012");
  assert(validTz("Asia/Seoul") && !validTz("Mars/Base") && !validTz(null));
  assert(TOKEN_RE.test("a".repeat(43)) && !TOKEN_RE.test("short") && !TOKEN_RE.test("a".repeat(42) + "!"));
});
