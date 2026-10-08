// 표지 그림(벡터)과 빛 무늬(캔버스) — 파일 없이 코드로 만든다.
// 표지 글자는 SVG 경로라 어느 기기·배율에서도 또렷하다.

import { clamp01, lerp, mulberry32, ramp, smooth } from "./math";

/** 디돈 대문자(대문자 높이 100) — 글꼴이 없어도 늘 같은 모양 */
const GLYPHS: Record<string, { w: number; d: string }> = {
  D: { w: 80, d: "M0 0H38C66 0 80 22 80 50C80 78 66 100 38 100H0V97H8V3H0ZM21 3V97H38C58 97 66 76 66 50C66 24 58 3 38 3Z" },
  R: { w: 79, d: "M0 0H40C60 0 73 11 73 26C73 40 62 50 46 52L74 97H79V100H54V97H59L34 53H21V97H29V100H0V97H8V3H0ZM21 3H39C53 3 60 12 60 26C60 40 53 50 39 50H21Z" },
  E: { w: 66.5, d: "M0 0H62V24H59.5C58 10 52 3 40 3H21V48H40C46 48 48 44 49 38H51.5V61H49C48 55 46 51 40 51H21V97H42C56 97 62 89 64 74H66.5V100H0V97H8V3H0Z" },
  A: { w: 83, d: "M37 0H45L76 97H83V100H55V97H62L52.4 67H21L12 97H20V100H1V97H8ZM36.2 16.2L51.5 64H21.9Z" },
  M: { w: 102, d: "M0 0H21L52 80L82 0H102V3H95V97H102V100H74V97H82V12L50 100H48L11.5 10V97H19V100H1V97H8V3H0Z" },
  I: { w: 29, d: "M0 0H29V3H21V97H29V100H0V97H8V3H0Z" },
  Y: { w: 84, d: "M0 0H30V3H23L47 46L72 3H62V0H84V3H76L48.5 53V97H58V100H25V97H35V54L8 3H0Z" },
};

/** 글자 사이(앞 글자 → 다음 글자) — 눈으로 맞춘 값 */
const WORDS: Record<string, [string, number][]> = {
  DREAM: [["D", 0], ["R", 102], ["E", 201], ["A", 281.5], ["M", 380.5]],
  DIARY: [["D", 0], ["I", 101], ["A", 148], ["R", 246], ["Y", 341]],
};
const WORD_W: Record<string, number> = { DREAM: 482.5, DIARY: 425 };

const fx = (n: number): string => n.toFixed(2);
export const svgUrl = (s: string): string => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;

/** 두 원으로 만든 초승달 경로(큰 원 C1 에서 C2 를 도려냄) — 마스크·id 없이 그린다 */
export function crescent(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): string {
  const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
  const ex = dx / d, ey = dy / d;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const px = x1 + a * ex, py = y1 + a * ey, nx = -ey, ny = ex;
  const i1 = `${fx(px + h * nx)} ${fx(py + h * ny)}`, i2 = `${fx(px - h * nx)} ${fx(py - h * ny)}`;
  return `M${i1}A${fx(r1)} ${fx(r1)} 0 1 1 ${i2}A${fx(r2)} ${fx(r2)} 0 ${a > d ? 1 : 0} 0 ${i1}Z`;
}

/** 일기 종이 머리글의 초승달(DiarySheet 의 Crescent 와 같은 모양, 40×40 상자) */
export const MOON_40 = crescent(20, 21, 12, 24.6, 16.6, 10.2);

const star4 = (x: number, y: number, r: number): string =>
  `M${fx(x)} ${fx(y - r)}Q${fx(x)} ${fx(y)} ${fx(x + r)} ${fx(y)}Q${fx(x)} ${fx(y)} ${fx(x)} ${fx(y + r)}Q${fx(x)} ${fx(y)} ${fx(x - r)} ${fx(y)}Q${fx(x)} ${fx(y)} ${fx(x)} ${fx(y - r)}Z`;

