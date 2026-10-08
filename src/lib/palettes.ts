// 테마 목록 — 사진 배경(늘 어두움) + 단색 테마들(밝게/어둡게/자동). 색 값은 globals.css 의 html[data-palette=…].
import type { Settings } from "./types";

export interface PaletteDef {
  value: Settings["palette"];
  label: string;
  /** 고르는 칸에 보일 색(배경, 포인트) */
  swatch: [string, string];
}

export const PALETTES: PaletteDef[] = [
  { value: "dusk", label: "사진 배경", swatch: ["#1b1540", "#ffa36c"] },
  { value: "lime", label: "라임", swatch: ["#121419", "#c8ff2e"] },
  { value: "ocean", label: "바다", swatch: ["#0b1824", "#38bdf8"] },
  { value: "cherry", label: "벚꽃", swatch: ["#1d1118", "#ff8fb8"] },
  { value: "lavender", label: "라벤더", swatch: ["#171327", "#b69cff"] },
];
