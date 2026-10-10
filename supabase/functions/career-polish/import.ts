// 커리어 '한 번에 넣기' — 정리해 둔 글을 통째로 붙여 넣으면 항목별 커리어 기록으로 나눈다(글은 그대로, 다듬지 않음)
import { KINDS } from "./logic.ts";

/** 글자 수 — 길수록 답이 오래 걸린다(대략 글자 수만큼 출력 토큰, Edge 150초 안에 끝나게) */
export const IMPORT_MAX = 6000;
export const IMPORT_MAX_ENTRIES = 60;

export const IMPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "kind", "start", "end", "ongoing", "date_guess", "text", "skills"],
        properties: {
          title: { type: "string" },
          kind: { type: "string", enum: [...KINDS] },
          start: { type: "string" },
          end: { type: "string" },
          ongoing: { type: "boolean" },
          date_guess: { type: "boolean" },
          text: { type: "string" },
          skills: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export const IMPORT_SYSTEM = `You split a user's career summary — pasted as-is from a note, résumé or document — into separate entries for their career log app.
Each entry becomes one card with a title, a type, a period, the original text and skills.
The user wants their text kept exactly as it is. You are a splitter, not a writer.

How to split:
- One entry per distinct thing: a competition, a paper or research, a program, a certificate or test score, a job, a role, an exchange, an event, a talk, an interview.
- Detail lines that belong to an item (sub-bullets, indented or following lines such as "주제: …", results, what was done) stay in that item's entry — never split them out.
- Each table row is its own entry (one certificate or score per row).
- A plain list without its own dates (e.g. courses taken) is one entry.
- Section headings (경력, 프로젝트, 자격증·어학 …), the document's title line and table header rows are not entries; use a heading only to choose the kind.
- A one-line profile without its own period (school, major, current year, interests) is not an entry. A school or degree line with its own period (e.g. "○○대학교 경영학과 2021.03 ~ 2025.02") is a study entry.
- Keep the order of the original text. If there is nothing career-like, return no entries.

Fields:
- title: a short title naming the thing, taken from the text in the text's language (e.g. "캡스톤 디자인 본선 발표", "TOEIC 905점", "SW 마에스트로", "학생회 기획부", "카페 아르바이트"). Use the item's own name and words; add nothing.
- kind: work = jobs, part-time work, teaching assistant, internships · project = research, papers, building something · study = courses, classes, training or education programs, attending conferences, seminars or talks · cert = certificates, licenses, language and test scores · award = prizes, awards, scholarships, advancing to a final round · activity = student council, clubs, volunteering, exchange or buddy programs, entering competitions, events · etc = anything else (e.g. job interviews).
- start, end: dates as precise as written — "YYYY-MM-DD", "YYYY-MM" or "YYYY" — or "" when there is none. Read Korean and dotted formats ("2026.09" → "2026-09", "2025.09.09" → "2025-09-09", "9/22~25" → "…-09-22" to "…-09-25").
  A date written without a year takes the year of the nearest earlier date in the same item, else of its section or the document.
  A range "A ~ B" gives start A and end B. One date gives start only (end ""). If an item mentions several dates, start is the earliest and end the latest.
  Relative dates count from today's date given with the text ("작년 여름" → last year's June to August, "올해 3월" → this year's March). Seasons: 봄 March–May, 여름 June–August, 가을 September–November, 겨울 December–February.
- ongoing: true only when the item is still going on (e.g. "2025.07~", "~ 현재", "진행 중") and no end date is written. If a future end date is written, keep it as end and set ongoing false.
- date_guess: true when the period is not written on the item itself — taken from its section or the document, inferred from a semester (1학기 = March–June, 2학기 = September–December), or missing (then start "" and end "").
- text: every line of the item copied exactly as written, including dates and detail lines, one per line. A table row becomes its non-empty cells joined with " · ". Never reword, summarize, shorten, translate, correct or add anything.
- skills: tools, technologies, methods or languages explicitly named in the item (e.g. "Python", "React", "PostgreSQL", "Wireshark"). Do not infer, do not repeat the title, empty array if none.`;

const isoDay = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** "2026" · "2026-09" · "2026-09-02" → 그 기간의 첫날·마지막 날. 이상하면 null */
export function partialDate(s: unknown): { first: string; last: string } | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  if (y < 1950 || y > 2100) return null;
  if (!m[2]) return { first: isoDay(y, 1, 1), last: isoDay(y, 12, 31) };
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  if (!m[3]) return { first: isoDay(y, mo, 1), last: isoDay(y, mo, lastOfMonth(y, mo)) };
  const d = Number(m[3]);
  if (d < 1 || d > lastOfMonth(y, mo)) return null;
  return { first: isoDay(y, mo, d), last: isoDay(y, mo, d) };
}

export interface RawImportEntry {
  title?: unknown;
  kind?: unknown;
  start?: unknown;
  end?: unknown;
  ongoing?: unknown;
  date_guess?: unknown;
  text?: unknown;
  skills?: unknown;
}

export interface ImportedEntry {
  title: string;
  kind: (typeof KINDS)[number];
  start_day: string;
  end_day: string | null;
  raw: string;
  skills: string[];
  /** 기간을 글에서 그대로 못 읽음(머리글·학기에서 짐작했거나 없음) — 앱이 '날짜 확인'으로 보여 준다 */
  date_guess: boolean;
}

const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** 모델이 준 항목 하나 → 앱에 넣을 모양(날짜는 여기서 계산 — 모델이 달 마지막 날 등을 세지 않게) */
export function cleanImported(r: RawImportEntry, today: string): ImportedEntry | null {
  const raw = typeof r.text === "string"
    ? r.text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        // 빈 표 칸이 남긴 앞뒤 ' · ' 는 지운다
        .map((x) => x.trimEnd().replace(/(\s*·\s*)+$/, "").replace(/^\s*(?:·\s*)+/, ""))
        .filter((x) => x.trim())
        .join("\n")
        .trim()
        .slice(0, 4000)
    : "";
  const title = line(r.title, 120) || line(raw.split("\n")[0], 120);
  if (!title) return null;
  const kind = KINDS.includes(r.kind as (typeof KINDS)[number]) ? (r.kind as (typeof KINDS)[number]) : "etc";
  const s = partialDate(r.start);
  const e = partialDate(r.end);
  let guess = r.date_guess === true;
  let start_day: string;
  let end_day: string | null;
  if (!s) {
    // 날짜가 없으면 오늘 하루로 두고 '날짜 확인' 표시
    start_day = today;
    end_day = today;
    guess = true;
  } else {
    start_day = s.first;
    if (e && e.last >= s.first) end_day = e.last;
    else if (r.ongoing === true) end_day = null;
    else end_day = s.last;
  }
  const skills = [...new Set((Array.isArray(r.skills) ? r.skills : []).map((x) => line(x, 40)).filter(Boolean))]
    .filter((x) => x !== title)
    .slice(0, 12);
  return { title, kind, start_day, end_day, raw, skills, date_guess: guess };
}

export function cleanImport(out: { entries?: unknown }, today: string): ImportedEntry[] {
  const list = Array.isArray(out?.entries) ? (out.entries as RawImportEntry[]) : [];
  return list
    .slice(0, IMPORT_MAX_ENTRIES)
    .map((r) => cleanImported(r ?? {}, today))
    .filter((x): x is ImportedEntry => x !== null);
}

export function buildImportPrompt(text: string, today: string): string {
  return [`오늘: ${today}`, `사용자가 붙여 넣은 커리어 정리:\n"""\n${text}\n"""`].join("\n\n");
}