export interface CoverArt {
  frame: string;
  title: string;
}

/**
 * 표지 무늬 두 장(마스크): frame = 금박 테두리·달·별, title = 글자(무지개빛 홀로그램 박).
 * back 이면 뒷표지 — 책등이 오른쪽이라 테두리를 좌우로 뒤집고, 글자는 DIARY.
 */
export function coverArt(W: number, H: number, word: "DREAM" | "DIARY", year: number | null, back: boolean): CoverArt {
  const cxF = W * 0.53; // 앞표지: 책등 홈 오른쪽이 눈으로 본 가운데
  const cx = back ? W - cxF : cxF;
  const m1 = W * 0.066, l1 = W * 0.112, m2 = W * 0.088, l2 = l1 + (m2 - m1);
  const corners = [
    [l2, m2],
    [W - m2, m2],
    [l2, H - m2],
    [W - m2, H - m2],
  ]
    .map(([x, y]) => `<path d='${star4(x, y, W * 0.03)}'/><circle cx='${fx(x)}' cy='${fx(y)}' r='${fx(W * 0.0085)}'/>`)
    .join("");
  const mr = W * 0.052, my = H * (back ? 0.33 : 0.315);
  const yRule = H * (back ? 0.6 : 0.575);
  const mirror = back ? ` transform='translate(${fx(W)} 0) scale(-1 1)'` : "";
  const frame = `<svg xmlns='http://www.w3.org/2000/svg' width='${fx(W)}' height='${fx(H)}' viewBox='0 0 ${fx(W)} ${fx(H)}'>
    <g${mirror}>
      <g fill='none' stroke='#000'>
        <rect x='${fx(l1)}' y='${fx(m1)}' width='${fx(W - m1 - l1)}' height='${fx(H - 2 * m1)}' rx='${fx(W * 0.012)}' stroke-width='${fx(W * 0.0058)}'/>
        <rect x='${fx(l2)}' y='${fx(m2)}' width='${fx(W - m2 - l2)}' height='${fx(H - 2 * m2)}' stroke-width='${fx(W * 0.0026)}'/>
        <path d='M${fx(cxF - W * 0.17)} ${fx(yRule)}H${fx(cxF - W * 0.026)}M${fx(cxF + W * 0.026)} ${fx(yRule)}H${fx(cxF + W * 0.17)}' stroke-width='${fx(W * 0.0032)}'/>
      </g>
      <g fill='#000'>${corners}<path d='${star4(cxF, yRule, W * 0.015)}'/></g>
    </g>
    <g fill='#000'>
      <path d='${crescent(cx, my, mr, cx + mr * 0.44, my - mr * 0.24, mr * 0.86)}'/>
      <path d='${star4(cx + mr * 1.12, my - mr * 0.98, W * 0.017)}'/>
      <path d='${star4(cx + mr * 1.62, my - mr * 0.12, W * 0.0095)}'/>
      <path d='${star4(cx - mr * 1.5, my + mr * 0.2, W * 0.007)}'/>
    </g></svg>`;
  const tw = W * (word === "DIARY" ? 0.46 : 0.5), s = tw / WORD_W[word];
  const x0 = cx - tw / 2, yTop = H * (back ? 0.45 : 0.43);
  const paths = WORDS[word].map(([ch, x]) => `<path transform='translate(${fx(x)} 0)' d='${GLYPHS[ch].d}'/>`).join("");
  const ys = W * 0.046, ls = ys * 0.42;
  const fam = `'Bodoni 72','Didot','Bodoni MT','Playfair Display','Cormorant Garamond','Times New Roman','Liberation Serif',Georgia,serif`;
  const yearText =
    year == null
      ? ""
      : `<text x='${fx(cx + ls / 2)}' y='${fx(yRule + W * 0.07)}' text-anchor='middle' font-family="${fam}" font-size='${fx(ys)}' letter-spacing='${fx(ls)}' fill='#000'>${year}</text>`;
  const title = `<svg xmlns='http://www.w3.org/2000/svg' width='${fx(W)}' height='${fx(H)}' viewBox='0 0 ${fx(W)} ${fx(H)}'>
    <g fill='#000' fill-rule='evenodd' transform='translate(${fx(x0)} ${fx(yTop)}) scale(${s.toFixed(5)})'>${paths}</g>${yearText}</svg>`;
  return { frame: svgUrl(frame), title: svgUrl(title) };
}

