"use client";

import { useEffect, useRef } from "react";
import { bgUrl, CUSTOM_BG, findBackground } from "@/lib/backgrounds";
import { useCustomBg } from "@/lib/customBg";
import { usePlanner } from "./PlannerProvider";
import { useLayer } from "./ui";

/** 지금 고른 사진 배경(사진 배경 테마가 아니면 null). 내 사진은 이 기기에만 있다 — 없으면(다른 기기에서 고른 경우) 기본 그림 */
function useBackdrop() {
  const { settings } = usePlanner();
  const dusk = settings.palette === "dusk";
  const custom = useCustomBg(dusk && settings.background === CUSTOM_BG);
  if (!dusk) return null;
  if (custom) return { portrait: custom, landscape: custom, position: "center", dim: 0.4 };
  const bg = findBackground(settings.background);
  return { portrait: bgUrl(bg.portrait), landscape: bgUrl(bg.landscape), position: bg.position ?? "center", dim: bg.dim };
}

/** 세로 화면은 세로 그림, 가로 화면은 가로 그림 */
function Photo({ bg }: { bg: NonNullable<ReturnType<typeof useBackdrop>> }) {
  return (
    <>
      <div className="absolute inset-0 bg-cover landscape:hidden" style={{ backgroundImage: `url(${bg.portrait})`, backgroundPosition: bg.position }} />
      <div className="absolute inset-0 hidden bg-cover landscape:block" style={{ backgroundImage: `url(${bg.landscape})`, backgroundPosition: bg.position }} />
    </>
  );
}

/** 사진 배경 테마 — 고른 그림·사진. 글자가 읽히게 위·아래를 어둡게. */
export function Backdrop() {
  const bg = useBackdrop();
  if (!bg) return null;
  const d = bg.dim;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-[#0b0920]">
      <Photo bg={bg} />
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, rgba(7,6,22,${Math.min(0.85, d + 0.15)}) 0%, rgba(7,6,22,${d * 0.55}) 42%, rgba(7,6,22,${Math.min(0.85, d + 0.2)}) 100%)`,
        }}
      />
    </div>
  );
}

/** 사진 배경 테마일 때만 '배경만 보기'를 쓸 수 있다 */
export function useHasBackdrop() {
  return usePlanner().settings.palette === "dusk";
}

/** 배경만 보기 — 화면 글자·버튼 없이 사진만(어둡게 하지 않고). 아무 곳이나 누르거나 Esc 면 돌아간다. */
export function WallpaperView() {
  const { wallpaper, setWallpaper } = usePlanner();
  const bg = useBackdrop();
  const open = wallpaper && Boolean(bg);
  const close = () => setWallpaper(false);
  useLayer(open, close);

  // PC 는 브라우저 전체 화면으로 — 이 화면이 켠 경우만 닫을 때 끈다
  const entered = useRef(false);
  useEffect(() => {
    if (!open) return;
    if (!document.fullscreenElement && document.fullscreenEnabled && window.matchMedia("(pointer: fine)").matches) {
      document.documentElement
        .requestFullscreen?.()
        .then(() => (entered.current = true))
        .catch(() => {});
    }
    // 전체 화면을 Esc 로 끄면 이 화면도 같이 닫는다
    const onFs = () => {
      if (!document.fullscreenElement && entered.current) {
        entered.current = false;
        setWallpaper(false);
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      if (entered.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      entered.current = false;
    };
  }, [open, setWallpaper]);

  if (!open || !bg) return null;
  return (
    <div role="dialog" aria-label="배경만 보기" onClick={close} className="wallpaper-view fixed inset-0 z-[70] cursor-pointer bg-black">
      <Photo bg={bg} />
      <p className="wallpaper-hint pointer-events-none absolute inset-x-0 bottom-[calc(2rem+env(safe-area-inset-bottom))] text-center text-xs font-semibold text-white/80 [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
        아무 곳이나 누르면 돌아가요
      </p>
    </div>
  );
}
