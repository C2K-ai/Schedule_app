// DREAM 일기 여닫기 연출 엔진 — 프레임워크 없이 root 안에만 그린다(document id 없음, 모듈 전역은 무늬 캐시뿐).
// render(t) 는 시간만 보고 그린다: seek(ms) 로 아무 장면이나 늘 똑같이 볼 수 있다.
// 펼치기: 덮인 책 → 표지가 왼쪽 책등 축으로 열림 → 촤라락 + 금빛 → 오른쪽 종이가 앞으로 나와 일기 종이가 된다.
// 덮기: 종이가 오른쪽 페이지로 작아짐 → 남은 장이 촤라락 왼쪽으로 → 뒷표지가 넘어와 덮이며 DIARY → 잠깐 머물다 앱으로.

import { coverArt, makeDither, makeLeather, makeSprites, MOON_40, type Sprites } from "./art";
import { CSS } from "./css";
import {
  DEG,
  clamp,
  clamp01,
  expLerp,
  f2,
  inCarry,
  inOutCubic,
  inOutSine,
  lerp,
  mulberry32,
  outCubic,
  outQuart,
  outSine,
  ramp,
  smooth,
  span,
} from "./math";
import { startSound, type Voice } from "./sound";
import { CLOSE, OPEN, REDUCED_MS, leafPlan, type LeafPlan } from "./timeline";

export type DiaryIntroMode = "open" | "close";

/** 진짜 일기 종이(DiarySheet)의 자리 — 화면 px, 스크롤 0 기준 */
export interface PaperMetrics {
  /** 쓰는 칸(.diary-col) 왼쪽·너비 */
  colX: number;
  colW: number;
  /** 줄 간격(--gap: 폰 32, 넓으면 36) */
  gap: number;
  /** 머리글 줄(초승달 DIARY) 가운데 y, 글자 크기 */
  eyebrowMid: number;
  eyebrowSize: number;
  /** 날짜(h1.diary-date) 위 y, 글자 크기 */
  dateTop: number;
  dateSize: number;
  /** 금색 가로줄(.diary-hrule) 위 y */
  hruleTop: number;
  /** 첫 줄(기분 줄의 밑줄) y — 그 아래로 gap 마다 줄 */
  firstRule: number;
  /** 글 칸(.diary-lines) 위 y, 글자 크기 */
  textTop: number;
  bodySize: number;
  /** 줄이 끝나는 y(글 칸 바닥) */
  rulesBottom: number;
}

export interface DiaryIntroOptions {
  mode: DiaryIntroMode;
  reducedMotion: boolean;
  sound: boolean;
  /** 끝 장면 종이에 쓸 날짜(오늘) */
  date: Date;
  /** 끝났을 때(또는 건너뛰었을 때) 한 번 */
  onDone: () => void;
  /** 진짜 종이에서 잰 자리(있으면 그 값, 없으면 globals.css 와 같은 식으로 계산) */
  paper?: Partial<PaperMetrics> | (() => Partial<PaperMetrics> | null | undefined) | null;
  /** 눌러서·Esc/Enter/Space 로 건너뛰기(기본 켬) */
  interactive?: boolean;
  /** 덮기: 연출이 화면을 다 가린 순간 한 번 — 밑의 일기 화면을 숨겨 끝에 앱이 비쳐 보이게 */
  onCovered?: () => void;
}

export interface DiaryIntro {
  play(): void;
  seek(ms: number): void;
  skip(): void;
  readonly duration: number;
  destroy(): void;
}

/** globals.css(.diary-*)·DiarySheet 의 자리를 같은 식으로 계산 — 끝 장면이 진짜 종이와 겹치게 */
export function defaultPaperMetrics(vw: number, vh: number): PaperMetrics {
  const wide = vw >= 700; // --gap 36, 큰 글자(@media 700px)
  const md = vw >= 768; // 위 여백·기분 단추 크기(tailwind md)
  const gap = wide ? 36 : 32;
  const colW = Math.min(860, vw * 0.86);
  const top = md ? 78 : 62;
  const dateSize = wide ? 27 : 23;
  const dateTop = top + 30 + 4; // 머리글 줄(30px) + mt-1
  const hruleTop = dateTop + dateSize * 1.5 + 14; // 줄 높이 1.5 + mt-3.5
  const moodRow = Math.max(gap, (md ? 36 : 32) + 1); // 기분 줄: 최소 gap, 단추 + 밑줄 1px
  const firstRule = hruleTop + 1.5 + 2 + moodRow - 1;
  const textTop = firstRule + 1;
  return {
    colX: (vw - colW) / 2,
    colW,
    gap,
    eyebrowMid: top + 15,
    eyebrowSize: wide ? 13 : 12,
    dateTop,
    dateSize,
    hruleTop,
    firstRule,
    textTop,
    bodySize: wide ? 18 : 16.5,
    rulesBottom: textTop + Math.max(gap * 8, vh - 330),
  };
}

