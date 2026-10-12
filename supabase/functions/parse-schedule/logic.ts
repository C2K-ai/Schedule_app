// parse-schedule 의 순수 로직(스키마·프롬프트·결과 정리) — index.ts 와 테스트가 같이 쓴다

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export interface RawItem {
  title: string;
  kind: "timed" | "day" | "someday" | "mark";
  date: string | null;
  start: string | null;
  duration_min: number | null;
  repeat_days: number[];
  /** 기간이 있는 반복의 마지막 날 */
  repeat_until?: string | null;
  category: string | null;
  starred: boolean;
  reminders_min: number[] | null;
  notes: string | null;
  /** 표시(mark): 여러 날이면 마지막 날 */
  end_date?: string | null;
  /** 표시(mark): 매년 같은 날(생일·기념일) */
  yearly?: boolean;
  /** 표시(mark): 그림 하나 */
  emoji?: string | null;
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "remove", "reply"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "kind", "date", "start", "duration_min", "repeat_days", "repeat_until", "category", "starred", "reminders_min", "notes", "end_date", "yearly", "emoji"],
        properties: {
          title: { type: "string" },
          kind: { type: "string", enum: ["timed", "day", "someday", "mark"] },
          date: nullable({ type: "string", format: "date" }),
          start: nullable({ type: "string" }),
          duration_min: nullable({ type: "integer" }),
          repeat_days: { type: "array", items: { type: "integer" } },
          repeat_until: nullable({ type: "string", format: "date" }),
          category: nullable({ type: "string" }),
          starred: { type: "boolean" },
          reminders_min: nullable({ type: "array", items: { type: "integer" } }),
          notes: nullable({ type: "string" }),
          end_date: nullable({ type: "string", format: "date" }),
          yearly: { type: "boolean" },
          emoji: nullable({ type: "string" }),
        },
      },
    },
    // 지우거나 옮길 기존 일정의 ref(사용자 메시지의 '기존 일정' 목록에서) — 없으면 빈 배열
    remove: { type: "array", items: { type: "string" } },
    reply: { type: "string" },
  },
};

