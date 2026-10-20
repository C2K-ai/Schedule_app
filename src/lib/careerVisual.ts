// 커리어 '한눈에 보기' — AI 가 써 준 글(career-polish mode visual)을 정해 둔 디자인(이력서·포트폴리오)의 HTML 한 장으로.
//   AI 자유 디자인(mode design)의 HTML 은 lockHtml 로 잠가서 띄운다. 순수 함수 — 시험: tests/career-visual.test.mjs

import { careerPeriod, kindLabel } from "./career";
import type { CareerEntry, CareerKind } from "./types";

export interface CareerVisual {
  headline: string;
  summary: string;
  highlights: { n: number; why: string }[];
  items: { n: number; line: string }[];
  skill_groups: { name: string; skills: string[] }[];
}
export type VisualTheme = "resume" | "portfolio";

/** AI 에 보내는 항목 하나 — 서버 career-polish/visual.ts 의 VisualEntry 와 같은 모양 */
export interface VisualEntryInput {
  title: string;
  kind: CareerKind;
  start_day: string;
  end_day: string | null;
  text: string;
  skills: string[];
}

/** 서버가 받는 항목 수·글 길이 — career-polish/visual.ts 와 같게 */
export const VISUAL_MAX_ENTRIES = 80;
const TEXT_MAX = 600;
export const WISH_MAX = 200;

const cut = (s: string, max: number) => (s.length <= max ? s : Array.from(s).slice(0, max).join(""));

/** 보내는 순서 = 최근 것부터(AI 의 번호 n 은 이 순서의 1부터). 서버가 빼는 것(제목 없음·날짜 이상)은 여기서도 빼서 번호가 어긋나지 않게 */
export function visualOrder(list: CareerEntry[]): CareerEntry[] {
  return [...list]
    .filter((e) => !e.deleted_at && e.title.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(e.start_day))
    .sort((a, b) => b.start_day.localeCompare(a.start_day) || a.title.localeCompare(b.title))
    .slice(0, VISUAL_MAX_ENTRIES);
}

export function visualInput(ordered: CareerEntry[]): VisualEntryInput[] {
  return ordered.map((e) => ({
    title: e.title,
    kind: e.kind,
    start_day: e.start_day,
    end_day: e.end_day,
    text: cut((e.polished.trim() || e.raw.trim()).replace(/\r\n?/g, "\n"), TEXT_MAX),
    skills: e.skills.slice(0, 12),
  }));
}

/** 기록이 바뀌었는지 — 만든 뒤 고치거나 더하면 '다시 만들기'를 권한다 */
export const visualSignature = (ordered: CareerEntry[]) => ordered.map((e) => `${e.id}@${e.updated_at}`).join("|");

// ───────────── HTML ─────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 스크립트·바깥 주소를 막는 규칙 — 앱 화면 틀(iframe sandbox)과 내려받은 파일 둘 다에서 */
export const VISUAL_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${VISUAL_CSP}">`;

