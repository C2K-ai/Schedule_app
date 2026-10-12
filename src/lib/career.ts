// 커리어 기록 공용(종류·기간 표시) + '한 번에 넣기' — AI 가 나눠 준 항목을 미리보기 초안으로 만들고, 빠진 줄·이미 있는 기록을 찾는다
//   순수 함수 — 시험: tests/career.test.mjs
import type { CareerEntry, CareerKind } from "./types";

export const CAREER_KINDS: { value: CareerKind; label: string }[] = [
  { value: "work", label: "업무" },
  { value: "project", label: "프로젝트" },
  { value: "study", label: "공부·교육" },
  { value: "cert", label: "자격증" },
  { value: "award", label: "수상" },
  { value: "activity", label: "대외활동" },
  { value: "etc", label: "기타" },
];
export const kindLabel = (k: CareerKind) => CAREER_KINDS.find((x) => x.value === k)?.label ?? "기타";

const dot = (d: string) => d.replaceAll("-", ".");
const lastOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isFirst = (d: string) => d.endsWith("-01");
const isLast = (d: string) => Number(d.slice(8)) === lastOfMonth(Number(d.slice(0, 4)), Number(d.slice(5, 7)));

/**
 * 기간 글자 — 하루면 날짜 하나, 달 단위(1일~말일)면 '2026.03', 해 단위면 '2025'.
 * 예: 2024.11.05 · 2027.03 · 2027.03 ~ 2027.06 · 2023.06.12 ~ 2023.08.25 · 2023.05 ~ 진행 중
 */
export function careerPeriod(e: { start_day: string; end_day: string | null }): string {
  const { start_day: s, end_day: t } = e;
  if (!t) return `${isFirst(s) ? dot(s.slice(0, 7)) : dot(s)} ~ 진행 중`;
  if (s === t) return dot(s);
  if (isFirst(s) && isLast(t)) {
    if (s.slice(5) === "01-01" && t.slice(5) === "12-31") return s.slice(0, 4) === t.slice(0, 4) ? s.slice(0, 4) : `${s.slice(0, 4)} ~ ${t.slice(0, 4)}`;
    return s.slice(0, 7) === t.slice(0, 7) ? dot(s.slice(0, 7)) : `${dot(s.slice(0, 7))} ~ ${dot(t.slice(0, 7))}`;
  }
  return `${dot(s)} ~ ${dot(t)}`;
}

/** 한 번에 넣을 수 있는 글자 수 — 서버 career-polish/import.ts 의 IMPORT_MAX 와 같게 */
export const CAREER_IMPORT_MAX = 6000;

/** career-polish(mode import)가 돌려주는 항목 하나 — 서버 career-polish/import.ts 의 ImportedEntry 와 같은 모양 */
export interface ImportedCareer {
  title: string;
  kind: CareerKind;
  start_day: string;
  end_day: string | null;
  raw: string;
  skills: string[];
  /** 기간이 글에 그대로 적혀 있지 않았음(머리글·학기에서 짐작했거나 없음) */
  date_guess: boolean;
}

/** 미리보기에서 고르고 고치는 초안 */
export interface ImportDraft extends ImportedCareer {
  key: string;
  on: boolean;
  /** 같은 제목·시작일의 기록이 이미 있음 — 처음엔 빼 둔다 */
  dup: boolean;
}

/** 비교용 — 띄어쓰기·문장부호·대소문자 무시 */
export const normText = (s: string) =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s·•‧∙.,:;!?()[\]{}<>「」『』《》〈〉"'“”‘’`~|*#>_=+\-–—/\\]+/g, "");

export function toDrafts(list: ImportedCareer[], existing: CareerEntry[]): ImportDraft[] {
  const have = new Set(existing.filter((e) => !e.deleted_at).map((e) => `${normText(e.title)}|${e.start_day}`));
  const haveRaw = new Set(existing.filter((e) => !e.deleted_at && e.raw.trim()).map((e) => normText(e.raw)));
  return list.map((x, i) => {
    const dup = have.has(`${normText(x.title)}|${x.start_day}`) || (x.raw.trim() !== "" && haveRaw.has(normText(x.raw)));
    return { ...x, key: `${i}`, on: !dup, dup };
  });
}

// 날짜만 있는 조각(2027.03 · 3/14~16 · 2023.05~ · 2026년 · 3월) — 날짜는 기간 칸으로 가니 '빠진 줄' 비교에서 뺀다
const DATE_TOKEN = /^[\d.\/~년월일-]+$/;

/** 글자(코드 포인트) 단위로 자르기 — 이모지 반쪽이 남으면 서버가 그 기록(과 같이 보낸 기록들)을 거절한다 */
export const cutChars = (s: string, max: number) => (s.length <= max ? s : Array.from(s).slice(0, max).join(""));

const cellsOf = (line: string) => line.split(/\t|\|/).map((c) => c.trim()).filter(Boolean);
/** 표 머리 줄 — 표의 첫 줄이고 짧은 칸들, 숫자 없음('구분\t기관\t취득일\t비고'). 표 가운데의 'OPIc | IH' 같은 줄은 내용이라 빼지 않는다 */
const isTableHeader = (cells: string[], prevTable: boolean) =>
  !prevTable && cells.length >= 2 && cells.every((c) => c.length <= 8 && !/\d/.test(c));

/**
 * AI 가 어느 항목에도 넣지 않은 줄 — 미리보기에 '넣지 않은 줄'로 보여 줘서 빠뜨린 걸 사용자가 알게 한다.
 * 머리글(세 낱말 이하·숫자 없음·날짜 없음 — 맨 첫 줄 제목은 날짜가 있어도)·표 머리 줄·표 구분선은 뺀다.
 * 줄의 낱말 60% 이상이 어느 항목에든 있으면 들어간 것으로 본다.
 */
export function unusedLines(text: string, entries: Pick<ImportedCareer, "title" | "raw" | "skills">[]): string[] {
  const hay = normText(entries.map((e) => `${e.title}\n${e.raw}\n${e.skills.join(" ")}`).join("\n"));
  const out: string[] = [];
  let first = true;
  let prevTable = false;
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    const cells = /\t|\|/.test(rawLine) ? cellsOf(rawLine) : [];
    const header = isTableHeader(cells, prevTable);
    if (line) prevTable = /\t|\|/.test(rawLine);
    if (!line || /^[|\s:\-–—=*_#>]+$/.test(line) || header) continue;
    const tokens = line
      .split(/[\s,·•|:;()[\]「」『』"“”]+/)
      .map((w) => w.trim())
      .filter(Boolean);
    const words = tokens.filter((w) => !DATE_TOKEN.test(w)).map(normText).filter(Boolean);
    const dated = tokens.some((w) => DATE_TOKEN.test(w) && /\d/.test(w));
    const title = first;
    first = false;
    if (!words.length) continue;
    if (words.length <= 3 && !words.some((w) => /\d/.test(w)) && (!dated || title)) continue;
    const hit = words.filter((w) => hay.includes(w)).length;
    if (hit / words.length < 0.6) out.push(line);
  }
  return out;
}
