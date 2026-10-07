"use client";

import { bgUrl, findBackground } from "@/lib/backgrounds";
import { usePlanner } from "./PlannerProvider";

/** 노을 그네 테마 배경 — 고른 그림·사진. 세로 화면은 세로 그림, 가로 화면은 가로 그림. 글자가 읽히게 위·아래를 어둡게. */
export function Backdrop() {
  const { settings } = usePlanner();
  if (settings.palette !== "dusk") return null;
  const bg = findBackground(settings.background);
  const pos = bg.position ?? "center";
  const d = bg.dim;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-[#0b0920]">
      <div
        className="absolute inset-0 bg-cover landscape:hidden"
        style={{ backgroundImage: `url(${bgUrl(bg.portrait)})`, backgroundPosition: pos }}
      />
      <div
        className="absolute inset-0 hidden bg-cover landscape:block"
        style={{ backgroundImage: `url(${bgUrl(bg.landscape)})`, backgroundPosition: pos }}
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