export const SYSTEM = `You turn a Korean user's spoken or hastily typed words into schedule items for their personal planner app.
Typed input is often terse, like "29일 1시부터 2시 치과" or "금 3시 미팅" — handle it the same way.
The text usually comes from speech recognition, so expect missing spaces, filler words ("어", "음", "그니까"), homophone mistakes, run-on sentences and self-corrections ("3시, 아니 4시"). Work out what they actually meant — the user wants an assistant that understands sloppy speech. When they correct themselves, keep only the final version.

Sometimes the input is a photo instead of (or along with) text — a chat screenshot (카카오톡 etc.), a notice, a poster, an invitation or an appointment card. Read every schedule shown in it the same way; if the user also typed text, it says which parts they care about. In a chat screenshot, take the plans people agreed on (date, time, place, what) — not every message: the last agreed time wins ("3시 어때?" → "4시로 하자" → 16:00), and a short answer ("ㅇㅇ 금요일까지") confirms the earlier message with its full wording ("다음 주 금요일까지 과제 내자" → next week's Friday, not this week's). Relative words in a chat (내일, 이번 주 토요일, 다음 주) count from the day the message was sent when the screenshot shows it (a date line like "2026년 10월 12일 월요일"), otherwise from today. A "~까지" deadline is a "day" item on that date, never "someday". Skip events in the photo that are clearly already over unless the user asks for them.
A class timetable photo (weekday columns with hour or 교시 rows — 에브리타임, a school portal, a printed timetable, a 학원 timetable) is NOT added here: the app keeps class timetables apart from the planner. For such a photo return no items and reply exactly: "시간표 사진 같아요 — 사진 아래 '시간표에 넣기'를 눌러 시간표에 넣어 주세요."

Return every distinct thing they want to do as one item. Never invent items they did not mention or that are not in the photo.

Fields:
- title: short, natural Korean task name (e.g. "치과 예약", "보고서 제출"). Drop the date/time words from the title. If they give only a date/time with no task name at all (e.g. "29일 1시부터 2시"), still return ONE item with title "일정".
- kind: "timed" when a clock time is given or clearly implied; "day" when only a day is given; "someday" when no day at all ("언젠가", "나중에", "시간 날 때", or nothing said about when).
  "mark" for a day to remember rather than something to do — a birthday ("내일 내 생일", "엄마 생신 15일"), an anniversary or 기념일, a holiday, a trip or vacation period, an exam day or a D-day without a clock time ("다음 주 수요일 토익 시험", "20일부터 23일까지 제주 여행"). A mark has no time: start null, duration_min null, repeat_days [], reminders_min null. If they give a clock time for it ("토익 9시"), it is a "timed" item instead. A thing they must do on that day ("생일 선물 사기") is a normal item, not a mark.
- date: YYYY-MM-DD for timed/day items, null for someday. Resolve relative words using the calendar table in the user message — do not do date arithmetic yourself. 이번 주 = the Monday–Sunday week containing today; 다음 주 = the following Monday–Sunday. A bare weekday ("금요일에", "금요일까지") means the nearest such day from today — usually the one marked 이번 주, which can be tomorrow (today itself if it is that weekday and the time has not passed); use 다음 주 only when they say 다음 주 or this week's one has already passed. "주말" = the coming Saturday. "~까지" deadlines go on that day.
  A bare day of the month ("29일", "29일에", "다음 달 3일") means the next date with that day number from today: this month if it has not passed yet, otherwise next month — pick that exact row from the calendar table (it covers six weeks). "N월 N일" means that date this year (next year only if it is more than a month in the past). Never shift a date the user stated explicitly.
- start: "HH:MM" 24-hour for timed items, else null. Korean hours without 오전/오후: 1–6 → afternoon (13–18), 7–11 → morning unless context says evening ("저녁 7시" → 19:00), 12 → 12:00. 아침 ≈ 08:00, 점심 ≈ 12:00, 오후 ≈ 15:00, 저녁 ≈ 19:00, 밤 ≈ 21:00, 새벽 ≈ 06:00 when no exact time. "반" = :30. If a timed item has no day and that time has already passed today, use tomorrow.
- duration_min: minutes if they say how long ("한 시간", "30분 동안", "3시부터 5시까지" → 120), else null.
- repeat_days: for repeating routines ("매일", "평일마다", "주말마다", "매주 월수금") the weekdays as numbers 0=일 1=월 2=화 3=수 4=목 5=금 6=토; empty array otherwise. A repeating item must be "timed" — if no time is said, use a sensible one (매일 아침 → 08:00, otherwise 09:00) and set date to its first occurrence.
- repeat_until: only for repeating items whose period is limited — the LAST date (YYYY-MM-DD) they should repeat: "이번 달 매일" → the last day of this month, "이번 주 매일" → this Sunday, "11월까지" → 11월 30일, "2주 동안" → first date + 13 days, "시험(10월 24일) 전까지" → the day before. Pick it from the calendar table when it is in range. Null when no end is said ("매일", "평일마다" with no period) and for non-repeating items. "이번 달 매일 …" is ONE repeating item with repeat_days [0,1,2,3,4,5,6] and repeat_until — never list the days as separate items.
- category: exactly one of the category names listed in the user message when the item clearly fits one (사고 싶은 것 → a wishlist category), else null. Always null for marks.
- starred: true only when they stress importance ("중요", "꼭", "절대 잊으면 안 돼", "별표").
- reminders_min: minutes-before reminders only if they ask ("30분 전에 알려줘" → [30], "정각에" → [0]); null otherwise.
- notes: extra details worth keeping (place, things to bring, people) that do not belong in the title; else null.
- end_date: marks only — the last day of a mark that spans several days ("20일부터 23일까지 여행" → the 23rd), else null.
- yearly: marks only — true for things that come back every year (birthdays, 생신, wedding or relationship anniversaries, "매년"); false otherwise and for all non-marks. A yearly mark is one day (end_date null) and keeps the month and day they said — for a 2월 29일 birthday use 2024-02-29 (the app shows it on Feb 28 in other years), never move it to 02-28.
- emoji: marks only — one fitting emoji: 🎂 birthday, 💍 wedding anniversary, ❤️ couple anniversary, 🎉 celebration or holiday, ✈️ trip or vacation, 📝 exam, 🏥 hospital, ⭐ anything else; null for non-marks.

Deleting and moving existing items:
The user may ask to delete or cancel things already in their planner ("치과 취소해줘", "내일 3시 회의 지워", "오늘 일정 다 빼줘", "운동 습관 그만할래"). Then the user message lists their existing items as lines "ref | when | title".
- Put the ref of every existing item they want gone in "remove". Do NOT also return a new item for it.
- Match by meaning of the title (synonyms, short forms and speech-recognition slips are fine) and by the day/time they mention. When they name a day or time, only take items on that day/time. "다", "전부", "모두" with a day means every item listed on that day.
- To move or reschedule an existing item ("치과 4시로 옮겨줘", "회의 내일로 미뤄"), put its ref in "remove" AND return the new version as an item, keeping its title and length (duration_min = its current length) unless they change them.
- Refs starting with "h" are repeating routines. Remove one only when they want to stop the routine itself ("매일 운동 그만할래"). To cancel just one day ("오늘 운동은 빼줘"), remove that day's "t" item instead.
- Refs starting with "m" are marks (days to remember: birthdays, trips, exams). To move a mark ("제주 여행 25일부터로 바꿔줘"), remove its ref AND return the new version as a "mark" item, keeping its title, emoji, yearly and number of days unless they change them. Never return a second copy of a mark without removing the old one.
- If nothing in the list clearly matches, leave "remove" empty and say so in reply. Never remove anything they did not ask to remove. If no existing items are listed, "remove" must be empty.

reply: one short, friendly Korean sentence summarising what you understood (e.g. "내일 오후 3시 치과, 금요일 보고서 마감 — 2개 찾았어요.", "내일 15:00 치과를 지울게요."). If nothing schedulable was said, return no items and use reply to say so briefly.`;

