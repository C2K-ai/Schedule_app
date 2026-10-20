// 커리어 '한눈에 보기' — 기록 전체를 한 장으로
//   mode "visual": AI 는 글만(한 줄 소개·대표 경험·항목별 한 줄·기술 묶음) → 앱이 정해 둔 디자인(이력서·포트폴리오)으로 그린다
//   mode "design": AI 가 HTML 한 장을 통째로(스크립트·바깥 주소 없이) → 앱이 잠근 틀(iframe sandbox + CSP) 안에 띄운다
import { KIND_LABEL, KINDS } from "./logic.ts";

export const VISUAL_MAX_ENTRIES = 80;
/** 항목 글을 합친 글자 수 상한 — 한 번 호출 비용·시간을 묶어 둔다 */
export const VISUAL_BUDGET = 24000;
const TEXT_MAX = 600;
export const WISH_MAX = 200;

export interface VisualEntry {
  title: string;
  kind: (typeof KINDS)[number];
  start_day: string;
  end_day: string | null;
  text: string;
  skills: string[];
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** 글자(코드 포인트) 단위 자르기 */
const cut = (s: string, max: number) => (s.length <= max ? s : Array.from(s).slice(0, max).join(""));
const str = (v: unknown, max: number) => (typeof v === "string" ? cut(v.trim(), max) : "");

/** 앱이 보낸 항목 목록 정리 — 이상한 것은 빼고, 글자 예산을 넘으면 뒤를 버린다 */
export function readEntries(v: unknown): VisualEntry[] {
  const out: VisualEntry[] = [];
  let used = 0;
  for (const e of (Array.isArray(v) ? v : []).slice(0, VISUAL_MAX_ENTRIES) as Record<string, unknown>[]) {
    const title = str(e?.title, 120);
    if (!title || !isDay(e?.start_day)) continue;
    const text = str(e?.text, TEXT_MAX);
    used += title.length + text.length + 40;
    if (used > VISUAL_BUDGET) break;
    out.push({
      title,
      kind: KINDS.includes(e.kind as (typeof KINDS)[number]) ? (e.kind as (typeof KINDS)[number]) : "etc",
      start_day: e.start_day as string,
      end_day: isDay(e?.end_day) ? (e.end_day as string) : null,
      text,
      skills: (Array.isArray(e?.skills) ? e.skills : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 12),
    });
  }
  return out;
}

export function buildVisualPrompt(list: VisualEntry[], today: string, wish = ""): string {
  const lines = list.map((e, i) => {
    const period = `${e.start_day} ~ ${e.end_day ?? "진행 중"}`;
    return [
      `[${i + 1}] ${e.title} · ${KIND_LABEL[e.kind]} · ${period}${e.skills.length ? ` · 기술: ${e.skills.join(", ")}` : ""}`,
      e.text ? `    ${e.text.replace(/\s*\n\s*/g, "\n    ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    `오늘: ${today}`,
    wish ? `사용자가 원하는 느낌: """${wish}"""` : null,
    `커리어 기록 ${list.length}개:\n${lines.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ───────────── mode "visual": 글만 ─────────────

export const VISUAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "summary", "highlights", "items", "skill_groups"],
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    highlights: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["n", "why"], properties: { n: { type: "integer" }, why: { type: "string" } } },
    },
    items: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["n", "line"], properties: { n: { type: "integer" }, line: { type: "string" } } },
    },
    skill_groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "skills"],
        properties: { name: { type: "string" }, skills: { type: "array", items: { type: "string" } } },
      },
    },
  },
};

export const VISUAL_SYSTEM = `You turn a Korean user's career log into the text of a one-page résumé / portfolio. The app draws the page; you only write the words, in Korean.
Each record is numbered [n] with its title, type, period, skills and notes.

Rules:
- Use only facts in the records. Never invent numbers, names, tools, results, roles or schools. If a result is not stated, do not claim one.
- headline: one short phrase (at most 30 characters) that sums the person up from the records, e.g. "데이터로 문제를 푸는 경영학도". No name, no emoji.
- summary: 2–3 short sentences introducing what they have done, based on the records.
- highlights: the 3 strongest records (fewer if there are fewer than 3) by n, each with why — one short line (at most 50 characters) on what makes it stand out, using facts from the record.
- items: one entry per record, every n exactly once: line — one line (at most 60 characters) saying what was done or achieved, ending in a noun phrase (e.g. "교내 해커톤 본선 진출 및 발표"). Keep the record's own numbers.
- skill_groups: 2–5 groups with short names (e.g. "개발", "데이터", "언어", "디자인", "협업") holding the skills, tools and languages explicitly named in the records. Each skill once. Empty array if none are named.`;

