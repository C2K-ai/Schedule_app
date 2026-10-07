// parse-schedule 의 순수 로직(스키마·프롬프트·결과 정리) — index.ts 와 테스트가 같이 쓴다

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export interface RawItem {
  title: string;
  kind: "timed" | "day" | "someday";
  date: string | null;
  start: string | null;
  duration_min: number | null;
  repeat_days: number[];
  category: string | null;
  starred: boolean;
  reminders_min: number[] | null;
  notes: string | null;
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "reply"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "kind", "date", "start", "duration_min", "repeat_days", "category", "starred", "reminders_min", "notes"],
        properties: {
          title: { type: "string" },
          kind: { type: "string", enum: ["timed", "day", "someday"] },
          date: nullable({ type: "string", format: "date" }),
          start: nullable({ type: "string" }),
          duration_min: nullable({ type: "integer" }),
          repeat_days: { type: "array", items: { type: "integer" } },
          category: nullable({ type: "string" }),
          starred: { type: "boolean" },
          reminders_min: nullable({ type: "array", items: { type: "integer" } }),
          notes: nullable({ type: "string" }),
        },
      },
    },
    reply: { type: "string" },
  },
};

export const SYSTEM = `You turn a Korean user's spoken or hastily typed words into schedule items for their personal planner app.
The text usually comes from speech recognition, so expect missing spaces, filler words ("어", "음", "그니까"), homophone mistakes, run-on sentences and self-corrections ("3시, 아니 4시"). Work out what they actually meant — the user wants an assistant that understands sloppy speech. When they correct themselves, keep only the final version.

Return every distinct thing they want to do as one item. Never invent items they did not mention.

Fields:
- title: short, natural Korean task name (e.g. "치과 예약", "보고서 제출"). Drop the date/time words from the title.
- kind: "timed" when a clock time is given or clearly implied; "day" when only a day is given; "someday" when no day at all ("언젠가", "나중에", "시간 날 때", or nothing said about when).
- date: YYYY-MM-DD for timed/day items, null for someday. Resolve relative words using the calendar table in the user message — do not do date arithmetic yourself. 이번 주 = the Monday–Sunday week containing today; 다음 주 = the following Monday–Sunday. A bare weekday ("금요일에") means the next such day from today (today itself if it is that weekday and the time has not passed). "주말" = the coming Saturday. "~까지" deadlines go on that day.
- start: "HH:MM" 24-hour for timed items, else null. Korean hours without 오전/오후: 1–6 → afternoon (13–18), 7–11 → morning unless context says evening ("저녁 7시" → 19:00), 12 → 12:00. 아침 ≈ 08:00, 점심 ≈ 12:00, 오후 ≈ 15:00, 저녁 ≈ 19:00, 밤 ≈ 21:00, 새벽 ≈ 06:00 when no exact time. "반" = :30. If a timed item has no day and that time has already passed today, use tomorrow.
- duration_min: minutes if they say how long ("한 시간", "30분 동안", "3시부터 5시까지" → 120), else null.
- repeat_days: for repeating routines ("매일", "평일마다", "주말마다", "매주 월수금") the weekdays as numbers 0=일 1=월 2=화 3=수 4=목 5=금 6=토; empty array otherwise. A repeating item must be "timed" — if no time is said, use a sensible one (매일 아침 → 08:00, otherwise 09:00) and set date to its first occurrence.
- category: exactly one of the category names listed in the user message when the item clearly fits one (생일 → a birthday category, 사고 싶은 것 → a wishlist category), else null.
- starred: true only when they stress importance ("중요", "꼭", "절대 잊으면 안 돼", "별표").
- reminders_min: minutes-before reminders only if they ask ("30분 전에 알려줘" → [30], "정각에" → [0]); null otherwise.
- notes: extra details worth keeping (place, things to bring, people) that do not belong in the title; else null.

reply: one short, friendly Korean sentence summarising what you understood (e.g. "내일 오후 3시 치과, 금요일 보고서 마감 — 2개 찾았어요."). If nothing schedulable was said, return no items and use reply to say so briefly.`;

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isTime = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** 오늘부터 3주치 '날짜 = 요일' 표 — 모델이 날짜 계산을 직접 하지 않게 */
export function calendarTable(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const rows: string[] = [];
  for (let i = 0; i < 21; i++) {
    const t = new Date(base + i * 86400000);
    const key = t.toISOString().slice(0, 10);
    const label = i === 0 ? " (오늘)" : i === 1 ? " (내일)" : i === 2 ? " (모레)" : i === 3 ? " (글피)" : "";
    rows.push(`${key} ${WEEKDAYS[t.getUTCDay()]}${label}`);
  }
  return rows.join("\n");
}

export function clean(raw: RawItem, categories: { id: string; name: string }[], today: string) {
  const title = String(raw.title ?? "").trim().slice(0, 120);
  if (!title) return null;
  let kind = raw.kind;
  const repeat = [...new Set((raw.repeat_days ?? []).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort();
  let start = isTime(raw.start) ? raw.start : null;
  if (repeat.length) {
    kind = "timed";
    start ??= "09:00";
  }
  if (kind === "timed" && !start) kind = "day";
  let date = isDate(raw.date) ? raw.date : null;
  if (kind !== "someday" && !date) date = today;
  if (kind === "someday") {
    date = null;
    start = null;
  }
  if (kind === "day") start = null;
  const dur = Number.isInteger(raw.duration_min) ? Math.min(720, Math.max(5, raw.duration_min!)) : null;
  const cat = raw.category ? categories.find((c) => c.name.trim() === raw.category!.trim()) : undefined;
  const reminders = Array.isArray(raw.reminders_min)
    ? [...new Set(raw.reminders_min.filter((x) => Number.isInteger(x) && x >= 0 && x <= 1440))].sort((a, b) => b - a)
    : null;
  return {
    title,
    kind,
    date,
    start,
    duration_min: dur,
    repeat_days: repeat,
    category_id: cat?.id ?? null,
    starred: Boolean(raw.starred),
    reminders_min: reminders && reminders.length ? reminders : null,
    notes: raw.notes?.trim() ? raw.notes.trim().slice(0, 500) : null,
  };
}