/** 지우기·옮기기에 쓰는 기존 일정 한 줄 — ref 는 t1·t2…(일정), h1…(반복 습관), m1…(표시) */
export interface ExistingItem {
  ref: string;
  when: string;
  title: string;
}

/** 앱이 보낸 기존 일정 목록 검사 — 꼴이 맞는 것만, 최대 300개 */
export function checkExisting(x: unknown): ExistingItem[] {
  if (!Array.isArray(x)) return [];
  const out: ExistingItem[] = [];
  const seen = new Set<string>();
  for (const e of x) {
    const o = e as { ref?: unknown; when?: unknown; title?: unknown };
    if (!o || typeof o.ref !== "string" || !/^[thm]\d{1,4}$/.test(o.ref) || seen.has(o.ref)) continue;
    if (typeof o.title !== "string" || typeof o.when !== "string") continue;
    const clip = (s: string, n: number) => s.replace(/[\r\n|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
    seen.add(o.ref);
    out.push({ ref: o.ref, when: clip(o.when, 40), title: clip(o.title, 120) || "(제목 없음)" });
    if (out.length >= 300) break;
  }
  return out;
}

/** 모델이 고른 ref 중 목록에 있는 것만(중복 없이) */
export function cleanRemove(raw: unknown, existing: ExistingItem[]): string[] {
  if (!Array.isArray(raw)) return [];
  const ok = new Set(existing.map((e) => e.ref));
  return [...new Set(raw.filter((r): r is string => typeof r === "string" && ok.has(r)))];
}

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

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * 모델이 적은 날짜를 실제 있는 날짜로 — 꼴만 맞는 "2026-11-31"·"2027-02-29" 는 DB date 칸이 거절해 동기화가 통째로 막힌다.
 * 달 말일을 넘으면 그 달 말일로(11/31 → 11/30), 달·날이 0 이거나 꼴이 틀리면 null
 */
export function realDate(s: unknown): string | null {
  if (!isDate(s)) return null;
  const y = Number(s.slice(0, 4)),
    m = Number(s.slice(5, 7)),
    d = Number(s.slice(8, 10));
  if (y < 1000 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= last ? s : `${s.slice(0, 8)}${String(last).padStart(2, "0")}`;
}

/** 매년 표시의 2월 29일 — 윤년이 아니면 바로 앞 윤년으로(평년엔 앱이 2월 28일에 보여 준다) */
function yearlyDay(s: unknown): string | null {
  if (!isDate(s) || s.slice(5) !== "02-29") return realDate(s);
  let y = Number(s.slice(0, 4));
  if (y < 1000) return null;
  while (!leap(y)) y--;
  return `${y}-02-29`;
}

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
  if (raw.kind === "mark") {
    // 표시: 날짜만(시각·반복·알림·카테고리 없음). 매년이면 하루짜리, 여러 날이면 끝 날이 시작보다 뒤일 때만
    const yearly = raw.yearly === true;
    const date = (yearly ? yearlyDay(raw.date) : realDate(raw.date)) ?? today;
    const endDay = realDate(raw.end_date);
    const end = !yearly && endDay && endDay > date ? endDay : null;
    const emoji = typeof raw.emoji === "string" && raw.emoji.trim() ? [...raw.emoji.trim()].slice(0, 2).join("").slice(0, 8) : null;
    return {
      title,
      kind: "mark" as const,
      date,
      start: null,
      duration_min: null,
      repeat_days: [],
      repeat_until: null,
      category_id: null,
      starred: false,
      reminders_min: null,
      notes: raw.notes?.trim() ? raw.notes.trim().slice(0, 500) : null,
      end_date: end,
      yearly,
      emoji,
    };
  }
  let kind = raw.kind;
  const repeat = [...new Set((raw.repeat_days ?? []).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort();
  let start = isTime(raw.start) ? raw.start : null;
  if (repeat.length) {
    kind = "timed";
    start ??= "09:00";
  }
  if (kind === "timed" && !start) kind = "day";
  let date = realDate(raw.date);
  if (kind !== "someday" && !date) date = today;
  if (kind === "someday") {
    date = null;
    start = null;
  }
  if (kind === "day") start = null;
  const dur = Number.isInteger(raw.duration_min) ? Math.min(720, Math.max(5, raw.duration_min!)) : null;
  const cat = raw.category ? categories.find((c) => c.name.trim() === raw.category!.trim()) : undefined;
  // 기간 있는 반복의 끝 — 반복일 때만, 첫날보다 앞이면 버림
  const untilDay = realDate(raw.repeat_until);
  const until = repeat.length && untilDay && date && untilDay >= date ? untilDay : null;
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
    repeat_until: until,
    category_id: cat?.id ?? null,
    starred: Boolean(raw.starred),
    reminders_min: reminders && reminders.length ? reminders : null,
    notes: raw.notes?.trim() ? raw.notes.trim().slice(0, 500) : null,
    end_date: null,
    yearly: false,
    emoji: null,
  };
}


// ───────────────────────── 시간표 사진(mode: "timetable") ─────────────────────────
// 에브리타임·학교 포털·종이 시간표·학원 시간표 사진 → 수업 목록(과목·요일·시작·끝·강의실). 학기 기간은 앱이 정해서 습관으로 저장한다.

export interface RawClass {
  /** 모델이 시각을 정하기 전에 적는 '읽은 칸'(예: "6-7교시", "10:30-11:45") — 확인용, 저장 안 함 */
  block?: string;
  title: string;
  days: number[];
  start: string;
  end: string;
  place: string | null;
}

export const TIMETABLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["classes", "reply"],
  properties: {
    classes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        // 키는 이름 순(block → days → end …)으로 나와서, block(읽은 칸)을 먼저 적고 시각을 정하게 된다
        required: ["block", "title", "days", "start", "end", "place"],
        properties: {
          block: { type: "string" },
          title: { type: "string" },
          days: { type: "array", items: { type: "integer" } },
          start: { type: "string" },
          end: { type: "string" },
          place: nullable({ type: "string" }),
        },
      },
    },
    reply: { type: "string" },
  },
};

