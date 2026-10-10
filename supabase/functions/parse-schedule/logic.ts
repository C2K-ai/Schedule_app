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
Typed input is often terse, like "29일 1시부터 2시 치과" or "금 3시 미팅" — handle it the same way.
The text usually comes from speech recognition, so expect missing spaces, filler words ("어", "음", "그니까"), homophone mistakes, run-on sentences and self-corrections ("3시, 아니 4시"). Work out what they actually meant — the user wants an assistant that understands sloppy speech. When they correct themselves, keep only the final version.

Sometimes the input is a photo instead of (or along with) text — a class timetable, a notice, a poster, an invitation, an appointment card or a chat screenshot. Read every schedule shown in it the same way; if the user also typed text, it says which parts they care about. A weekly timetable (weekday columns and time rows) becomes repeating items: one item per subject and weekly time slot, with repeat_days set. Skip events in the photo that are clearly already over unless the user asks for them.

Return every distinct thing they want to do as one item. Never invent items they did not mention or that are not in the photo.

Fields:
- title: short, natural Korean task name (e.g. "치과 예약", "보고서 제출"). Drop the date/time words from the title. If they give only a date/time with no task name at all (e.g. "29일 1시부터 2시"), still return ONE item with title "일정".
- kind: "timed" when a clock time is given or clearly implied; "day" when only a day is given; "someday" when no day at all ("언젠가", "나중에", "시간 날 때", or nothing said about when).
- date: YYYY-MM-DD for timed/day items, null for someday. Resolve relative words using the calendar table in the user message — do not do date arithmetic yourself. 이번 주 = the Monday–Sunday week containing today; 다음 주 = the following Monday–Sunday. A bare weekday ("금요일에", "금요일까지") means the nearest such day from today — usually the one marked 이번 주, which can be tomorrow (today itself if it is that weekday and the time has not passed); use 다음 주 only when they say 다음 주 or this week's one has already passed. "주말" = the coming Saturday. "~까지" deadlines go on that day.
  A bare day of the month ("29일", "29일에", "다음 달 3일") means the next date with that day number from today: this month if it has not passed yet, otherwise next month — pick that exact row from the calendar table (it covers six weeks). "N월 N일" means that date this year (next year only if it is more than a month in the past). Never shift a date the user stated explicitly.
- start: "HH:MM" 24-hour for timed items, else null. Korean hours without 오전/오후: 1–6 → afternoon (13–18), 7–11 → morning unless context says evening ("저녁 7시" → 19:00), 12 → 12:00. 아침 ≈ 08:00, 점심 ≈ 12:00, 오후 ≈ 15:00, 저녁 ≈ 19:00, 밤 ≈ 21:00, 새벽 ≈ 06:00 when no exact time. "반" = :30. If a timed item has no day and that time has already passed today, use tomorrow.
- duration_min: minutes if they say how long ("한 시간", "30분 동안", "3시부터 5시까지" → 120), else null.
- repeat_days: for repeating routines ("매일", "평일마다", "주말마다", "매주 월수금") the weekdays as numbers 0=일 1=월 2=화 3=수 4=목 5=금 6=토; empty array otherwise. A repeating item must be "timed" — if no time is said, use a sensible one (매일 아침 → 08:00, otherwise 09:00) and set date to its first occurrence.
- category: exactly one of the category names listed in the user message when the item clearly fits one (생일 → a birthday category, 사고 싶은 것 → a wishlist category), else null.
- starred: true only when they stress importance ("중요", "꼭", "절대 잊으면 안 돼", "별표").
- reminders_min: minutes-before reminders only if they ask ("30분 전에 알려줘" → [30], "정각에" → [0]); null otherwise.
- notes: extra details worth keeping (place, things to bring, people) that do not belong in the title; else null.

reply: one short, friendly Korean sentence summarising what you understood (e.g. "내일 오후 3시 치과, 금요일 보고서 마감 — 2개 찾았어요."). If nothing schedulable was said, return no items and use reply to say so briefly.`;

/** 사진 한 장(앱이 줄여서 base64 로 보냄). 받는 꼴만 확인 — 크기 한도는 base64 글자 수 */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const MAX_IMAGE_B64 = 4_000_000; // 약 3MB — 앱은 긴 변 1568px JPEG 로 줄여 보내서 보통 0.3~0.6MB
export function checkImage(x: unknown): { media_type: ImageType; data: string } | "bad_image" | "image_too_big" | null {
  if (x === undefined || x === null) return null;
  const o = x as { media_type?: unknown; data?: unknown };
  if (typeof o !== "object" || typeof o.data !== "string" || !IMAGE_TYPES.includes(o.media_type as ImageType)) return "bad_image";
  if (o.data.length > MAX_IMAGE_B64) return "image_too_big";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(o.data)) return "bad_image";
  return { media_type: o.media_type as ImageType, data: o.data };
}

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isTime = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** 오늘부터 6주치 '날짜 = 요일 (이번 주/다음 주)' 표 — 모델이 날짜 계산을 직접 하지 않게("29일"처럼 먼 날짜도 표에서 고른다) */
export function calendarTable(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const sinceMonday = (new Date(base).getUTCDay() + 6) % 7; // 오늘이 이번 주 월요일에서 며칠째
  const WEEK = ["이번 주", "다음 주", "다다음 주", "3주 뒤", "4주 뒤", "5주 뒤", "6주 뒤"];
  const rows: string[] = [];
  for (let i = 0; i < 42; i++) {
    const t = new Date(base + i * 86400000);
    const key = t.toISOString().slice(0, 10);
    const near = i === 0 ? "오늘" : i === 1 ? "내일" : i === 2 ? "모레" : i === 3 ? "글피" : "";
    const week = WEEK[Math.floor((sinceMonday + i) / 7)];
    rows.push(`${key} ${WEEKDAYS[t.getUTCDay()]} (${near ? `${near} · ` : ""}${week})`);
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