/** 책등 무늬(가로 = 두께, 세로 = 책 높이): 금박 띠 두 쌍 */
export function spineArt(T: number, H: number): string {
  const band = (y: number) =>
    `<rect x='0' y='${fx(y)}' width='${fx(T)}' height='${fx(H * 0.006)}'/><rect x='0' y='${fx(y + H * 0.016)}' width='${fx(T)}' height='${fx(H * 0.0028)}'/>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${fx(T)}' height='${fx(H)}' viewBox='0 0 ${fx(T)} ${fx(H)}'><g fill='#000'>${band(H * 0.1)}${band(H * 0.874)}<path d='${star4(T / 2, H * 0.5, Math.min(T * 0.22, H * 0.02))}'/></g></svg>`;
  return svgUrl(svg);
}

type Doc = Document;
const canvas = (doc: Doc, w: number, h: number): HTMLCanvasElement => {
  const c = doc.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
const ctx2d = (c: HTMLCanvasElement): CanvasRenderingContext2D => {
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d");
  return g;
};

/** 가죽 결(밝고 어두운 점만 담은 투명 무늬) */
export function makeLeather(doc: Doc, size = 192): string {
  const c = canvas(doc, size, size);
  const g = ctx2d(c), img = g.createImageData(size, size), d = img.data;
  const R = mulberry32(77), n = 26, pts: number[][] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push([0.15 + R() * 0.7, 0.15 + R() * 0.7, R()]);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * n, v = (y / size) * n, ci = Math.floor(u), cj = Math.floor(v);
      let f1 = 9, f2 = 9, shade = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const i = ci + di, j = cj + dj, p = pts[((j + n) % n) * n + ((i + n) % n)];
          const dd = Math.hypot(i + p[0] - u, j + p[1] - v);
          if (dd < f1) {
            f2 = f1;
            f1 = dd;
            shade = p[2];
          } else if (dd < f2) f2 = dd;
        }
      const crease = 1 - smooth(clamp01((f2 - f1) * 3.2));
      const val = 0.5 + (shade - 0.5) * 0.14 + (R() - 0.5) * 0.14 - crease * 0.3 + (1 - f1) * 0.07;
      const k = (y * size + x) * 4;
      if (val >= 0.5) {
        d[k] = d[k + 1] = d[k + 2] = 255;
        d[k + 3] = Math.min(255, (val - 0.5) * 2 * 30);
      } else {
        d[k] = d[k + 1] = d[k + 2] = 0;
        d[k + 3] = Math.min(255, (0.5 - val) * 2 * 86);
      }
    }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** 평균 0 의 흑백 잡티 — 어두운 그라데이션의 띠 무늬(8비트 화면)를 깬다 */