/** AI 가 만든 HTML 을 잠근다 — head 맨 앞에 CSP(다른 meta 보다 먼저) */
export function lockHtml(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${CSP_META}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${CSP_META}</head>`);
  return `<!doctype html><html lang="ko"><head>${CSP_META}<meta charset="utf-8"></head><body>${html}</body></html>`;
}

export const KIND_COLOR: Record<CareerKind, string> = {
  work: "#2563eb",
  project: "#7c3aed",
  study: "#0891b2",
  cert: "#059669",
  award: "#d97706",
  activity: "#db2777",
  etc: "#64748b",
};
const KIND_ORDER: CareerKind[] = ["work", "project", "activity", "award", "cert", "study", "etc"];

/** 기록 글 → 첫 문단 + 글머리표('- ' 줄) */
function splitBody(text: string): { lead: string; bullets: string[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-•·*]\s*/.test(l)).map((l) => l.replace(/^[-•·*]\s*/, ""));
  const lead = lines.filter((l) => !/^[-•·*]\s*/.test(l)).join(" ");
  return { lead, bullets };
}

interface Row {
  e: CareerEntry;
  line: string;
}

function stats(entries: CareerEntry[]) {
  const years = entries.flatMap((e) => [e.start_day.slice(0, 4), (e.end_day ?? "").slice(0, 4)]).filter(Boolean).sort();
  const ongoing = entries.some((e) => !e.end_day);
  const skills = new Set(entries.flatMap((e) => e.skills.map((s) => s.toLowerCase())));
  const span = years.length ? (ongoing ? `${years[0]} ~ 지금` : years[0] === years[years.length - 1] ? years[0] : `${years[0]} ~ ${years[years.length - 1]}`) : "";
  return [
    { label: "기록", value: `${entries.length}개` },
    ...(span ? [{ label: "기간", value: span }] : []),
    { label: "수상·자격", value: `${entries.filter((e) => e.kind === "award" || e.kind === "cert").length}개` },
    { label: "기술", value: `${skills.size}개` },
  ];
}

const chips = (list: string[], cls: string) => list.map((s) => `<span class="${cls}">${esc(s)}</span>`).join("");

const FONT = `-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Segoe UI", sans-serif`;

export interface RenderOpts {
  /** 머리에 보일 이름(선택) */
  name?: string;
  /** 만든 날 'YYYY.MM.DD' */
  made: string;
}

/**
 * AI 글 + 기록 → HTML 문서. ordered = AI 에 보낸 순서(n 이 1부터 가리키는 것) — 만든 뒤 지운 기록은 null(빠짐),
 * 그 뒤에 새로 쓴 기록은 끝에 붙여 오면 AI 한 줄 없이 그린다.
 */
export function renderCareerHtml(v: CareerVisual, ordered: (CareerEntry | null)[], theme: VisualTheme, opts: RenderOpts): string {
  const lineOf = new Map(v.items.map((x) => [x.n, x.line]));
  const all = ordered.map((e, i) => (e ? { e, line: lineOf.get(i + 1) ?? "" } : null));
  const rows = all.filter((r): r is Row => r !== null);
  const highlights = v.highlights
    .map((h) => ({ row: all[h.n - 1], why: h.why }))
    .filter((h): h is { row: Row; why: string } => Boolean(h.row));
  const st = stats(rows.map((r) => r.e));
  const title = opts.name ? `${opts.name} · 커리어` : "커리어 한눈에 보기";
  const head = (css: string) =>
    `<!doctype html><html lang="ko"><head>${CSP_META}<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head>`;
  return theme === "resume" ? resume(v, rows, highlights, st, opts, head) : portfolio(v, rows, highlights, st, opts, head);
}

type Highlight = { row: Row; why: string };
type Stat = { label: string; value: string };

function resume(v: CareerVisual, rows: Row[], hl: Highlight[], st: Stat[], o: RenderOpts, head: (css: string) => string): string {
  const css = `
*{box-sizing:border-box}html{background:#eef0f3}body{margin:0;font-family:${FONT};color:#1f2328;line-height:1.55;-webkit-font-smoothing:antialiased;word-break:keep-all;overflow-wrap:anywhere}
.page{max-width:820px;margin:24px auto;background:#fff;padding:48px 52px;border-radius:6px;box-shadow:0 2px 14px rgba(0,0,0,.08)}
.name{font-size:14px;font-weight:700;letter-spacing:.12em;color:#57606a;margin:0 0 6px}
h1{font-size:28px;line-height:1.3;margin:0 0 10px;letter-spacing:-.02em}.sum{margin:0;color:#424a53;font-size:15px}
.stats{display:flex;flex-wrap:wrap;gap:8px 22px;margin:18px 0 0;padding:12px 0 0;border-top:2px solid #1f2328;font-size:13px;color:#57606a}.stats b{color:#1f2328;margin-left:6px}
h2{font-size:13px;letter-spacing:.14em;color:#57606a;margin:34px 0 12px;padding-bottom:6px;border-bottom:1px solid #d0d7de}
.hl{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.hl div{border:1px solid #d0d7de;border-left:4px solid var(--c);border-radius:6px;padding:10px 12px}
.hl b{display:block;font-size:14px}.hl span{font-size:12.5px;color:#57606a}
.it{display:grid;grid-template-columns:1fr auto;gap:2px 16px;padding:10px 0;border-bottom:1px dashed #e5e8eb;break-inside:avoid}.it:last-child{border-bottom:0}
.t{font-weight:700;font-size:15px}.p{font-size:12.5px;color:#57606a;white-space:nowrap;font-variant-numeric:tabular-nums}
.l{grid-column:1/-1;font-size:13.5px;color:#424a53}.it ul{grid-column:1/-1;margin:4px 0 0;padding-left:18px;font-size:13px;color:#424a53}.it li{margin:1px 0}
.k{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c);margin-right:7px;vertical-align:1px}
.ch{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.c{font-size:11.5px;border:1px solid #d0d7de;border-radius:4px;padding:1px 6px;color:#424a53}
.sg{display:grid;grid-template-columns:110px 1fr;gap:6px 14px;font-size:13.5px}.sg b{color:#57606a;font-weight:700}
.foot{margin-top:36px;font-size:11px;color:#8c959f;text-align:right}
@media(max-width:600px){.page{margin:0;border-radius:0;padding:28px 20px}h1{font-size:23px}.sg{grid-template-columns:1fr}.sg b{margin-top:6px}}
@media print{html{background:#fff}.page{margin:0;box-shadow:none;padding:0;max-width:none}@page{size:A4;margin:16mm}}`;
  const byKind = KIND_ORDER.map((k) => ({ k, list: rows.filter((r) => r.e.kind === k) })).filter((g) => g.list.length);
  const item = (r: Row) => {
    const { lead, bullets } = splitBody(r.e.polished.trim() || r.e.raw.trim());
    const line = r.line || lead;
    return `<div class="it" style="--c:${KIND_COLOR[r.e.kind]}"><div class="t"><span class="k"></span>${esc(r.e.title)}</div><div class="p">${esc(careerPeriod(r.e))}</div>${
      line ? `<div class="l">${esc(line)}</div>` : ""
    }${bullets.length ? `<ul>${bullets.slice(0, 5).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}${r.e.skills.length ? `<div class="ch">${chips(r.e.skills, "c")}</div>` : ""}</div>`;
  };
  return `${head(css)}<body><main class="page">
${o.name ? `<p class="name">${esc(o.name)}</p>` : ""}<h1>${esc(v.headline || "커리어 한눈에 보기")}</h1>${v.summary ? `<p class="sum">${esc(v.summary)}</p>` : ""}
<div class="stats">${st.map((s) => `<span>${esc(s.label)}<b>${esc(s.value)}</b></span>`).join("")}</div>
${hl.length ? `<h2>대표 경험</h2><div class="hl">${hl.map((h) => `<div style="--c:${KIND_COLOR[h.row.e.kind]}"><b>${esc(h.row.e.title)}</b><span>${esc(h.why || h.row.line)}</span></div>`).join("")}</div>` : ""}
${byKind.map((g) => `<h2>${esc(kindLabel(g.k))}</h2>${g.list.map(item).join("")}`).join("\n")}
${v.skill_groups.length ? `<h2>기술·역량</h2><div class="sg">${v.skill_groups.map((g) => `<b>${esc(g.name)}</b><div>${esc(g.skills.join(" · "))}</div>`).join("")}</div>` : ""}
<p class="foot">DREAM 커리어 기록으로 만들었어요 · ${esc(o.made)}</p>
</main></body></html>`;
}

function portfolio(v: CareerVisual, rows: Row[], hl: Highlight[], st: Stat[], o: RenderOpts, head: (css: string) => string): string {
  const css = `
*{box-sizing:border-box}body{margin:0;font-family:${FONT};background:#0b1020;color:#e8ebf4;line-height:1.55;-webkit-font-smoothing:antialiased;word-break:keep-all;overflow-wrap:anywhere;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.wrap{max-width:960px;margin:0 auto;padding:0 20px 48px}
.hero{padding:56px 0 36px;background:radial-gradient(1200px 400px at 10% -10%,rgba(124,58,237,.55),transparent 60%),radial-gradient(900px 380px at 100% 0,rgba(37,99,235,.45),transparent 60%)}
.name{font-size:13px;font-weight:800;letter-spacing:.2em;color:#a5b4fc;margin:0 0 10px;text-transform:uppercase}
h1{font-size:clamp(28px,5.4vw,46px);line-height:1.18;margin:0 0 14px;letter-spacing:-.03em;background:linear-gradient(90deg,#fff,#c7d2fe 60%,#f0abfc);-webkit-background-clip:text;background-clip:text;color:transparent}
.sum{max-width:640px;margin:0;color:#c3c9dc;font-size:16px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:26px}.tile{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px 14px}
.tile b{display:block;font-size:20px;color:#fff;letter-spacing:-.02em}.tile span{font-size:12px;color:#9aa3bd}
h2{font-size:14px;letter-spacing:.18em;color:#a5b4fc;margin:40px 0 14px}
.hl{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.card{position:relative;border-radius:18px;padding:18px 18px 16px;background:linear-gradient(160deg,color-mix(in srgb,var(--c) 38%,#0b1020),#121833);border:1px solid color-mix(in srgb,var(--c) 45%,transparent);break-inside:avoid}
.card .n{position:absolute;top:12px;right:14px;font-size:30px;font-weight:900;color:rgba(255,255,255,.14)}
.pill{display:inline-block;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--c) 30%,transparent);color:#fff}
.card h3{margin:10px 0 6px;font-size:17px;line-height:1.35}.card p{margin:0;font-size:13.5px;color:#d5daea}.card small{display:block;margin-top:8px;font-size:12px;color:#9aa3bd}
.year{display:grid;grid-template-columns:72px 1fr;gap:0 14px}.y{font-size:22px;font-weight:900;color:#fff;padding-top:8px;letter-spacing:-.02em}
.line{border-left:2px solid rgba(255,255,255,.12);padding-left:18px;padding-bottom:6px}
.ev{position:relative;padding:10px 0 12px;break-inside:avoid}.ev::before{content:"";position:absolute;left:-25px;top:16px;width:12px;height:12px;border-radius:50%;background:var(--c);box-shadow:0 0 0 4px #0b1020,0 0 14px var(--c)}
.ev h4{margin:4px 0 2px;font-size:15.5px}.ev .p{font-size:12px;color:#9aa3bd;font-variant-numeric:tabular-nums;margin-left:8px}.ev p{margin:2px 0 0;font-size:13.5px;color:#c3c9dc}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.tag{font-size:11.5px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:#d5daea}
.sk{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.sg{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px}
.sg b{display:block;font-size:13px;color:#a5b4fc;margin-bottom:8px}.sg .tag{font-size:12.5px;padding:4px 10px}
.foot{margin-top:40px;font-size:11px;color:#6b7493;text-align:center}
@media(max-width:560px){.year{grid-template-columns:1fr}.y{padding:0 0 4px}.hero{padding-top:40px}}
@media print{body{background:#0b1020}@page{size:A4;margin:10mm}.hero{padding-top:24px}}`;
  const years = new Map<string, Row[]>();
  for (const r of rows) years.set(r.e.start_day.slice(0, 4), [...(years.get(r.e.start_day.slice(0, 4)) ?? []), r]);
  const ev = (r: Row) => {
    const { lead } = splitBody(r.e.polished.trim() || r.e.raw.trim());
    const line = r.line || lead;
    return `<div class="ev" style="--c:${KIND_COLOR[r.e.kind]}"><span class="pill">${esc(kindLabel(r.e.kind))}</span><span class="p">${esc(careerPeriod(r.e))}</span><h4>${esc(r.e.title)}</h4>${
      line ? `<p>${esc(line)}</p>` : ""
    }${r.e.skills.length ? `<div class="tags">${chips(r.e.skills, "tag")}</div>` : ""}</div>`;
  };
  return `${head(css)}<body><header class="hero"><div class="wrap">
${o.name ? `<p class="name">${esc(o.name)}</p>` : ""}<h1>${esc(v.headline || "커리어 한눈에 보기")}</h1>${v.summary ? `<p class="sum">${esc(v.summary)}</p>` : ""}
<div class="tiles">${st.map((s) => `<div class="tile"><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join("")}</div>
</div></header><main class="wrap">
${hl.length ? `<h2>HIGHLIGHTS</h2><div class="hl">${hl.map((h, i) => `<div class="card" style="--c:${KIND_COLOR[h.row.e.kind]}"><span class="n">0${i + 1}</span><span class="pill">${esc(kindLabel(h.row.e.kind))}</span><h3>${esc(h.row.e.title)}</h3><p>${esc(h.why || h.row.line)}</p><small>${esc(careerPeriod(h.row.e))}</small></div>`).join("")}</div>` : ""}
<h2>TIMELINE</h2>${[...years].map(([y, list]) => `<section class="year"><div class="y">${esc(y)}</div><div class="line">${list.map(ev).join("")}</div></section>`).join("")}
${v.skill_groups.length ? `<h2>SKILLS</h2><div class="sk">${v.skill_groups.map((g) => `<div class="sg"><b>${esc(g.name)}</b><div class="tags">${chips(g.skills, "tag")}</div></div>`).join("")}</div>` : ""}
<p class="foot">DREAM 커리어 기록으로 만들었어요 · ${esc(o.made)}</p>
</main></body></html>`;
}
