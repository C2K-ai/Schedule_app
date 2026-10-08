// 일기 여닫기 연출에 쓰는 작은 계산들 — 모두 순수 함수(상태 없음).

export const DEG = Math.PI / 180;

export type Span = readonly [number, number];

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
/** t 가 a→b 를 지나는 정도(0~1) */
export const ramp = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
export const span = (t: number, s: Span): number => ramp(t, s[0], s[1]);
export const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
/** 배율은 로그로 섞어야 속도가 고르다 */
export const expLerp = (a: number, b: number, p: number): number => Math.exp(lerp(Math.log(a), Math.log(b), p));
export const smooth = (p: number): number => p * p * (3 - 2 * p);
export const inOutCubic = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
export const outCubic = (p: number): number => 1 - Math.pow(1 - p, 3);
export const outQuart = (p: number): number => 1 - Math.pow(1 - p, 4);
export const inOutSine = (p: number): number => -(Math.cos(Math.PI * p) - 1) / 2;
export const outSine = (p: number): number => Math.sin((p * Math.PI) / 2);
/** 천천히 출발해서 속도를 지닌 채 끝난다(다음 움직임으로 이어 붙일 때) */
export const inCarry = (p: number): number => p * p * (2 - p);
/** 소수 둘째 자리 — 같은 값이면 같은 문자열이 나와서 스타일 캐시가 맞는다 */
export const f2 = (v: number): number => Math.round(v * 100) / 100;

/** 늘 같은 순서로 나오는 난수(씨앗 고정) — 장면이 매번 똑같이 그려진다 */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
