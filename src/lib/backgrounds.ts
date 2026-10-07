// 노을 그네 테마의 배경 — 기본 그림(노을 그네) + 무료 사진(Pexels 라이선스: 무료·출처 표기 불필요).
// 사진 출처는 public/themes/bg/CREDITS.md. 새로 받으려면 scripts/backgrounds.json + Fetch backgrounds 워크플로.
import { withBase } from "./base";

export interface Background {
  key: string;
  name: string;
  /** 세로(폰)·가로(PC) 화면용 — 사진은 한 장을 잘라 쓴다 */
  portrait: string;
  landscape: string;
  thumb: string;
  /** 글자가 읽히게 덮는 어둡기(0~1) — 밝은 사진일수록 진하게 */
  dim: number;
  /** 잘릴 때 남길 부분(CSS background-position) */
  position?: string;
}

const photo = (key: string, name: string, dim: number, position?: string): Background => ({
  key,
  name,
  portrait: `/themes/bg/${key}.webp`,
  landscape: `/themes/bg/${key}.webp`,
  thumb: `/themes/bg/${key}-thumb.webp`,
  dim,
  position,
});

export const BACKGROUNDS: Background[] = [
  {
    key: "swing",
    name: "노을 그네",
    portrait: "/themes/dusk-portrait.webp",
    landscape: "/themes/dusk-landscape.webp",
    thumb: "/themes/dusk-landscape.webp",
    dim: 0.35,
  },
  photo("milkyway", "은하수", 0.3),
  photo("aurora", "오로라", 0.35),
  photo("aurora-lake", "오로라 호수", 0.3, "center 30%"),
  photo("nebula", "보랏빛 은하", 0.35),
  photo("full-moon", "보름달", 0.25, "center 35%"),
  photo("violet-sunset", "보랏빛 노을", 0.45),
  photo("cotton-sky", "노을 구름", 0.45),
  photo("pink-clouds", "분홍 구름", 0.5),
  photo("lavender", "라벤더 들판", 0.45, "center 70%"),
  photo("misty-hills", "안개 숲", 0.45),
];

export const findBackground = (key: string | undefined) => BACKGROUNDS.find((b) => b.key === key) ?? BACKGROUNDS[0];

export const bgUrl = (path: string) => withBase(path);