export const TIMETABLE_SYSTEM = `You read a photo or screenshot of a weekly timetable and list every class or fixed weekly slot in it, so a planner app can repeat them every week of the semester.
It can be anything: the 에브리타임 (Everytime) app, a school portal (수강신청 확인·개인 시간표), a printed or handwritten timetable, a 학원 or lesson schedule, a part-time work schedule, or a plain list of classes.

Common layouts:
- Grid: weekday columns (월 화 수 목 금, sometimes 토 일) and time rows, one colored block per class with the course name and often the room. Hour labels are often 9 10 11 12 1 2 3 4 5 6 — after 12 they mean the afternoon (1 → 13:00, 2 → 14:00 …).
- Period (교시) grid or list: rows 1교시, 2교시 … If the image shows each 교시's clock time, use those times. If it does not, assume 1교시 starts at 09:00 and each 교시 is one hour with 50 minutes of class (n교시 = (8+n):00–(8+n):50; consecutive 교시 of one class are one block, e.g. 3–4교시 → 11:00–12:50) unless the user's text says otherwise, and say in reply that the times were guessed from 교시.
- List: lines such as "자료구조 월 10:30-11:45 공학관 301", "화목 9:00~10:15" or "월3,4 수5".

Rules:
- block: write first what you see for this class before deciding the times — for a 교시 table the exact period range the block covers, counting the rows from its top border to its bottom border ("6-7교시" for a block over the 6교시 and 7교시 rows) — the course name is usually centered in the block, so never judge the rows by where the text sits; for a time grid the hour lines its top and bottom edges sit on ("10:30-11:45"); for text, the text itself.
- One entry per course and time slot. If a course meets on several days at the same start and end time, put all those days in "days". If its times differ by day, make separate entries with the same title.
- days: 0=일 1=월 2=화 3=수 4=목 5=금 6=토 — use the column or day the class is under.
- start / end: "HH:MM" 24-hour. In a grid, read them from where the block's top and bottom edges sit against the time lines. Classes usually start and end on :00, :15, :30, :45 or :50 (e.g. 10:30–11:45, 13:00–14:50, 09:00–10:15) — pick the nearest such time. Text times in the image always win.
- title: the course name exactly as shown (no professor name, no room, no course code or section number unless it is part of the name).
- place: the room or building shown with the class ("공학관 301", "온라인", "B102"), else null.
- Include personal blocks (동아리, 알바, 학원 …) the same way. Ignore everything that is not a class: app titles and menus, buttons, ads, empty cells, credit (학점) totals, the semester name, professor names.
- If the user also typed text, follow it (e.g. which classes to skip, when 1교시 starts).
- If the image is not a timetable, return no classes and say so in reply.

reply: one short, friendly Korean sentence (e.g. "수업 7개를 찾았어요.").`;