export interface Visual {
  headline: string;
  summary: string;
  highlights: { n: number; why: string }[];
  items: { n: number; line: string }[];
  skill_groups: { name: string; skills: string[] }[];
}

/** 모델 답 정리 — 없는 번호·겹치는 것 빼고 길이 자르기. n 은 1부터(앱이 항목 순서로 다시 맞춘다) */
export function cleanVisual(v: Partial<Visual> | null | undefined, count: number): Visual {
  const okN = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= count;
  const seenH = new Set<number>();
  const highlights = (Array.isArray(v?.highlights) ? v.highlights : [])
    .filter((h) => okN(h?.n) && !seenH.has(h.n) && seenH.add(h.n))
    .slice(0, 3)
    .map((h) => ({ n: h.n, why: str(h.why, 80) }));
  const seenI = new Set<number>();
  const items = (Array.isArray(v?.items) ? v.items : [])
    .filter((x) => okN(x?.n) && !seenI.has(x.n) && seenI.add(x.n))
    .map((x) => ({ n: x.n, line: str(x.line, 90) }))
    .filter((x) => x.line);
  const seenS = new Set<string>();
  const skill_groups = (Array.isArray(v?.skill_groups) ? v.skill_groups : [])
    .map((g) => ({
      name: str(g?.name, 20),
      skills: (Array.isArray(g?.skills) ? g.skills : [])
        .map((s) => str(s, 30))
        .filter((s) => s && !seenS.has(s.toLowerCase()) && seenS.add(s.toLowerCase()))
        .slice(0, 16),
    }))
    .filter((g) => g.name && g.skills.length)
    .slice(0, 6);
  return { headline: str(v?.headline, 40), summary: str(v?.summary, 400), highlights, items, skill_groups };
}

// ───────────── mode "design": HTML 통째로 ─────────────

export const DESIGN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["html"],
  properties: { html: { type: "string" } },
};

export const DESIGN_SYSTEM = `You design a one-page visual career portfolio for a Korean user as a single self-contained HTML document, from their numbered career records.
Return it in the "html" field.

Content:
- Korean. Use only facts in the records — never invent numbers, names, tools, results, roles or schools.
- Include every record (title, period, type, what was done). Group or order them in a way that reads well (by year, by type, a timeline…). Show their skills.
- Open with a short headline and 2–3 sentence introduction drawn from the records. No personal name unless one appears in the records.
- If the user describes the feel they want, follow it.

Design:
- Make it look like a polished, modern portfolio page: clear hierarchy, generous spacing, a coherent colour palette, cards, a timeline or similar visual structure. Responsive down to 360px wide, and print well on A4 (@media print).
- Technical limits (the page is shown in a locked frame and anything else is blocked):
  - One <!doctype html> document with <html lang="ko">, <meta charset="utf-8">, <meta name="viewport" content="width=device-width, initial-scale=1"> and all CSS in one <style> in <head>.
  - No <script>, no event handlers (onclick…), no forms, no iframes, no external URLs of any kind (no web fonts, no CDN, no images by URL, no links to other sites). Use system fonts: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif.
  - Decoration only with CSS (gradients, borders, shapes) or small inline <svg>.
  - Keep it compact: about 150 lines of CSS at most, no repeated boilerplate.`;

/** AI 가 만든 HTML 에서 실행될 수 있는 것·바깥 주소를 한 번 더 걷어 낸다(진짜 막는 건 앱의 sandbox iframe + CSP) */
export function cleanHtml(html: unknown): string {
  if (typeof html !== "string") return "";
  let h = html.trim();
  const at = h.search(/<!doctype html|<html[\s>]/i);
  if (at > 0) h = h.slice(at);
  h = h
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*>/gi, "")
    .replace(/<(iframe|object|embed|frame|frameset|form|base|link)\b[\s\S]*?(<\/\1\s*>|>)/gi, "")
    .replace(/<meta\b[^>]*http-equiv[^>]*>/gi, "")
    .replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|xlink:href|action|formaction)\s*=\s*("|')\s*(javascript|data|vbscript|https?):[^"']*\2/gi, '$1="#"')
    .replace(/url\(\s*(['"]?)\s*(https?:|\/\/|javascript:)[^)]*\)/gi, "none")
    .replace(/@import[^;]+;/gi, "");
  return h.length > 300_000 ? "" : h;
}
