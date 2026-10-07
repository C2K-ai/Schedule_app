"use client";

import { withBase } from "@/lib/base";
import { usePlanner } from "./PlannerProvider";

/** 노을 그네 배경 — 세로 화면은 세로 그림, 가로 화면은 가로 그림. 글자가 읽히게 위·아래를 살짝 어둡게. */
export function Backdrop() {
  const { settings } = usePlanner();
  if (settings.palette !== "dusk") return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-[#0b0920]">
      <div
        className="absolute inset-0 bg-cover bg-center landscape:hidden"
        style={{ backgroundImage: `url(${withBase("/themes/dusk-portrait.webp")})` }}
      />
      <div
        className="absolute inset-0 hidden bg-cover bg-center landscape:block"
        style={{ backgroundImage: `url(${withBase("/themes/dusk-landscape.webp")})` }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,6,22,0.5)_0%,rgba(7,6,22,0.18)_42%,rgba(7,6,22,0.55)_100%)]" />
    </div>
  );
}