export function makeDither(doc: Doc, size = 128): string {
  const c = canvas(doc, size, size);
  const g = ctx2d(c), img = g.createImageData(size, size), d = img.data, R = mulberry32(9);
  for (let i = 0; i < size * size; i++) {
    const w = R() < 0.5 ? 255 : 0;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = w;
    d[i * 4 + 3] = Math.round(R() * 9);
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

export interface Sprites {
  glow: HTMLCanvasElement;
  soft: HTMLCanvasElement;
  hot: HTMLCanvasElement;
  dot: HTMLCanvasElement;
  bokeh: HTMLCanvasElement;
  star: HTMLCanvasElement;
  glint: HTMLCanvasElement;
  rayGold: HTMLCanvasElement;
  rayWarm: HTMLCanvasElement;
}

/** 빛 조각들 — 흰빛 심지 → 금빛 → 호박빛(보라 배경 위에서도 금색으로 읽히게 붉은 쪽으로) */
export function makeSprites(doc: Doc): Sprites {
  const core = [255, 244, 214], mid = [255, 200, 96], warm = [255, 150, 52];
  const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const radial = (size: number, stops: [number, string][]) => {
    const c = canvas(doc, size, size);
    const g = ctx2d(c), r = size / 2, gr = g.createRadialGradient(r, r, 0, r, r, r);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  };
  const glow = radial(256, [[0, rgba(core, 1)], [0.12, rgba(mid, 0.72)], [0.35, rgba(mid, 0.28)], [0.6, rgba(warm, 0.09)], [1, rgba(warm, 0)]]);
  const soft = radial(256, [[0, rgba(mid, 0.9)], [0.3, rgba(mid, 0.45)], [0.62, rgba(warm, 0.12)], [1, rgba(warm, 0)]]);
  const hot = radial(256, [[0, "rgba(255,255,250,1)"], [0.25, rgba(core, 0.8)], [0.6, rgba(mid, 0.2)], [1, rgba(mid, 0)]]);
  const dot = radial(64, [[0, "rgba(255,255,248,1)"], [0.09, rgba(core, 1)], [0.2, rgba(mid, 0.55)], [0.45, rgba(warm, 0.14)], [1, rgba(warm, 0)]]);
  const bokeh = radial(128, [[0, rgba(mid, 0.42)], [0.55, rgba(mid, 0.36)], [0.8, rgba(core, 0.3)], [0.9, rgba(mid, 0.12)], [1, rgba(mid, 0)]]);
  const star = radial(16, [[0, "rgba(235,232,255,1)"], [0.35, "rgba(200,196,255,.35)"], [1, "rgba(200,196,255,0)"]]);
  const glint = (() => {
    const s = 128, c = canvas(doc, s, s);
    const g = ctx2d(c);
    g.globalCompositeOperation = "lighter";
    for (const horizontal of [true, false]) {
      const gr = horizontal ? g.createLinearGradient(0, 0, s, 0) : g.createLinearGradient(0, 0, 0, s);
      gr.addColorStop(0, rgba(mid, 0));
      gr.addColorStop(0.5, rgba(core, 1));
      gr.addColorStop(1, rgba(mid, 0));
      g.fillStyle = gr;
      if (horizontal) g.fillRect(0, s / 2 - 1.2, s, 2.4);
      else g.fillRect(s / 2 - 1.2, 0, 2.4, s);
    }
    g.drawImage(dot, s / 2 - 24, s / 2 - 24, 48, 48);
    return c;
  })();
  // 빛줄기: 아래(뿌리)는 좁고 위로 갈수록 넓어지며 옅어진다
  const ray = (tint: number[]) => {
    const w = 64, h = 512, c = canvas(doc, w, h);
    const g = ctx2d(c), img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) {
      const fy = y / (h - 1), wf = lerp(1, 0.16, Math.pow(fy, 0.8));
      const along = Math.pow(fy, 1.6) * (1 - 0.85 * smooth(ramp(fy, 0.9, 1)));
      const k2 = fy * fy;
      const r = lerp(tint[0], core[0], k2), gg = lerp(tint[1], core[1], k2), b = lerp(tint[2], core[2], k2);
      for (let x = 0; x < w; x++) {
        const dx = (x - (w - 1) / 2) / ((w / 2) * wf), a = along * Math.exp(-dx * dx * 3.4), k = (y * w + x) * 4;
        d[k] = r;
        d[k + 1] = gg;
        d[k + 2] = b;
        d[k + 3] = Math.min(255, a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  };
  return { glow, soft, hot, dot, bokeh, star, glint, rayGold: ray([255, 196, 92]), rayWarm: ray([255, 160, 64]) };
}
