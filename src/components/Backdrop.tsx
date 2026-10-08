"use client";

import { bgUrl, CUSTOM_BG, findBackground } from "@/lib/backgrounds";
import { useCustomBg } from "@/lib/customBg";
import { usePlanner } from "./PlannerProvider";

/** 사진 배경 테마 — 고른 그림·사진(또는 이 기기에 넣은 내 사진). 세로 화면은 세로 그림, 가로 화면은 가로 그림. 글자가 읽히게 위·아래를 어둡게. */
export function Backdrop() {
  const { settings } = usePlanner();
  const dusk = settings.palette === "dusk";
  const custom = useCustomBg(dusk && settings.background === CUSTOM_BG);
  if (!dusk) return null;
  // 내 사진은 이 기기에만 있다 — 없으면(다른 기기에서 고른 경우) 기본 그림
  const bg = custom
    ? { portrait: custom, landscape: custom, position: "center", dim: 0.4, local: true }
    : { ...findBackground(settings.background), local: false };
  const src = (p: string) => (bg.local ? p : bgUrl(p));
  const pos = bg.position ?? "center";
  const d = bg.dim;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-[#0b0920]">
      <div
        className="absolute inset-0 bg-cover landscape:hidden"
        style={{ backgroundImage: `url(${src(bg.portrait)})`, backgroundPosition: pos }}
      />
      <div
        className="absolute inset-0 hidden bg-cover landscape:block"
        style={{ backgroundImage: `url(${src(bg.landscape)})`, backgroundPosition: pos }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, rgba(7,6,22,${Math.min(0.85, d + 0.15)}) 0%, rgba(7,6,22,${d * 0.55}) 42%, rgba(7,6,22,${Math.min(0.85, d + 0.2)}) 100%)`,
        }}
      />
    </div>
  );
}