/* ─────────── 상수 ─────────── */
const LEAF_CURL = 56;
const LEAF_BOW = 34;
const ASPECT = 0.72;
const TH_C = 38;
const TH_O = 48;
const YAW_C = -7;
const LIGHT = (() => {
  const v = [-0.38, -0.32, 0.87], l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
const WEEK = "일월화수목금토";
/** 한 프레임에 시계가 나아가는 최대 시간 — 폰이 잠깐 멈춰도 장면을 건너뛰지 않고 이어서 그린다 */
const MAX_STEP = 50;

/* ─────────── 무늬·빛 조각 캐시(문서마다 한 번) — 누르는 순간 만드느라 멈칫하지 않게 ─────────── */
interface Tex {
  spr: Sprites;
  leather: string;
  dither: string;
}
const TEX = new WeakMap<Document, Tex>();
function textures(doc: Document): Tex {
  let t = TEX.get(doc);
  if (!t) {
    t = { spr: makeSprites(doc), leather: makeLeather(doc), dither: makeDither(doc) };
    TEX.set(doc, t);
  }
  return t;
}
/** 앱이 한가할 때 미리 만들어 둔다(DiaryIntro 의 preloadDiaryIntro 가 부름) */
export function warmDiaryIntro(doc: Document = document): void {
  try {
    textures(doc);
  } catch {
    /* 못 만들면 열 때 다시 */
  }
}

/* ─────────── 스타일 캐시: 값이 바뀔 때만 쓴다 ─────────── */
interface Box {
  el: HTMLElement;
  t: string | null;
  o: number;
  v: boolean | null;
}
const box = (el: HTMLElement): Box => ({ el, t: null, o: -1, v: null });
function setT(b: Box, v: string): void {
  if (b.t !== v) {
    b.el.style.transform = v;
    b.t = v;
  }
}
function setO(b: Box, v: number): void {
  const r = Math.round(v * 1000) / 1000;
  if (b.o !== r) {
    b.el.style.opacity = String(r);
    b.o = r;
  }
}
/** 부모가 숨으면 같이 숨게 'inherit' 만 쓴다(visible 로 덮어쓰지 않는다) */
function setV(b: Box, on: boolean): void {
  if (b.v !== on) {
    b.el.style.visibility = on ? "inherit" : "hidden";
    b.v = on;
  }
}
/** 통째로 그리지 않기(display:none) — 합성 층도 남지 않는다 */
function setOff(b: Box, off: boolean): void {
  if (b.v !== !off) {
    b.el.classList.toggle("is-off", off);
    b.v = !off;
  }
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Cam {
  zoom: number;
  fx: number;
  fy: number;
  fz: number;
  tilt: number;
  yaw: number;
  cx: number;
  cy: number;
  P: number;
}
interface Geo {
  vw: number;
  vh: number;
  narrow: boolean;
  PW: number;
  PH: number;
  rect: Rect;
  sq: number;
  W: number;
  H: number;
  Tb: number;
  Tp: number;
  thick: number;
  zC: number;
  zO: number;
  P: number;
  liftH: number;
  zA: number;
  dOut: number;
  dIn: number;
  unit: number;
  zLiftEnd: number;
  bgS: number;
  frS: number;
}
/** 한 장면의 빛 */
interface Light {
  cam: Cam;
  zR: number;
  zTop: number;
  leak: number;
  surf: number;
  rays: number;
  flash: number;
  out: number;
  amb: number;
  fadeAll: number;
  /** 책배 틈 빛이 새는 쪽(1 = 오른쪽, -1 = 왼쪽)과 높이 */
  side: number;
  zLeak: number;
}
interface Spark {
  kind: "dot" | "glint" | "bokeh";
  t0: number;
  u: number;
  v: number;
  life: number;
  vz: number;
  vx: number;
  vy: number;
  sway: number;
  sf: number;
  ph: number;
  size: number;
  a: number;
  tw: number;
}
interface Leak {
  t0: number;
  v: number;
  life: number;
  vx: number;
  vz: number;
  size: number;
  a: number;
  ph: number;
  tw: number;
}
interface Mote {
  layer: number;
  x: number;
  y: number;
  speed: number;
  sway: number;
  sf: number;
  ph: number;
  size: number;
  a: number;
  tw: number;
  glint: boolean;
}
interface Star {
  x: number;
  y: number;
  s: number;
  a: number;
  f: number;
  ph: number;
}
interface Ray {
  u: number;
  v: number;
  jitter: number;
  len: number;
  w: number;
  a: number;
  t0: number;
  f: number;
  ph: number;
  warm: boolean;
}
interface Particles {
  sparks: Spark[];
  leak: Leak[];
  ambient: Mote[];
  stars: Star[];
  rays: Ray[];
}
interface Strip {
  strip: Box;
  d0: Box;
  d1: Box;
  w0: Box;
  w1: Box;
}
interface LeafEl {
  leaf: Box;
  strips: Strip[];
  vis: boolean | null;
}

const PAGE_INNER = '<i class="hr"></i><i class="pr"></i>';

function coverFace(cls: string): string {
  return `<div class="w di-cface ${cls}">
    <i class="co-leather"></i><i class="co-groove"></i>
    <i class="co-art co-deboss"></i><i class="co-art co-lip"></i><i class="co-gold"></i>
    <i class="co-holo"><b class="h1"></b><b class="h2"></b></i>
    <i class="co-art co-spec"><b></b></i>
    <i class="co-gloss"><b></b></i>
    <i class="co-vig"></i><i class="co-shade"></i>
  </div>`;
}

function template(mode: DiaryIntroMode): string {
  const open = mode === "open";
  const moon = `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="${MOON_40}" fill="#c4943f"/></svg>`;
  return `<style>${CSS}</style>
<div class="di-stage">
  <div class="di-warm"></div>
  <canvas class="di-cv di-cv-bg"></canvas>
  <div class="di-scene"><div class="di-world">
    <div class="w di-floor"></div>
    <div class="w di-floor-glow"></div>
    <div class="w di-shadow" data-k="shadowR"></div>
    <div class="w di-shadow" data-k="shadowL"></div>
    <div class="w di-rib di-rib-floor"></div>
    <div class="w p3 di-book">
      ${open ? `<div class="w di-board"></div><div class="w di-board-edge"><i class="rib di-rib" style="filter:brightness(.8)"></i></div><div class="w di-rib di-rib-sq"></div>` : ""}
      <div class="w di-pg r" data-k="pageR">${PAGE_INNER}<i class="gut-l"></i><i class="cast"></i><i class="pglow"></i></div>
      <div class="w di-pedge" data-k="edgeR"><i class="rib di-rib"></i><i class="lit"></i></div>
      <div class="w di-pg l" data-k="pageL">${PAGE_INNER}<i class="gut-r"></i><i class="cast"></i><i class="pglow"></i></div><div class="w di-pedge" data-k="edgeL"><i class="lit"></i></div>
      <div class="w di-liftshadow"></div>
      <div class="w di-pg lift" data-k="lift">${PAGE_INNER}<i class="gut-l"></i><i class="pglow"></i></div>
      <div class="w p3 di-leaves"></div>
      <div class="w p3 di-cover">
        ${coverFace("di-cout")}
        <div class="w di-cface di-cin"><i class="ci-paper"></i><i class="ci-gut"></i><i class="ci-warm"></i><i class="ci-shade"></i></div>
        <div class="w di-cedge-n"><i class="lit"></i></div>
        <div class="w di-cedge-f"><i class="lit"></i></div>
      </div>
      ${
        open
          ? ""
          : `<div class="w p3 di-bcover">${coverFace("di-back")}<div class="w di-cface di-bin"><i class="ci-paper"></i><i class="ci-gut"></i><i class="ci-warm"></i><i class="ci-shade"></i></div><div class="w di-bedge-n"></div><div class="w di-bedge-f"></div></div>`
      }
    </div>
  </div></div>
  <div class="di-vignette"></div>
  <div class="di-dither"></div>
</div>
<div class="di-sheet-shadow"></div>
<div class="di-sheet"><div class="di-sheet-in">
  <div class="di-paper"></div>
  <i class="di-rules"></i>
  <i class="di-hrule"></i>
  <div class="di-head"><div class="di-eyebrow">${moon}<span>Diary</span></div><div class="di-date"></div></div>
  <div class="di-ph"><span>오늘 하루를 적어 보세요</span></div>
</div></div>
<div class="di-front"><canvas class="di-cv di-cv-front"></canvas><div class="di-veil"></div></div>`;
}

/** 일기 여닫기 연출을 root 안에 만든다. root 는 화면을 덮는 자리(position 이 있는 요소)여야 한다 */
export function createDiaryIntro(root: HTMLElement, opts: DiaryIntroOptions): DiaryIntro {
  const doc = root.ownerDocument;
  const win: Window = doc.defaultView ?? window;
  const mode = opts.mode;
  const isOpen = mode === "open";
  const reduced = !!opts.reducedMotion;
  const END = reduced ? REDUCED_MS : isOpen ? OPEN.end : CLOSE.end;
  // 폰·태블릿(좁거나 터치)은 가볍게: 반짝이·먼지 없음, 장·띠 조금 적게, 뒤 캔버스 작게, 표지 무지개 박은 멈춰 둠 — 3D 조각·다시 칠하기가 적을수록 덜 끊긴다
  const narrow0 = (root.clientWidth || win.innerWidth) < 640;
  const mobile = narrow0 || !!win.matchMedia?.("(pointer: coarse)").matches;
  const NS = mobile ? 6 : 10;
  const LEAF: LeafPlan | null = reduced
    ? null
    : isOpen
      ? leafPlan(mobile ? 6 : OPEN.leaves, OPEN.riffle)
      : leafPlan(mobile ? 5 : CLOSE.leaves, CLOSE.riffle);
  /** 폰: 장 그늘 투명도를 1/20 단위로 — 값이 그대로면 다시 칠하지 않는다 */
  const qo20 = (v: number) => (mobile ? Math.round(v * 20) / 20 : v);

  const wrap = doc.createElement("div");
  wrap.className = "di";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = template(mode);
  root.appendChild(wrap);

  const q = (s: string): HTMLElement => {
    const n = wrap.querySelector<HTMLElement>(s);
    if (!n) throw new Error(`diaryIntro: ${s}`);
    return n;
  };
  const qo = (s: string): HTMLElement | null => wrap.querySelector<HTMLElement>(s);
  const sub = (n: HTMLElement, s: string): Box => {
    const c = n.querySelector<HTMLElement>(s);
    if (!c) throw new Error(`diaryIntro: ${s}`);
    return box(c);
  };
  const B = (s: string): Box => box(q(s));

  const el = {
    wrap: box(wrap),
    stage: B(".di-stage"),
    warm: B(".di-warm"),
    vignette: B(".di-vignette"),
    world: B(".di-world"),
    veil: B(".di-veil"),
    floorGlow: B(".di-floor-glow"),
    shadowR: B('[data-k="shadowR"]'),
    shadowL: B('[data-k="shadowL"]'),
    ribFloor: B(".di-rib-floor"),
    book: B(".di-book"),
    pageR: B('[data-k="pageR"]'),
    edgeR: B('[data-k="edgeR"]'),
    lift: B('[data-k="lift"]'),
    liftShadow: B(".di-liftshadow"),
    cover: B(".di-cover"),
    sheet: B(".di-sheet"),
    sheetIn: B(".di-sheet-in"),
    sheetShadow: B(".di-sheet-shadow"),
    head: B(".di-head"),
    ph: B(".di-ph"),
    front: B(".di-front"),
  };
  const cout = q(".di-cout");
  const cin = q(".di-cin");
  const co = {
    shade: sub(cout, ".co-shade"),
    holo1: sub(cout, ".co-holo > .h1"),
    holo2: sub(cout, ".co-holo > .h2"),
    spec: sub(cout, ".co-spec > b"),
    gloss: sub(cout, ".co-gloss > b"),
    ciShade: sub(cin, ".ci-shade"),
    ciWarm: sub(cin, ".ci-warm"),
    edgeNLit: sub(q(".di-cedge-n"), ".lit"),
    edgeFLit: sub(q(".di-cedge-f"), ".lit"),
  };
  const pR = { glow: sub(el.pageR.el, ".pglow"), cast: sub(el.pageR.el, ".cast"), lit: sub(el.edgeR.el, ".lit") };
  const pLift = { glow: sub(el.lift.el, ".pglow"), gut: sub(el.lift.el, ".gut-l") };
  const pageLEl = qo('[data-k="pageL"]');
  const edgeLEl = qo('[data-k="edgeL"]');
  const pL =
    pageLEl && edgeLEl
      ? { page: box(pageLEl), edge: box(edgeLEl), glow: sub(pageLEl, ".pglow"), cast: sub(pageLEl, ".cast"), lit: sub(edgeLEl, ".lit") }
      : null;
  // 덮기: 뒷표지(판 + 안쪽 면지 + 바깥 DIARY)가 한 덩어리로 책등 축을 돈다
  const bcEl = qo(".di-bcover");
  const backEl = qo(".di-back");
  const binEl = qo(".di-bin");
  const back =
    bcEl && backEl && binEl
      ? {
          group: box(bcEl),
          shade: sub(backEl, ".co-shade"),
          holo1: sub(backEl, ".co-holo > .h1"),
          holo2: sub(backEl, ".co-holo > .h2"),
          spec: sub(backEl, ".co-spec > b"),
          gloss: sub(backEl, ".co-gloss > b"),
          inShade: sub(binEl, ".ci-shade"),
          inWarm: sub(binEl, ".ci-warm"),
        }
      : null;
  const cvBg = q(".di-cv-bg") as HTMLCanvasElement;
  const cvFr = q(".di-cv-front") as HTMLCanvasElement;
  const gBg = cvBg.getContext("2d");
  const gFr = cvFr.getContext("2d");
  const dateEl = q(".di-date");

  /* 날짜 — DiarySheet 와 같은 꼴: 2026년 10월 8일 (목) */
  const date = opts.date instanceof Date && !isNaN(opts.date.getTime()) ? opts.date : new Date();
  dateEl.textContent = `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 `;
  const wd = doc.createElement("span");
  wd.textContent = `(${WEEK[date.getDay()]})`;
  dateEl.appendChild(wd);

  /* 넘어가는 장: 장마다 띠 NS 개를 겹겹이 */
  const leaves: LeafEl[] = [];
  const leavesHost = qo(".di-leaves");
  if (LEAF && leavesHost) {
    for (let i = 0; i < LEAF.n; i++) {
      const leaf = doc.createElement("div");
      leaf.className = "w p3 di-leaf";
      let parent: HTMLElement = leaf;
      const strips: Strip[] = [];
      for (let s = 0; s < NS; s++) {
        const strip = s === 0 ? leaf : doc.createElement("div");
        if (s > 0) {
          strip.className = "di-strip";
          parent.appendChild(strip);
        }
        const face = doc.createElement("div");
        face.className = "di-sface" + (s === NS - 1 ? " tip" : "");
        face.innerHTML = `${PAGE_INNER}${s === 0 ? '<i class="gut-l"></i>' : ""}<i class="d0"></i><i class="d1"></i><i class="w0"></i><i class="w1"></i>`;
        for (const c of [".pr", ".hr"]) {
          const n = face.querySelector<HTMLElement>(c);
          if (n) {
            n.style.left = `calc(var(--sw) * ${-s})`;
            n.style.width = "var(--PW)";
          }
        }
        strip.insertBefore(face, strip.firstChild);
        strips.push({ strip: box(strip), d0: sub(face, ".d0"), d1: sub(face, ".d1"), w0: sub(face, ".w0"), w1: sub(face, ".w1") });
        parent = strip;
      }
      leavesHost.appendChild(leaf);
      leaves.push({ leaf: box(leaf), strips, vis: null });
    }
  }

  /* 무늬·빛 조각(문서마다 한 번 만들어 둔 것) */
  let SPR: Sprites | null = null;
  if (!reduced) {
    try {
      const tx = textures(doc);
      SPR = tx.spr;
      wrap.style.setProperty("--di-leather", `url(${tx.leather})`);
      wrap.style.setProperty("--di-dither", `url(${tx.dither})`);
    } catch {
      SPR = null;
    }
  }

  /* ─────────── 자리 잡기: 모든 크기는 화면과 종이 자리에서 나온다 ─────────── */
  let G: Geo | null = null;
  let PART: Particles | null = null;
  function readPaper(vw: number, vh: number): PaperMetrics {
    const base = defaultPaperMetrics(vw, vh);
    let over: Partial<PaperMetrics> | null | undefined = null;
    try {
      over = typeof opts.paper === "function" ? opts.paper() : opts.paper;
    } catch {
      over = null;
    }
    if (!over) return base;
    const out = { ...base };
    for (const k of Object.keys(base) as (keyof PaperMetrics)[]) {
      const v = over[k];
      if (typeof v === "number" && isFinite(v)) out[k] = v;
    }
    return out;
  }

  function layout(): void {
    const vw = Math.max(1, root.clientWidth || win.innerWidth), vh = Math.max(1, root.clientHeight || win.innerHeight);
    const narrow = vw < 640;
    const m = readPaper(vw, vh);
    // 들려 나온 오른쪽 페이지 = 이 화면 사각형(넘겨줄 때 1:1)
    const PW = 2 * Math.round(Math.min(vw * 0.86, vh * 0.74 * ASPECT) / 2);
    const PH = 2 * Math.round(PW / ASPECT / 2);
    const rect: Rect = { x: Math.round((vw - PW) / 2), y: Math.round((vh - PH) / 2), w: PW, h: PH };
    const sq = Math.max(3, Math.round(PW * 0.024));
    const W = PW + sq, H = PH + 2 * sq;
    const Tb = Math.max(2.5, f2(W * 0.018));
    const Tp = Math.max(10, Math.round(W * 0.095));
    const thick = 2 * Tb + Tp;
    // 카메라는 줄이기만(배율 ≤ 1) — 표지 글자·줄이 2~3배 화면에서도 또렷하다
    const zC = Math.min(1, (vw * 0.62) / W, (vh * 0.52) / (H * Math.cos(TH_C * DEG)));
    const zO = Math.min(1, (vw * 0.84) / (2 * W * 1.1), (vh * 0.42) / (H * Math.cos(TH_O * DEG)));
    const liftH = Math.round(PW * 0.12);
    const dpr = Math.min(win.devicePixelRatio || 1, 3);
    G = {
      vw,
      vh,
      narrow,
      PW,
      PH,
      rect,
      sq,
      W,
      H,
      Tb,
      Tp,
      thick,
      zC,
      zO,
      P: 3.2 * H * zO,
      liftH,
      zA: Tb + Tp / 2,
      dOut: Tb + Tp / 2,
      dIn: Tp / 2,
      unit: (W * zO) / 150,
      // 펼치기 끝 = 덮기 처음: 오른쪽 페이지 묶음이 0.45 남음
      zLiftEnd: Tb + Tp * 0.45 + 0.3 + liftH,
      // 캔버스는 화면 1배 이하(폰은 더 작게) — 빛·반짝이는 부드러워서 티가 안 나고, 매 프레임 넘기는 비용이 크게 준다
      // 폰: 뒤(별·빛줄기) 0.75배, 앞(빛·반짝임) 1배 — 0.5/0.6 은 깨져 보였다(사용자)
      bgS: mobile ? 0.75 : Math.min(dpr, 1),
      frS: Math.min(dpr, 1),
    };

    const px = (v: number) => `${f2(v)}px`;
    const rx = rect.x, ry = rect.y;
    const rulesTop = m.firstRule + 1 - m.gap;
    const rulesH = Math.max(0, m.rulesBottom - rulesTop);
    const vars: Record<string, string> = {
      "--W": px(W),
      "--H": px(H),
      "--PW": px(PW),
      "--PH": px(PH),
      "--sq": px(sq),
      "--Tb": px(Tb),
      "--Tp": px(Tp),
      "--thick": px(thick),
      "--vw": px(vw),
      "--vh": px(vh),
      "--sw": px(PW / NS),
      "--ov": px(Math.max(0.8, 1.3 / zO)),
      "--rw": px(Math.max(5, W * 0.026)),
      "--rx": px(Math.round(PW * 0.07)),
      "--rl": px(Math.round(H * 0.15)),
      "--gap": px(m.gap),
      "--col-x": px(m.colX),
      "--col-w": px(m.colW),
      "--rules-top": px(rulesTop),
      "--rules-h": px(rulesH),
      "--hrule-top": px(m.hruleTop),
      "--eb-top": px(m.eyebrowMid - m.eyebrowSize * 0.75),
      "--eb-size": px(m.eyebrowSize),
      "--date-top": px(m.dateTop),
      "--date-size": px(m.dateSize),
      "--ph-top": px(m.textTop + m.gap * 0.14),
      "--body-size": px(m.bodySize),
      // 책 속 페이지의 무늬·줄 = 끝 장면 종이의 같은 자리(오른쪽 페이지가 rect 에 놓이면 같은 픽셀)
      "--pg-bx": px(-rx),
      "--pg-by": px(-ry),
      "--pg-rx": px(Math.max(0, m.colX - rx)),
      "--pg-rw": px(Math.max(0, Math.min(PW, m.colX - rx + m.colW) - Math.max(0, m.colX - rx))),
      "--pg-rt": px(rulesTop - ry),
      "--pg-rh": px(rulesH),
      "--pg-ht": px(m.hruleTop - ry),
      "--di-dither-size": px(128 / dpr),
    };
    for (const key in vars) wrap.style.setProperty(key, vars[key]);
    const front = coverArt(W, H, "DREAM", date.getFullYear(), false);
    wrap.style.setProperty("--art-frame", front.frame);
    wrap.style.setProperty("--art-title", front.title);
    if (!isOpen) {
      const bk = coverArt(W, H, "DIARY", null, true);
      wrap.style.setProperty("--art-frame-b", bk.frame);
      wrap.style.setProperty("--art-title-b", bk.title);
    }

    // 움직이지 않는 자리(책 공간)
    const t3 = (x: number, y: number, z: number, extra = "") => `translate3d(${f2(x)}px,${f2(y)}px,${f2(z)}px) ${extra}`;
    const fixed = (s: string, v: string) => {
      const n = qo(s);
      if (n) n.style.transform = v;
    };
    fixed(".di-floor", t3(-W * 2.3 + W * 0.3, -H * 1.55 + H * 0.06, -0.6));
    fixed(".di-floor-glow", t3(-W * 2.1, -H * 1.3 + H * 0.04, -0.3));
    fixed(".di-board", t3(0, -H / 2, Tb));
    fixed(".di-board-edge", t3(0, H / 2, Tb, "rotateX(-90deg)"));
    fixed(".di-rib-sq", t3(Math.round(PW * 0.07), PH / 2, Tb + 0.25));
    fixed(".di-cout", `translateZ(${f2(G.dOut)}px)`);
    fixed(".di-cin", t3(W, 0, G.dIn, "rotateY(180deg)"));
    fixed(".di-cedge-n", t3(0, H, G.dOut, "rotateX(-90deg)"));
    fixed(".di-cedge-f", t3(W, 0, G.dOut, "rotateY(90deg)"));
    // 뒷표지 덩어리 안(책등 축 기준): 안쪽 면지는 위, 바깥 DIARY 는 아래를 보다가 넘어오면 위를 본다
    fixed(".di-bin", t3(0, 0, -G.dIn));
    fixed(".di-back", t3(W, 0, -G.dOut, "rotateY(180deg)"));
    fixed(".di-bedge-n", t3(0, H, -G.dIn, "rotateX(-90deg)"));
    fixed(".di-bedge-f", t3(W, 0, -G.dIn, "rotateY(90deg)"));
    fixed(".di-rib-floor", t3(Math.round(PW * 0.07), H / 2 - 0.6, 0.35, "rotateZ(7deg)"));

    // 캔버스: 뒤 = 화면 1배 이하, 앞(빛·반짝이) = 1.5배 이하
    for (const [c, s] of [
      [cvBg, G.bgS],
      [cvFr, G.frS],
    ] as const) {
      c.width = Math.round(vw * s);
      c.height = Math.round(vh * s);
    }
    PART = buildParticles(G);
    if (lite) trim(PART);
    for (const L of leaves) L.vis = null;
    fxClear = false;
  }

  /* 빛 조각 수는 화면 넓이·배율·코어 수에 맞춰(폰은 적게, 그래도 0 은 아님) */
  function buildParticles(g: Geo): Particles {
    const area = (g.vw * g.vh) / (1440 * 900);
    let k = clamp(0.35 + 0.65 * Math.sqrt(area), 0.55, 1);
    if ((win.devicePixelRatio || 1) >= 2.5) k *= 0.85;
    if ((win.navigator.hardwareConcurrency || 8) <= 4) k *= 0.8;
    const N = mobile
      ? { sparks: 0, leak: 10, ambient: 0, stars: 24, rays: 10 }
      : {
          sparks: Math.round((isOpen ? 300 : 110) * k),
          leak: Math.round((isOpen ? 30 : 26) * k),
          ambient: Math.round((isOpen ? 220 : 120) * k),
          stars: Math.round(80 * k),
          rays: isOpen ? 24 : 18,
        };
    const R = mulberry32(20261008);
    const sparks: Spark[] = [];
    for (let i = 0; i < N.sparks; i++) {
      const r = R(), kind: Spark["kind"] = r < 0.1 ? "glint" : r < 0.24 ? "bokeh" : "dot", side = R() < 0.5 ? -1 : 1;
      sparks.push({
        kind,
        t0: isOpen ? 560 + Math.pow(R(), 1.45) * 1250 : CLOSE.riffle[0] + Math.pow(R(), 1.2) * (CLOSE.riffle[1] - CLOSE.riffle[0]),
        u: side * Math.pow(R(), 0.75) * 0.95,
        v: (R() - 0.55) * 0.85,
        life: 0.9 + R() * 1.1,
        vz: 0.6 + R() * 1.3,
        vx: side * (0.05 + R() * 0.35) + (R() - 0.5) * 0.2,
        vy: (R() - 0.65) * 0.3,
        sway: 0.02 + R() * 0.05,
        sf: 2 + R() * 4,
        ph: R() * 6.28,
        size: kind === "bokeh" ? 14 + R() * 24 : kind === "glint" ? 15 + R() * 13 : 5 + R() * 8,
        a: kind === "bokeh" ? 0.3 + R() * 0.3 : 0.65 + R() * 0.35,
        tw: 6 + R() * 10,
      });
    }
    const leak: Leak[] = [];
    const [l0, l1] = isOpen ? [280, 700] : [CLOSE.back[0] + 300, CLOSE.back[1] - 20];
    for (let i = 0; i < N.leak; i++)
      leak.push({
        t0: l0 + R() * (l1 - l0),
        v: (R() - 0.5) * 0.9,
        life: 0.5 + R() * 0.6,
        vx: 0.12 + R() * 0.4,
        vz: 0.4 + R() * 0.8,
        size: 4 + R() * 7,
        a: 0.6 + R() * 0.4,
        ph: R() * 6.28,
        tw: 8 + R() * 8,
      });
    const ambient: Mote[] = [];
    const nFar = Math.round(N.ambient * 0.58), nMid = Math.round(N.ambient * 0.31);
    for (let i = 0; i < N.ambient; i++) {
      const layer = i < nFar ? 0 : i < nFar + nMid ? 1 : 2, gx = (R() + R() + R() - 1.5) / 1.5;
      ambient.push({
        layer,
        x: 0.5 + gx * (layer === 2 ? 0.62 : 0.48),
        y: R() * 0.95 - 0.05,
        speed: [0.025, 0.055, 0.11][layer] * (0.6 + R() * 0.8),
        sway: (0.004 + R() * 0.012) * (layer + 1),
        sf: 0.6 + R() * 1.4,
        ph: R() * 6.28,
        size: layer === 0 ? 3 + R() * 4 : layer === 1 ? 6 + R() * 8 : 26 + R() * 44,
        a: layer === 2 ? 0.12 + R() * 0.18 : 0.35 + R() * 0.55,
        tw: 2 + R() * 5,
        glint: layer === 1 && R() < 0.2,
      });
    }
    const stars: Star[] = [];
    for (let i = 0; i < N.stars; i++)
      stars.push({ x: R(), y: Math.pow(R(), 1.3) * 0.75, s: 1 + R() * 2.2, a: 0.15 + R() * 0.45, f: 0.0015 + R() * 0.004, ph: R() * 6.28 });
    const rays: Ray[] = [];
    for (let i = 0; i < N.rays; i++)
      rays.push({
        u: (R() * 2 - 1) * 0.8,
        v: -0.05 - R() * 0.4,
        jitter: (R() - 0.5) * 0.22,
        len: 0.75 + R() * 0.55,
        w: 0.12 + R() * 0.38,
        a: 0.22 + R() * 0.42,
        t0: isOpen ? OPEN.burst[0] + R() * 360 : CLOSE.glowIn[0] + R() * 300,
        f: 0.004 + R() * 0.006,
        ph: R() * 6.28,
        warm: R() < 0.5,
      });
    return { sparks, leak, ambient, stars, rays };
  }
  /** 느린 폰: 빛 조각을 절반으로(같은 조각에서 덜어내 화면이 튀지 않게), 큰 보케는 뺀다 */
  let lite = false;
  function trim(P: Particles): void {
    P.sparks = P.sparks.filter((_, i) => i % 2 === 0);
    P.leak = P.leak.filter((_, i) => i % 2 === 0);
    P.ambient = P.ambient.filter((p, i) => p.layer !== 2 && i % 2 === 0);
    P.stars = P.stars.filter((_, i) => i % 2 === 0);
  }

  /* ─────────── 카메라: CSS 변환 + 캔버스용으로 똑같이 계산 ─────────── */
  /** pO: 덮인 자세 0 → 펼친 자세 1, pL: 들린 페이지에 1:1 로 붙음, zMul: 잠깐 물러서기 */
  /** side: 덮인 책이 책등 오른쪽(1, 처음 모습) / 왼쪽(-1, 뒷표지로 덮인 끝 모습) */
  function camera(g: Geo, pO: number, pLf: number, drift: number, zMul: number, side = 1): Cam {
    let zoom = Math.min(1, expLerp(g.zC, g.zO, pO) * (0.975 + 0.025 * drift) * zMul);
    let fx = lerp(side * g.W * 0.5, 0, pO), fy = lerp(0, -g.H * 0.04, pO), fz = lerp(g.thick, g.Tb + g.Tp * 0.6, pO);
    let tilt = lerp(TH_C, TH_O, pO), yaw = lerp(YAW_C, 0, pO);
    let ccx = g.vw / 2, ccy = g.vh * lerp(0.5, g.narrow ? 0.6 : 0.585, pO);
    zoom = expLerp(zoom, 1, pLf);
    fx = lerp(fx, g.PW / 2, pLf);
    fy = lerp(fy, 0, pLf);
    fz = lerp(fz, g.zLiftEnd, pLf);
    tilt = lerp(tilt, 0, pLf);
    yaw = lerp(yaw, 0, pLf);
    ccx = lerp(ccx, g.rect.x + g.PW / 2, pLf);
    ccy = lerp(ccy, g.rect.y + g.PH / 2, pLf);
    return { zoom, fx, fy, fz, tilt, yaw, cx: ccx, cy: ccy, P: g.P };
  }
  const camCSS = (c: Cam) =>
    `translate(${f2(c.cx)}px,${f2(c.cy)}px) perspective(${f2(c.P)}px) rotateX(${c.tilt.toFixed(3)}deg) scale3d(${c.zoom.toFixed(5)},${c.zoom.toFixed(5)},${c.zoom.toFixed(5)}) rotateZ(${c.yaw.toFixed(3)}deg) translate3d(${f2(-c.fx)}px,${f2(-c.fy)}px,${f2(-c.fz)}px)`;
  function project(c: Cam, x: number, y: number, z: number) {
    const X = x - c.fx, Y = y - c.fy, Z = z - c.fz;
    const cyw = Math.cos(c.yaw * DEG), syw = Math.sin(c.yaw * DEG);
    const X1 = (X * cyw - Y * syw) * c.zoom, Y1 = (X * syw + Y * cyw) * c.zoom, Z1 = Z * c.zoom;
    const ct = Math.cos(c.tilt * DEG), st = Math.sin(c.tilt * DEG);
    const Y2 = Y1 * ct - Z1 * st, Z2 = Y1 * st + Z1 * ct;
    const w = 1 - Z2 / c.P;
    return { x: c.cx + X1 / w, y: c.cy + Y2 / w, k: 1 / w, w };
  }

  /* ─────────── 표지·장의 각도 ─────────── */
  function coverAngleOpen(t: number): number {
    const [a, b] = OPEN.cover;
    if (t <= a) return 0;
    if (t < b) return -180 * Math.pow((t - a) / (b - a), 2.4); // 천천히 들리다 세로를 빨리 지나 내려앉는다
    const d = t - b;
    if (d < 130) return -180 + 4 * Math.sin((Math.PI * d) / 130);
    if (d < 220) return -180 + Math.sin((Math.PI * (d - 130)) / 90);
    return -180;
  }
  /** 덮기: 뒷표지가 천천히 들려 세로를 지나 왼쪽 묶음 위로 내려앉는다(살짝 튕김) */
  function backAngle(t: number): number {
    const [a, b] = CLOSE.back;
    if (t <= a) return 0;
    if (t < b) return -180 * Math.pow((t - a) / (b - a), 2.1);
    const d = t - b;
    if (d < 120) return -180 + 3.5 * Math.sin((Math.PI * d) / 120);
    if (d < 200) return -180 + 0.8 * Math.sin((Math.PI * (d - 120)) / 80);
    return -180;
  }
  const lambert = (nx: number, nz: number) => Math.max(0, nx * LIGHT[0] + nz * LIGHT[2]);
  /** 면이 빛을 덜 받는 만큼 그늘(0~1) */
  const shadeOf = (nx: number, nz: number) => clamp01((LIGHT[2] - lambert(nx, nz)) / LIGHT[2]);
  function leafDark(theta: number): number {
    const r = theta * DEG;
    let nx = Math.sin(r), nz = Math.cos(r);
    if (nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    return shadeOf(nx, nz) * 0.55;
  }
  const leafP = (i: number, t: number) => (LEAF ? ramp(t, LEAF.starts[i], LEAF.starts[i] + LEAF.durs[i]) : 0);

  /* ─────────── 공통 조각 ─────────── */
  const t3 = (x: number, y: number, z: number, extra = "") => `translate3d(${f2(x)}px,${f2(y)}px,${f2(z)}px) ${extra}`;

  function coverAt(g: Geo, ca: number, sheenP: number, open: number, leak: number, surf: number, extraAngle: number): void {
    setT(el.cover, `translate3d(0px,${f2(-g.H / 2)}px,${f2(g.zA)}px) rotateY(${ca.toFixed(2)}deg)`);
    const a = (ca + extraAngle) * DEG;
    setO(co.shade, shadeOf(Math.sin(a), Math.cos(a)) * 0.7);
    setO(co.ciShade, shadeOf(-Math.sin(ca * DEG), -Math.cos(ca * DEG)) * 0.42 * (1 - leak));
    setO(co.ciWarm, Math.min(1, leak * 0.75 + surf * 0.85));
    setO(co.edgeNLit, leak * 0.85 + surf * 0.2);
    setO(co.edgeFLit, leak * 0.9);
    if (mobile) {
      // 폰: 박 위를 지나가는 빛은 멈춰 둔다(표지 면을 매 프레임 다시 칠하지 않게)
      sheenP = 0.55;
      open = 0;
    }
    const sc = lerp(0.2, 1.3, sheenP);
    setT(co.gloss, `translateX(${f2((sc / 0.72 - 0.5) * 100)}%) skewX(-20deg)`);
    setT(co.spec, `translateX(${f2((sc / 0.34 - 0.5) * 100)}%) skewX(-20deg)`);
    setT(co.holo1, `translateX(${f2(-(10 + 12 * sheenP + 9 * open))}%)`);
    setT(co.holo2, `translateX(${f2(-(36 - 16 * sheenP - 8 * open))}%)`);
  }

  /** 종이(화면 크기)를 rect 에서 화면 전체 사이로 — e=0 이면 들린 페이지 자리, 1 이면 화면 가득 */
  function sheetAt(g: Geo, e: number, alpha: number, shadow: number): void {
    setV(el.sheet, alpha > 0);
    setV(el.sheetShadow, alpha > 0 && shadow > 0.003);
    if (alpha <= 0) return;
    if (e >= 1) {
      setT(el.sheet, "none");
      setT(el.sheetShadow, "none");
      setT(el.sheetIn, "none");
    } else {
      const R = g.rect;
      const x = lerp(R.x, 0, e), y = lerp(R.y, 0, e);
      const sx = lerp(R.w, g.vw, e) / g.vw, sy = lerp(R.h, g.vh, e) / g.vh;
      const outer = `translate(${f2(x)}px,${f2(y)}px) scale(${sx.toFixed(5)},${sy.toFixed(5)})`;
      setT(el.sheet, outer);
      setT(el.sheetShadow, outer);
      setT(el.sheetIn, `scale(${(1 / sx).toFixed(5)},${(1 / sy).toFixed(5)}) translate(${f2(-x)}px,${f2(-y)}px)`);
    }
    setO(el.sheet, alpha);
    setO(el.sheetShadow, alpha * shadow);
  }
  function textAt(p: number): void {
    setO(el.head, p);
    setT(el.head, p >= 1 ? "none" : `translateY(${f2((1 - p) * 6)}px)`);
    setO(el.ph, p);
  }

  /* ─────────── 그리기(시간만 보고) ─────────── */
  let fxClear = false;
  function render(tIn: number): void {
    const g = G;
    if (!g) return;
    const t = clamp(tIn, 0, END);
    if (reduced) return renderReduced(t);
    if (isOpen) renderOpen(g, t);
    else renderClose(g, t);
  }

  function renderReduced(t: number): void {
    const p = inOutSine(ramp(t, 0, REDUCED_MS));
    setOff(el.stage, true);
    setV(el.sheet, false);
    setV(el.sheetShadow, false);
    setO(el.veil, isOpen ? 1 - p : p);
    setO(el.wrap, 1);
  }

  /** 넘어가는 장들 — 오른쪽 묶음(zR)에서 왼쪽 묶음(zL)으로. 페이지에 드리우는 그늘을 돌려준다 */
  function leavesAt(t: number, zR: number, zL: number, surf: number, pgL: number): { r: number; l: number } {
    const g = G;
    let castR = 0, castL = 0;
    if (!g) return { r: 0, l: 0 };
    const { PH, Tp } = g;
    const wts: number[] = [];
    let wsum = 0;
    for (let s = 1; s < NS; s++) {
      const ww = Math.pow(s / NS, 1.25);
      wts.push(ww);
      wsum += ww;
    }
    for (let i = 0; i < leaves.length; i++) {
      const L = leaves[i], qv = leafP(i, t), vis = qv > 0 && qv < 1;
      if (L.vis !== vis) {
        setV(L.leaf, vis);
        L.vis = vis;
      }
      if (!vis) continue;
      const e = inOutCubic(qv);
      const c = -LEAF_CURL * Math.sin(2 * Math.PI * qv) * (1 - 0.2 * qv) + LEAF_BOW * Math.sin(Math.PI * qv);
      const rootA = clamp(-180 * e - c * 0.5, -180, 0);
      const cEff = clamp(c, -180 - rootA, -rootA); // 페이지 묶음 아래로는 휘지 않는다
      const z = lerp(zR + 0.6, zL + 0.5, e) + Math.sin(Math.PI * qv) * Tp * 0.1 + i * 0.03;
      setT(L.leaf, `translate3d(0px,${f2(-PH / 2)}px,${f2(z)}px) rotateY(${f2(rootA)}deg)`);
      const ang = [rootA];
      let acc = rootA;
      for (let s = 1; s < NS; s++) {
        const bend = (cEff * wts[s - 1]) / wsum;
        acc += bend;
        ang.push(acc);
        setT(L.strips[s].strip, `rotateY(${f2(bend)}deg)`);
      }
      // 관절 값을 이웃 띠와 나눠 가져서(Gouraud) 꺾인 자국이 안 보인다 — 투명도만 바꾼다
      const jd: number[] = [], jw: number[] = [];
      for (let j = 0; j <= NS; j++) {
        const th = j <= 0 ? ang[0] : j >= NS ? ang[NS - 1] : (ang[j - 1] + ang[j]) / 2;
        const u = j / NS, up = Math.abs(Math.sin(th * DEG));
        jd.push(leafDark(th) * (1 - 0.5 * surf));
        jw.push(Math.min(0.9, Math.max(pgL, 0.25) * (0.85 * Math.exp(-1.6 * u) + 0.28 * up)));
      }
      for (let s = 0; s < NS; s++) {
        const st = L.strips[s];
        setO(st.d0, qo20(jd[s]));
        setO(st.d1, qo20(jd[s + 1]));
        setO(st.w0, qo20(jw[s]));
        setO(st.w1, qo20(jw[s + 1]));
      }
      const mid = -(rootA + cEff * 0.5), sm = Math.sin(mid * DEG);
      castR += 0.26 * sm * clamp01((125 - mid) / 50);
      castL += 0.22 * sm * clamp01((mid - 55) / 50);
    }
    return { r: castR, l: castL };
  }

  function renderOpen(g: Geo, t: number): void {
    const { PW, PH, Tb, Tp } = g;
    const pO = inOutCubic(span(t, OPEN.pan));
    const pl = span(t, OPEN.lift);
    const cam = camera(g, pO, inOutCubic(pl), outSine(ramp(t, 0, OPEN.lift[0])), 1);
    const ca = coverAngleOpen(t), open = clamp01(-ca / 180);
    let moved = 0;
    for (let i = 0; i < leaves.length; i++) moved += inOutCubic(leafP(i, t));
    const rp = leaves.length ? moved / leaves.length : 0;
    const rf = 1 - 0.55 * rp, lf = 0.55 * rp;
    const zR = Tb + Tp * rf, zL = Tb + Math.max(0.8, Tp * lf);
    const out = 1 - smooth(span(t, OPEN.lightOut));
    const burst = smooth(span(t, OPEN.burst));
    const flash = Math.exp(-Math.pow((t - OPEN.flash) / 150, 2)) * out;
    const leak = smooth(ramp(open, 0.02, 0.15)) * (1 - smooth(ramp(open, 0.55, 0.92))) * out;
    const surf = Math.max(smooth(ramp(open, 0.35, 0.95)) * 0.6, burst) * out;
    const rays = burst * out;
    const sheetDone = t >= OPEN.sheet[1];

    setO(el.wrap, 1 - smooth(span(t, OPEN.dissolve)));
    setOff(el.stage, sheetDone);
    setO(el.veil, (1 - smooth(span(t, OPEN.veil))) * OPEN.veilFrom);

    if (!sheetDone) {
      setT(el.world, camCSS(cam));
      coverAt(g, ca, inOutSine(span(t, OPEN.sheen)), open, leak, surf, 0);

      /* 넘어가는 장(넘어가는 동안만 보인다) */
      const pgL = Math.min(1, surf * 0.95 + flash * 0.3);
      const car = ca * DEG;
      const lc = leavesAt(t, zR, zL, surf, pgL);
      const castR = 0.32 * Math.sin(-car) * clamp01((ca + 125) / 50) + lc.r, castL = lc.l;

      /* 페이지 묶음 */
      const firstLanded = !!LEAF && t >= LEAF.starts[0] + LEAF.durs[0];
      setT(el.pageR, `translate3d(0px,${f2(-PH / 2)}px,${f2(zR)}px)`);
      setT(el.edgeR, `translate3d(0px,${f2(PH / 2)}px,${f2(zR)}px) rotateX(-90deg) scaleY(${rf.toFixed(4)})`);
      const pg = Math.min(1, surf * 0.95 + flash * 0.3);
      setO(pR.glow, pg);
      setO(pR.cast, clamp01(castR));
      setO(pR.lit, leak * 0.7 + surf * 0.45);
      if (pL) {
        setV(pL.page, firstLanded);
        setV(pL.edge, firstLanded);
        setT(pL.page, `translate3d(${-PW}px,${f2(-PH / 2)}px,${f2(zL)}px)`);
        setT(pL.edge, `translate3d(${-PW}px,${f2(PH / 2)}px,${f2(zL)}px) rotateX(-90deg) scaleY(${Math.max(0.001, (zL - Tb) / Tp).toFixed(4)})`);
        setO(pL.glow, pg);
        setO(pL.cast, clamp01(castL));
        setO(pL.lit, surf * 0.45);
      }
      setO(el.floorGlow, Math.min(1, surf * 0.85 + leak * 0.35 + flash * 0.2));
      shadowsAt(g, clamp01(-Math.cos(ca * DEG)), 1);

      /* 들리는 페이지: 끝이 살짝 들리며 떠오르고, 카메라가 그 위에 1:1 로 내려앉는다 */
      const liftOn = t >= OPEN.lift[0];
      setV(el.lift, liftOn);
      setV(el.liftShadow, liftOn);
      if (liftOn) {
        const le = inOutCubic(pl);
        const peel = -9 * Math.sin(Math.PI * Math.pow(ramp(pl, 0, 0.85), 0.8));
        setT(el.lift, `translate3d(0px,${f2(-PH / 2)}px,${f2(zR + 0.3 + g.liftH * le)}px) rotateY(${f2(peel)}deg)`);
        setT(el.liftShadow, `translate3d(${f2(PW * 0.04 * le)}px,${f2(-PH / 2 + PH * 0.03 * le)}px,${f2(zR + 0.15)}px)`);
        setO(el.liftShadow, 0.8 * smooth(ramp(pl, 0, 0.45)));
        setO(pLift.glow, pg * (1 - smooth(ramp(pl, 0.3, 0.86))));
        setO(pLift.gut, 1 - smooth(ramp(pl, 0, 0.6)));
      }
      setO(el.vignette, 1 - smooth(ramp(pl, 0.1, 0.8)));
      setO(el.warm, Math.min(1, rays * 0.8 + leak * 0.25));
    }

    /* 종이: 들린 페이지와 같은 픽셀에서 시작해 화면 가득 펼쳐진다 */
    if (t < OPEN.sheet[0]) sheetAt(g, 0, 0, 0);
    else {
      const e = inOutSine(span(t, OPEN.sheet));
      const a = smooth(clamp01((t - OPEN.sheet[0]) / 50));
      sheetAt(g, e, a, 1 - smooth(e));
    }
    textAt(outCubic(span(t, OPEN.text)));

    const fadeAll = 1 - smooth(ramp(t, OPEN.lightOut[0] + 100, OPEN.lightOut[1] + 40));
    if (sheetDone) clearFX();
    else drawFX(g, t, { cam, zR, zTop: (zR + zL) / 2, leak, surf, rays, flash, out, amb: smooth(ramp(t, 720, 1200)) * out, fadeAll, side: 1, zLeak: zR + Tb });
  }

  function renderClose(g: Geo, t: number): void {
    const { PW, PH, Tb, Tp } = g;
    const ul = span(t, CLOSE.unlift);
    const le = 1 - outCubic(ul); // 1 = 들려서 화면에 1:1, 0 = 페이지 위에 내려앉음
    const pO = 1 - inOutCubic(span(t, CLOSE.pan));
    const bp = span(t, CLOSE.back);
    const cb = backAngle(t);
    const xp = smooth(span(t, CLOSE.exit));
    const cam = camera(g, pO, le, 1 - outSine(ramp(t, CLOSE.pan[0], CLOSE.end)), (1 - 0.06 * Math.sin(Math.PI * bp)) * (1 - 0.04 * xp), -1);
    // 오른쪽 묶음은 장이 떠나는 만큼 얇아지고, 왼쪽 묶음은 내려앉는 만큼 두꺼워진다
    let gone = 0, landed = 0;
    for (let i = 0; i < leaves.length; i++) {
      const qv = leafP(i, t);
      gone += smooth(ramp(qv, 0, 0.25));
      landed += inOutCubic(qv);
    }
    const nL = Math.max(1, leaves.length);
    const zR = Tb + Tp * 0.45 * (1 - gone / nL), zL = Tb + Tp * (0.55 + (0.45 * landed) / nL);
    const glow = smooth(span(t, CLOSE.glowIn)) * (1 - smooth(span(t, CLOSE.glowOut)));
    const leak = smooth(ramp(-cb, 105, 150)) * (1 - smooth(ramp(-cb, 168, 179))) * (t < CLOSE.back[1] + 60 ? 1 : 0) * 0.9;
    const surf = 0.6 * glow;
    const rays = 0.5 * glow;
    const shrinkOn = t >= CLOSE.shrink[0];
    const rightOn = t < CLOSE.back[0]; // 뒷표지가 들리면 오른쪽엔 남은 장이 없다

    setO(el.wrap, smooth(span(t, CLOSE.fadeIn)) * (1 - xp));
    setOff(el.stage, !shrinkOn);
    setO(el.veil, 0);

    if (shrinkOn) {
      setT(el.world, camCSS(cam));
      coverAt(g, -180, 1, 1, 0, surf, 0);
      const lc = leavesAt(t, zR, zL, surf, Math.min(1, surf * 0.95));

      /* 뒷표지: 책등 축으로 오른쪽 → 왼쪽, 바깥 DIARY 가 위로 */
      const a = cb * DEG;
      if (back) {
        setT(back.group, `translate3d(0px,${f2(-g.H / 2)}px,${f2(g.zA)}px) rotateY(${cb.toFixed(2)}deg)`);
        setO(back.shade, shadeOf(-Math.sin(a), -Math.cos(a)) * 0.7);
        setO(back.inShade, shadeOf(Math.sin(a), Math.cos(a)) * 0.42);
        setO(back.inWarm, Math.min(1, leak * 0.75 + surf * 0.6));
        const sp = inOutSine(span(t, CLOSE.sheen));
        const sc = lerp(-0.2, 1.3, sp);
        setT(back.spec, `translateX(${f2((sc / 0.34 - 0.5) * 100)}%) skewX(-20deg)`);
        setT(back.gloss, `translateX(${f2(((sc * 0.8 + 0.1) / 0.72 - 0.5) * 100)}%) skewX(-20deg)`);
        setT(back.holo1, `translateX(${f2(-(14 + 10 * bp + 8 * sp))}%)`);
        setT(back.holo2, `translateX(${f2(-(30 - 12 * bp - 6 * sp))}%)`);
      }

      /* 페이지 묶음 */
      setV(el.pageR, rightOn);
      setV(el.edgeR, rightOn);
      setT(el.pageR, `translate3d(0px,${f2(-PH / 2)}px,${f2(zR)}px)`);
      setT(el.edgeR, `translate3d(0px,${f2(PH / 2)}px,${f2(zR)}px) rotateX(-90deg) scaleY(${Math.max(0.001, (zR - Tb) / Tp).toFixed(4)})`);
      setO(pR.glow, surf * 0.95);
      setO(pR.cast, clamp01(lc.r));
      setO(pR.lit, surf * 0.4);
      if (pL) {
        setV(pL.page, true);
        setV(pL.edge, true);
        setT(pL.page, `translate3d(${-PW}px,${f2(-PH / 2)}px,${f2(zL)}px)`);
        setT(pL.edge, `translate3d(${-PW}px,${f2(PH / 2)}px,${f2(zL)}px) rotateX(-90deg) scaleY(${Math.max(0.001, (zL - Tb) / Tp).toFixed(4)})`);
        setO(pL.glow, surf * 0.95);
        setO(pL.cast, clamp01(lc.l + 0.32 * Math.sin(-a) * clamp01((-cb - 55) / 50)));
        setO(pL.lit, leak * 0.8 + surf * 0.45);
      }
      setO(el.floorGlow, Math.min(1, surf * 0.8 + leak * 0.4));
      shadowsAt(g, 1, clamp01(Math.cos(a)));
      setO(el.ribFloor, 1 - smooth(ramp(t, CLOSE.riffle[0], CLOSE.riffle[0] + 300)));

      /* 들린 페이지가 내려앉는다(끝이 살짝 들렸다가 눕는다) */
      const liftOn = t < CLOSE.unlift[1];
      setV(el.lift, liftOn);
      setV(el.liftShadow, liftOn);
      if (liftOn) {
        const peel = -7 * Math.sin(Math.PI * clamp01(ul * 1.1));
        setT(el.lift, `translate3d(0px,${f2(-PH / 2)}px,${f2(zR + 0.3 + g.liftH * le)}px) rotateY(${f2(peel)}deg)`);
        setT(el.liftShadow, `translate3d(${f2(PW * 0.04 * le)}px,${f2(-PH / 2 + PH * 0.03 * le)}px,${f2(zR + 0.15)}px)`);
        setO(el.liftShadow, 0.8 * smooth(le));
        setO(pLift.glow, surf * 0.95 * (1 - smooth(le)));
        setO(pLift.gut, 1 - smooth(le));
      }
      setO(el.vignette, smooth(ramp(ul, 0.1, 0.9)));
      setO(el.warm, Math.min(1, rays * 0.8 + leak * 0.3));
    }

    /* 종이: 화면 가득 → 오른쪽 페이지 자리로 작아진다 */
    if (t >= CLOSE.shrink[1]) sheetAt(g, 0, 0, 0);
    else {
      const e = 1 - inCarry(span(t, CLOSE.shrink));
      sheetAt(g, e, 1, 1 - smooth(e));
    }
    textAt(1 - smooth(span(t, CLOSE.textOut)));

    if (!shrinkOn) clearFX();
    else
      drawFX(g, t, {
        cam,
        zR,
        zTop: (zR + zL) / 2,
        leak,
        surf,
        rays,
        flash: 0,
        out: glow,
        amb: glow * 0.6,
        fadeAll: 1 - xp,
        side: -1,
        zLeak: zL + Tb,
      });
  }

  /** 책상 위 그림자: 왼쪽(펼친 표지 밑), 오른쪽(책 밑) — 둘 다 책등에서 바깥으로 펼친 만큼 */
  function shadowsAt(g: Geo, spreadL: number, spreadR: number): void {
    const { W, H } = g;
    setT(el.shadowR, t3(W * 0.012, -H / 2 + H * 0.02, 0.1, `scaleX(${spreadR.toFixed(4)})`));
    setO(el.shadowR, smooth(clamp01(spreadR / 0.4)));
    setT(el.shadowL, t3(-W * spreadL - W * 0.012, -H / 2 + H * 0.02, 0.1, `scaleX(${spreadL.toFixed(4)})`));
    setO(el.shadowL, smooth(clamp01((spreadL - 0.45) / 0.55)) * 0.95);
  }

  /* ─────────── 캔버스 빛 ─────────── */
  function clearFX(): void {
    if (fxClear) return;
    for (const [c, g2] of [
      [cvBg, gBg],
      [cvFr, gFr],
    ] as const) {
      if (!g2) continue;
      g2.setTransform(1, 0, 0, 1, 0, 0);
      g2.clearRect(0, 0, c.width, c.height);
    }
    fxClear = true;
  }
  function sprite(gc: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, w: number, h: number, a: number): void {
    if (a <= 0.003 || w < 0.3 || h < 0.3) return;
    gc.globalAlpha = a > 1 ? 1 : a;
    gc.drawImage(img, x - w / 2, y - h / 2, w, h);
  }
  function drawFX(g: Geo, t: number, S: Light): void {
    const spr = SPR, part = PART;
    if (!spr || !part || !gBg || !gFr) return;
    fxClear = false;
    const { vw, vh, W, H, PW, PH } = g, cam = S.cam, z = cam.zoom, unit = g.unit;
    const P3 = (x: number, y: number, zz: number) => project(cam, x, y, zz);
    const ct = Math.cos(cam.tilt * DEG);
    const center = P3(0, -0.05 * PH, S.zTop), kc = center.k;
    {
      const gy = `${((center.y / vh) * 100).toFixed(1)}%`;
      if (el.warm.t !== gy) {
        el.warm.el.style.setProperty("--warm-y", gy);
        el.warm.t = gy;
      }
    }

    /* 책 뒤: 별, 은은한 빛, 빛기둥, 빛줄기 — 페이지와 장이 빛을 가린다 */
    const b = gBg;
    b.setTransform(g.bgS, 0, 0, g.bgS, 0, 0);
    b.clearRect(0, 0, vw, vh);
    b.globalCompositeOperation = "lighter";
    for (const s of part.stars)
      sprite(b, spr.star, s.x * vw, s.y * vh, s.s * 2.4, s.s * 2.4, s.a * (0.6 + 0.4 * Math.sin(t * s.f + s.ph)) * (1 - 0.4 * S.rays));
    const bloomA = Math.max(S.surf, S.leak * 0.4) * 0.75 + S.flash * 0.2;
    if (bloomA > 0.005) {
      const c = P3(0, -0.25 * H, 0);
      sprite(b, spr.soft, c.x, c.y, W * 5.2 * z * c.k, W * 3.1 * z * c.k, bloomA * 0.55);
      sprite(b, spr.glow, c.x, c.y - W * 0.2 * z, W * 2.6 * z * c.k, W * 1.6 * z * c.k, bloomA * 0.35);
    }
    if (S.rays > 0.003) {
      sprite(b, spr.soft, center.x, center.y - vh * 0.42, PW * 2.0 * z, vh * 1.3, S.rays * 0.36);
      sprite(b, spr.hot, center.x, center.y - PH * 0.42 * z, PW * 0.5 * z * kc, PH * 1.3 * z * kc, S.rays * 0.42 + S.flash * 0.2);
      const focal = { x: center.x, y: center.y + W * 1.1 * z };
      for (const r of part.rays) {
        const grow = outQuart(ramp(t, r.t0, r.t0 + 420));
        if (grow <= 0) continue;
        const base = P3(r.u * PW, r.v * PH, S.zTop);
        const angR = Math.atan2(base.x - focal.x, focal.y - base.y) * 1.1 + r.jitter;
        const len = vh * r.len * grow * 1.05, wTop = W * r.w * z * 1.35;
        const a = r.a * (0.72 + 0.28 * Math.sin(t * r.f + r.ph)) * S.rays * (0.6 + 0.4 * grow) + S.flash * 0.12;
        b.save();
        b.translate(base.x, base.y);
        b.rotate(angR);
        b.globalAlpha = Math.min(1, a);
        b.drawImage(r.warm ? spr.rayWarm : spr.rayGold, -wTop / 2, -len, wTop, len);
        b.restore();
      }
    }
    drawAmbient(g, b, t, S.amb, center, 0);
    b.globalAlpha = 1;

    /* 책 앞(한 장): 책배 틈 빛, 가운데 골의 빛, 반짝이 */
    const f = gFr;
    f.setTransform(g.frS, 0, 0, g.frS, 0, 0);
    f.clearRect(0, 0, vw, vh);
    f.globalCompositeOperation = "lighter";
    if (S.leak > 0.005) {
      const c = P3(S.side * PW * 0.99, 0, S.zLeak);
      sprite(f, spr.glow, c.x, c.y, W * 0.55 * z * c.k, H * 1.05 * z * c.k * ct, S.leak * 0.85);
      sprite(f, spr.hot, c.x, c.y, W * 0.12 * z * c.k, H * 0.9 * z * c.k * ct, S.leak * 0.75);
      sprite(f, spr.soft, c.x + S.side * W * 0.15 * z, c.y - W * 0.22 * z, W * 1.1 * z, W * 1.3 * z, S.leak * 0.3);
    }
    if (S.surf > 0.003) {
      sprite(f, spr.glow, center.x, center.y, PW * 2.0 * z * kc, PH * 0.95 * z * kc * ct, S.surf * 0.36 + S.flash * 0.22);
      for (let i = 0; i < 5; i++) {
        const p = P3(0, lerp(-0.4, 0.4, i / 4) * PH, S.zTop);
        sprite(f, spr.soft, p.x, p.y, PW * 0.42 * z * p.k, PW * 0.3 * z * p.k, S.surf * 0.2);
      }
      sprite(f, spr.hot, center.x, center.y + PH * 0.03 * z * ct, PW * 0.8 * z * kc, PH * 0.5 * z * kc * ct, S.surf * 0.42 + S.flash * 0.32);
      sprite(f, spr.hot, center.x, center.y - PH * 0.1 * z, PW * 0.24 * z * kc, PH * 0.42 * z * kc, S.rays * 0.2);
    }
    if (S.fadeAll > 0.003) {
      for (const p of part.leak) {
        const age = (t - p.t0) / 1000;
        if (age < 0 || age > p.life) continue;
        const qq = age / p.life, pos = P3(S.side * PW * (0.98 + p.vx * age), p.v * PH, S.zLeak + W * p.vz * age);
        if (pos.w < 0.4) continue;
        const a = p.a * smooth(clamp01(qq * 6)) * (1 - smooth(ramp(qq, 0.45, 1))) * (0.7 + 0.3 * Math.sin(t * 0.001 * p.tw + p.ph)) * S.fadeAll;
        const sz = p.size * unit * Math.min(pos.k, 2.2);
        sprite(f, spr.dot, pos.x, pos.y, sz, sz, a);
      }
      for (const p of part.sparks) {
        const age = (t - p.t0) / 1000;
        if (age < 0 || age > p.life) continue;
        const qq = age / p.life;
        const x = p.u * PW + W * (p.vx * age + p.sway * Math.sin(age * p.sf + p.ph));
        const y = p.v * PH + W * p.vy * age;
        const zz = S.zTop + W * p.vz * age * (1 + 0.35 * age);
        const pos = P3(x, y, zz);
        if (pos.w < 0.4) continue;
        const tw = 0.6 + 0.4 * Math.sin(t * 0.001 * p.tw + p.ph);
        const a = p.a * smooth(clamp01(qq * 7)) * (1 - smooth(ramp(qq, 0.4, 1))) * tw * S.fadeAll * (0.35 + 0.65 * S.out);
        const sz = p.size * unit * Math.min(pos.k, 2.2);
        sprite(f, p.kind === "glint" ? spr.glint : p.kind === "bokeh" ? spr.bokeh : spr.dot, pos.x, pos.y, sz, sz, p.kind === "bokeh" ? a * 0.8 : a);
      }
      drawAmbient(g, f, t, S.amb * S.fadeAll, center, 1);
      drawAmbient(g, f, t, S.amb * S.fadeAll, center, 2);
    }
    f.globalAlpha = 1;
  }
  /** 화면에 떠도는 먼지·보케(세 겹) — 책에서 퍼져 나가듯 차례로 나타난다 */
  function drawAmbient(g: Geo, gc: CanvasRenderingContext2D, t: number, amb: number, center: { x: number; y: number }, layer: number): void {
    const spr = SPR, part = PART;
    if (amb <= 0.003 || !spr || !part) return;
    const { vw, vh, unit } = g, sec = t / 1000;
    const r0 = isOpen ? OPEN.burst[0] : -2000;
    for (const p of part.ambient) {
      if (p.layer !== layer) continue;
      let y = p.y - p.speed * sec;
      y = ((y % 1) + 1) % 1;
      const x = p.x + p.sway * Math.sin(sec * p.sf + p.ph);
      const px = x * vw, py = y * vh * 0.92;
      const dist = Math.hypot((px - center.x) / vw, (py - center.y) / vh);
      const reveal = smooth(ramp(t, r0 + dist * 700, r0 + dist * 700 + 350));
      const column = Math.exp(-Math.pow((px - center.x) / (vw * (layer === 2 ? 0.5 : 0.32)), 2));
      const below = py > center.y + 30 ? (layer === 2 ? 0.08 : 0.3) : 1;
      const tw = 0.55 + 0.45 * Math.sin(t * 0.001 * p.tw * 3 + p.ph);
      const a = p.a * amb * reveal * (0.25 + 0.75 * column) * below * (layer === 2 ? 1 : tw);
      const sz = p.size * unit * (layer === 2 ? 1.15 : 1);
      sprite(gc, layer === 2 ? spr.bokeh : p.glint ? spr.glint : spr.dot, px, py, sz, sz, a);
    }
  }

  /* ─────────── 소리(켰을 때만) ─────────── */
  let voice: Voice | null = null;
  function startVoice(): void {
    stopVoice(0);
    if (!opts.sound) return;
    try {
      voice = startSound(win, reduced ? "chime" : mode, LEAF);
    } catch {
      voice = null;
    }
  }
  function stopVoice(fade: number): void {
    if (voice) {
      voice.close(fade);
      voice = null;
    }
  }

  /* ─────────── 재생·건너뛰기·찾아보기 ─────────── */
  let raf = 0;
  let t0 = 0;
  let last = 0;
  let clockOn = false;
  let frames = 0;
  let slow = 0;
  let coveredFired = false;
  let state: "idle" | "playing" | "done" = "idle";
  let fired = false;
  let destroyed = false;
  let cur = 0;
  const cancel = () => {
    if (raf) win.cancelAnimationFrame(raf);
    raf = 0;
  };
  function covered(): void {
    if (coveredFired || isOpen || !opts.onCovered) return;
    coveredFired = true;
    try {
      opts.onCovered();
    } catch {
      /* 무시 */
    }
  }
  function finish(): void {
    cancel();
    state = "done";
    cur = END;
    render(END);
    wrap.classList.add("is-done");
    if (fired) return;
    fired = true;
    try {
      opts.onDone();
    } catch {
      /* 부른 쪽 오류는 연출을 멈추지 않는다 */
    }
  }
  function tick(now: number): void {
    raf = 0;
    if (destroyed || state !== "playing") return;
    // 시계는 첫 장면이 실제로 그려진 다음 프레임부터 — 만드는 동안 앞부분이 건너뛰어지지 않게
    if (!clockOn) {
      clockOn = true;
      t0 = now;
      last = now;
      startVoice();
    }
    const dt = now - last;
    last = now;
    if (dt > MAX_STEP) t0 += dt - MAX_STEP; // 크게 멈칫했으면 그만큼 늦춰서 이어 그린다(툭 건너뛰지 않게)
    // 처음 몇 프레임이 느리면(폰) 빛 조각을 덜어 낸다
    if (!lite && frames < 30) {
      frames++;
      if (dt > 26) slow++;
      if (frames >= 8 && slow >= 5 && PART) {
        lite = true;
        trim(PART);
      }
    }
    cur = now - t0;
    if (!isOpen && cur >= CLOSE.covered) covered();
    if (cur >= END) {
      finish();
      return;
    }
    render(cur);
    raf = win.requestAnimationFrame(tick);
  }
  function play(): void {
    if (destroyed || fired) return;
    cancel();
    state = "playing";
    cur = 0;
    clockOn = false;
    frames = 0;
    slow = 0;
    render(0);
    // 첫 rAF 뒤의 프레임에 render(0) 이 그려진다 → 그다음 rAF 에서 시계를 켠다
    raf = win.requestAnimationFrame(() => {
      raf = win.requestAnimationFrame(tick);
    });
  }
  function skip(): void {
    if (destroyed || fired) return;
    stopVoice(0.15);
    finish();
  }
  function seek(ms: number): void {
    if (destroyed) return;
    cancel();
    stopVoice(0);
    if (state === "playing") state = "idle";
    cur = clamp(+ms || 0, 0, END);
    render(cur);
  }

  const interactive = opts.interactive !== false;
  const onPointer = () => {
    if (state === "playing") skip();
  };
  // 캡처 단계에서 먼저 받아 막는다 — 밑의 일기 화면(Esc = 닫기)까지 가지 않게
  const onKey = (e: KeyboardEvent) => {
    if (state !== "playing") return;
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      skip();
    }
  };
  let rz = 0;
  const onResize = () => {
    if (rz) win.cancelAnimationFrame(rz);
    rz = win.requestAnimationFrame(() => {
      rz = 0;
      layout();
      if (state !== "playing") render(cur);
    });
  };
  if (interactive) {
    wrap.addEventListener("pointerdown", onPointer);
    win.addEventListener("keydown", onKey, true);
  }
  win.addEventListener("resize", onResize);

  layout();
  render(0);

  return {
    play,
    seek,
    skip,
    duration: END,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancel();
      if (rz) win.cancelAnimationFrame(rz);
      stopVoice(0.12);
      wrap.removeEventListener("pointerdown", onPointer);
      win.removeEventListener("keydown", onKey, true);
      win.removeEventListener("resize", onResize);
      wrap.remove();
      G = null;
      PART = null;
      SPR = null;
    },
  };
}