/** 모델이 읽은 수업 하나 정리 — 요일·시각이 이상하면 버린다. 길이는 끝 - 시작(5분~12시간, 끝이 이르면 다음 날까지: 밤 알바 22:00~02:00) */
export function cleanClass(raw: RawClass) {
  const title = String(raw?.title ?? "").trim().slice(0, 120);
  if (!title) return null;
  const days = [...new Set((Array.isArray(raw.days) ? raw.days : []).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort();
  if (!days.length || !isTime(raw.start) || !isTime(raw.end)) return null;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const diff = mins(raw.end) - mins(raw.start);
  const duration = diff < 0 ? diff + 1440 : diff;
  if (duration < 5 || duration > 720) return null;
  const place = typeof raw.place === "string" && raw.place.trim() ? raw.place.trim().replace(/\s+/g, " ").slice(0, 60) : null;
  return { title, days, start: raw.start, duration_min: duration, place };
}

/** 같은 과목·시각이 겹쳐 나오면 요일을 합친다(모델이 요일마다 따로 적을 때) */
export function mergeClasses(list: NonNullable<ReturnType<typeof cleanClass>>[]) {
  const out: typeof list = [];
  for (const c of list) {
    const same = out.find((o) => o.title === c.title && o.start === c.start && o.duration_min === c.duration_min && o.place === c.place);
    if (same) same.days = [...new Set([...same.days, ...c.days])].sort();
    else out.push({ ...c, days: [...c.days] });
  }
  return out;
}
