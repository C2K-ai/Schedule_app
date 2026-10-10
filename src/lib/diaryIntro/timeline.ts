// 장면 시간표(ms) — 그림과 소리가 같은 표를 읽는다.

import type { Span } from "./math";

/** 펼치기: 덮인 책 → 표지가 왼쪽 책등 축으로 열림 → 촤라락 + 금빛 → 오른쪽 종이가 앞으로 나와 일기장이 된다 */
export const OPEN = {
  veil: [0, 220] as Span,
  veilFrom: 0.16, // 첫 장면부터 책이 또렷하게 — 아주 옅은 막만
  sheen: [0, 820] as Span,
  cover: [170, 830] as Span,
  pan: [300, 1020] as Span,
  burst: [650, 1080] as Span,
  flash: 960,
  riffle: [600, 1560] as Span,
  leaves: 10,
  lift: [1440, 1940] as Span,
  sheet: [1880, 2230] as Span,
  lightOut: [1860, 2300] as Span,
  text: [2040, 2290] as Span,
  dissolve: [2330, 2500] as Span, // 진짜 일기 종이로 스르르 넘어간다
  end: 2500,
} as const;

/** 덮기: 종이가 작아져 오른쪽 페이지로 → 남은 장이 촤라락 왼쪽으로 마저 넘어감 → 뒷표지가 넘어와 덮이며 DIARY → 잠깐 머물다 앱으로 */
export const CLOSE = {
  fadeIn: [0, 80] as Span,
  covered: 110, // 이때부터 연출이 화면을 다 가린다 — 밑의 일기 화면을 숨겨도 된다
  textOut: [0, 150] as Span,
  shrink: [40, 440] as Span,
  unlift: [420, 740] as Span,
  glowIn: [500, 950] as Span,
  glowOut: [1350, 1850] as Span,
  riffle: [740, 1460] as Span, // 들린 종이가 내려앉은 뒤
  leaves: 8,
  back: [1380, 1960] as Span, // 뒷표지가 책등 축으로 오른쪽 → 왼쪽
  pan: [1250, 2050] as Span,
  sheen: [1960, 2420] as Span,
  exit: [2340, 2680] as Span, // 앱 위로 스르르
  end: 2680,
} as const;

/** 움직임 줄이기: 짧은 페이드만 */
export const REDUCED_MS = 320;

export interface LeafPlan {
  n: number;
  starts: number[];
  durs: number[];
}

/** 넘어가는 장들의 출발 시각 — 가운데로 갈수록 빨라졌다가 다시 느려진다(소리도 같은 표를 쓴다) */
export function leafPlan(n: number, riffle: Span): LeafPlan {
  const [a, b] = riffle;
  const durs: number[] = [];
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    const m = Math.sin((Math.PI * (i + 0.5)) / n);
    durs.push(430 - 150 * m);
    w.push(1 - 0.62 * m);
  }
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + (w[i - 1] + w[i]) / 2);
  const total = b - a - durs[n - 1];
  return { n, starts: cum.map((c) => a + (c / cum[n - 1]) * total), durs };
}
