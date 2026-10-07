// career-polish 의 순수 로직(스키마·프롬프트·입력 정리) — index.ts 와 테스트가 같이 쓴다

export const KINDS = ["work", "project", "study", "cert", "award", "activity", "etc"] as const;
export const KIND_LABEL: Record<(typeof KINDS)[number], string> = {
  work: "업무",
  project: "프로젝트",
  study: "공부·교육",
  cert: "자격증",
  award: "수상",
  activity: "대외활동",
  etc: "기타",
};

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "bullets", "skills"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    bullets: { type: "array", items: { type: "string" } },
    skills: { type: "array", items: { type: "string" } },
  },
};

export const SYSTEM = `You help a Korean user keep a career log they will later turn into a résumé, portfolio or performance review.
They give you a rough note in Korean plus the calendar items they completed and diary notes from that period. Turn it into clean Korean résumé material.

Rules:
- Use only facts present in the note, the completed items or the diary notes. Never invent numbers, names, tools, results or responsibilities. If a result is not stated, describe the work without claiming an outcome.
- Prefer the user's own note; use calendar items and diary notes to add concrete detail (what, how often, how long, with whom).
- Ignore routine personal items that have nothing to do with this entry (meals, exercise, chores) unless the entry is about them.
- title: a short, specific Korean title for the entry (e.g. "개인 일정 관리 PWA 개발").
- summary: one Korean sentence on what this was and why it mattered.
- bullets: 2–6 Korean résumé bullets, each one line, achievement-oriented, ending in a noun phrase (e.g. "~ 설계 및 구현", "~ 매일 2시간씩 8주 학습"). Put numbers that appear in the material in the bullet.
- skills: tools, technologies or abilities explicitly evidenced by the material (e.g. "Next.js", "독일어 B1", "데이터 분석"); empty array if none.`;

export interface Material {
  title?: unknown;
  kind?: unknown;
  start_day?: unknown;
  end_day?: unknown;
  raw?: unknown;
  events?: unknown;
  notes?: unknown;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 앱이 보낸 재료를 프롬프트로 — 너무 길면 자른다 */
export function buildPrompt(m: Material): string | null {
  const raw = str(m.raw, 6000);
  const events = (Array.isArray(m.events) ? m.events : [])
    .slice(0, 300)
    .map((e: { date?: unknown; title?: unknown; notes?: unknown }) => {
      const t = str(e?.title, 200);
      if (!t || !isDay(e?.date)) return null;
      const n = str(e?.notes, 300);
      return `- ${e.date} ${t}${n ? ` (${n})` : ""}`;
    })
    .filter(Boolean);
  const notes = (Array.isArray(m.notes) ? m.notes : [])
    .slice(0, 120)
    .map((n: { day?: unknown; body?: unknown }) => {
      const b = str(n?.body, 800);
      return b && isDay(n?.day) ? `- ${n.day}: ${b.replace(/\s+/g, " ")}` : null;
    })
    .filter(Boolean);
  if (!raw && !events.length && !notes.length) return null;
  const kind = KINDS.includes(m.kind as (typeof KINDS)[number]) ? KIND_LABEL[m.kind as (typeof KINDS)[number]] : "기타";
  const period = isDay(m.start_day) ? `${m.start_day} ~ ${isDay(m.end_day) ? m.end_day : "진행 중"}` : "기간 미정";
  return [
    `종류: ${kind}`,
    `기간: ${period}`,
    `내가 붙인 제목: ${str(m.title, 120) || "(없음)"}`,
    `내가 적은 메모:\n"""\n${raw || "(없음)"}\n"""`,
    `이 기간에 끝낸 일정:\n${events.length ? events.join("\n") : "(없음)"}`,
    `이 기간의 하루 노트:\n${notes.length ? notes.join("\n") : "(없음)"}`,
  ].join("\n\n");
}

export interface Polished {
  title: string;
  summary: string;
  bullets: string[];
  skills: string[];
}

export function cleanPolished(p: Polished): Polished {
  const uniq = (xs: string[], max: number, len: number) =>
    [...new Set((xs ?? []).map((x) => String(x).trim()).filter(Boolean))].slice(0, max).map((x) => x.slice(0, len));
  return {
    title: String(p.title ?? "").trim().slice(0, 120),
    summary: String(p.summary ?? "").trim().slice(0, 400),
    bullets: uniq(p.bullets, 8, 200),
    skills: uniq(p.skills, 12, 40),
  };
}
