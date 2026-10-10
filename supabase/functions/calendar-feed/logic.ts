// 구글 캘린더 구독(ICS) 만들기 — index.ts 와 테스트가 같이 쓴다

export interface FeedTask {
  id: string;
  title: string;
  notes: string | null;
  starts_at: string;
  ends_at: string;
  schedule: string;
  status: string;
  updated_at: string | null;
}

/** 표 calendar_feeds 의 토큰 모양(DB CHECK 와 같게) */
export const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

/** ICS 글자 이스케이프: \ ; , 줄바꿈 */
export const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** 2026-10-10T05:00:00.000Z → 20261010T050000Z */
export const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** 그 시각의 tz 기준 날짜 YYYYMMDD */
export function localDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)).replace(/-/g, "");
}

const nextDay = (d: string) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + 1)).toISOString().slice(0, 10).replace(/-/g, "");

export function validTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 한 줄을 75바이트(UTF-8)마다 접는다(이어지는 줄은 공백 하나로 시작) — 한글 글자 중간에서 자르지 않는다 */
export function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let n = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > 75) {
      out.push(cur);
      cur = " ";
      n = 1;
    }
    cur += ch;
    n += b;
  }
  out.push(cur);
  return out.join("\r\n");
}

/** 일정 → ICS. 시각 일정은 UTC 시각, 날짜만은 종일(그 사람 시간대의 날짜). 건너뛴 건 빼고, 끝낸 건 제목 앞에 ✓ */
export function buildIcs(tasks: FeedTask[], tz: string, now: Date): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DREAM//Planner//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:DREAM",
    `X-WR-TIMEZONE:${tz}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const t of tasks) {
    if (t.status === "skipped" || (t.schedule !== "timed" && t.schedule !== "day")) continue;
    const title = `${t.status === "done" ? "✓ " : ""}${(t.title || "").trim() || "일정"}`;
    lines.push("BEGIN:VEVENT", `UID:${t.id}@dream`, `DTSTAMP:${utc(t.updated_at || now.toISOString())}`);
    if (t.schedule === "day") {
      const d = localDate(t.starts_at, tz);
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${nextDay(d)}`);
    } else {
      lines.push(`DTSTART:${utc(t.starts_at)}`, `DTEND:${utc(t.ends_at)}`);
    }
    lines.push(`SUMMARY:${esc(title)}`);
    const notes = (t.notes ?? "").trim();
    if (notes) lines.push(`DESCRIPTION:${esc(notes.slice(0, 1000))}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
