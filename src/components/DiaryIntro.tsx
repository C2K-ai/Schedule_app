"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { withBase } from "@/lib/base";
import { cx } from "./ui";

export interface DiaryIntroProps {
  /** open = 일기를 펼칠 때(덮인 책 → 종이), close = 덮을 때(종이 → 덮인 책, 뒷표지 DIARY) */
  mode: "open" | "close";
  /** 책 효과음(설정 → 일기 열고 닫을 때 효과음, 기본 꺼짐) */
  sound: boolean;
  /** 다 끝났을 때(또는 눌러서 건너뛰었을 때) 한 번 */
  onDone: () => void;
  /** 덮기: 책 장면이 화면을 다 가린 순간 — 밑의 일기 화면을 숨기면 끝에 앱이 비쳐 보인다 */
  onCovered?: () => void;
}

/** 엔진을 못 불러왔을 때 대신 보여 주는 짧은 페이드 */
const FALLBACK_MS = 350;

/** 여닫기 연출에 소리가 있는지 — 효과음 설정 스위치를 보여 줄지 */
export const DIARY_INTRO_SOUND = true;

const VEIL_ID = "diary-tap-veil";
/**
 * DREAM 을 누르는 순간 바로 화면을 어둡게 — 일기 화면을 그리는 동안(폰에서 0.2~0.3초) 멈춘 것처럼 보이지 않게.
 * 투명도 전환은 합성 스레드에서 돌아서 그리는 중에도 부드럽다. 책 장면이 붙으면 DiaryIntro 가 걷어 낸다.
 */
export function openDiaryWithVeil(open: () => void): void {
  if (typeof document === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return open();
  document.getElementById(VEIL_ID)?.remove();
  const v = document.createElement("div");
  v.id = VEIL_ID;
  v.setAttribute("aria-hidden", "true");
  v.style.cssText = "position:fixed;inset:0;z-index:70;background:#0b0920;opacity:0;transition:opacity 140ms ease-out;pointer-events:none";
  document.body.appendChild(v);
  // 못 걷히는 일이 없게(엔진 실패 등) — 2초 뒤엔 스스로 사라진다
  window.setTimeout(() => v.remove(), 2000);
  requestAnimationFrame(() => {
    v.style.opacity = "1";
    // 어두워지기 시작한 장면이 한 번 그려진 뒤에 무거운 일기 화면을 연다
    requestAnimationFrame(() => window.setTimeout(open, 0));
  });
}
const liftVeil = () => document.getElementById(VEIL_ID)?.remove();

/* ─────────── 폰: 녹화해 둔 영상(public/diary/*.mp4, scripts/diary-video 로 만듦) ───────────
   폰마다 실시간 3D·빛 그리기가 깨지거나 끊겨서(사용자), 폰은 엔진을 최고 화질로 녹화한 영상을 튼다.
   한가할 때 통째로 받아 blob 으로 들고 있다가 쓴다 — 누른 뒤 받느라 버퍼링하지 않게. 못 받았으면 엔진으로. */
type Mode = "open" | "close";
const VIDEO: Partial<Record<Mode, string>> = {};
let videoLoading = false;
/** 세로로 든 터치 화면(폰)만 — 가로·PC 는 엔진 */
const wantsVideo = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(pointer: coarse)").matches &&
  window.innerHeight > window.innerWidth &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function preloadVideos(): void {
  if (videoLoading || !wantsVideo()) return;
  // 데이터 절약 모드면 받지 않는다(엔진으로)
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  videoLoading = true;
  for (const m of ["open", "close"] as const) {
    fetch(withBase(`/diary/${m}.mp4`))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        VIDEO[m] = URL.createObjectURL(b);
      })
      .catch(() => {
        videoLoading = false; // 다음 기회에 다시
      });
  }
}
const videoFor = (m: Mode) => (wantsVideo() ? (VIDEO[m] ?? null) : null);
/** 영상 끝 → 앱(펼치기: 진짜 일기 종이, 덮기: 앱 화면)으로 스르르 */
const VIDEO_OUT_MS: Record<Mode, number> = { open: 170, close: 340 };

let warming: Promise<void> | null = null;
/** 앱이 한가할 때 엔진을 받아 두고 무늬도 만들어 둔다 — DREAM 을 누르는 순간 멈칫하지 않게(폰은 영상도 받아 둔다) */
export function preloadDiaryIntro(): void {
  preloadVideos();
  if (warming || typeof window === "undefined") return;
  warming = import("@/lib/diaryIntro/engine")
    .then((m) => m.warmDiaryIntro())
    .catch(() => {
      warming = null;
    });
}

/** 일기 여닫기 연출 — 폰(세로·터치)은 녹화 영상, 그 밖엔(또는 영상을 못 틀면) 책 애니메이션 엔진 */
export function DiaryIntro(props: DiaryIntroProps) {
  const [src, setSrc] = useState(() => videoFor(props.mode));
  if (src) return <VideoIntro {...props} src={src} onFail={() => setSrc(null)} />;
  return <EngineIntro {...props} />;
}

function VideoIntro({ mode, sound, onDone, onCovered, src, onFail }: DiaryIntroProps & { src: string; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<"wait" | "play" | "out">("wait");
  const cb = useRef({ onDone, onCovered, onFail });
  useEffect(() => {
    cb.current = { onDone, onCovered, onFail };
  });
  const fired = useRef(false);
  const finish = useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    cb.current.onDone();
  }, []);
  const first = useRef({ mode, sound });

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const { mode: m, sound: withSound } = first.current;
    let alive = true;
    let voice: { close(fade?: number): void } | null = null;
    const timers: number[] = [];
    const later = (f: () => void, ms: number) => timers.push(window.setTimeout(f, ms));
    // 1.5초 안에 못 틀면(코덱·자동 재생 막힘 등) 엔진으로
    const giveUp = window.setTimeout(() => alive && cb.current.onFail(), 1500);
    const onPlaying = () => {
      window.clearTimeout(giveUp);
      liftVeil();
      setPhase("play");
      if (m === "close") later(() => cb.current.onCovered?.(), 140);
      if (withSound)
        import("@/lib/diaryIntro/engine")
          .then((e) => {
            if (alive) voice = e.introSound(window, m);
          })
          .catch(() => {});
    };
    const onEnded = () => {
      setPhase("out");
      later(finish, VIDEO_OUT_MS[m]);
    };
    const onError = () => {
      window.clearTimeout(giveUp);
      if (alive) cb.current.onFail();
    };
    v.addEventListener("playing", onPlaying, { once: true });
    v.addEventListener("ended", onEnded);
    v.addEventListener("error", onError);
    v.muted = true;
    v.play().catch(onError);
    return () => {
      alive = false;
      window.clearTimeout(giveUp);
      timers.forEach((t) => window.clearTimeout(t));
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("error", onError);
      voice?.close(0.12);
    };
  }, [finish]);

  // 펼치기는 처음부터 어둡게(영상 첫 장면이 어두운 책상), 덮기는 진짜 종이 위로 살짝 나타난다
  const opacity = phase === "play" ? 1 : phase === "out" ? 0 : mode === "open" ? 1 : 0;
  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      preload="auto"
      aria-hidden
      onClick={finish}
      className="visible fixed inset-0 z-[61] h-full w-full bg-[#0b0920] object-cover transition-opacity"
      style={{ opacity, transitionDuration: `${phase === "out" ? VIDEO_OUT_MS[mode] : 120}ms` }}
    />
  );
}

/**
 * 책 애니메이션 엔진(src/lib/diaryIntro)을 필요할 때만 불러와 붙인다.
 * 펼치기: 덮인 책 → 표지가 열리고 촤라락 + 금빛 → 종이가 앞으로 나와 일기장. 덮기: 반대로 덮이며 뒷표지 DIARY.
 * 엔진을 못 불러오면(오프라인 첫 실행 등) 예전처럼 잠깐 어두워졌다 밝아진다.
 */
function EngineIntro({ mode, sound, onDone, onCovered }: DiaryIntroProps) {
  const host = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  // 엔진이 붙기 전 잠깐 — 펼칠 땐 어둡게 가려 둔다(맨 종이가 번쩍 보이지 않게)
  const [mounted, setMounted] = useState(false);
  const doneRef = useRef(onDone);
  const coveredRef = useRef(onCovered);
  useEffect(() => {
    doneRef.current = onDone;
    coveredRef.current = onCovered;
  });
  const fired = useRef(false);
  const finish = useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    doneRef.current();
  }, []);

  // 처음 열 때의 설정으로 한 번만 만든다(재생 중에 설정이 바뀌어도 다시 시작하지 않게)
  const first = useRef({ mode, sound });
  useEffect(() => {
    let cancelled = false;
    let intro: { destroy(): void } | null = null;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("@/lib/diaryIntro/engine")
      .then(({ createDiaryIntro }) => {
        if (cancelled || !host.current) return;
        const it = createDiaryIntro(host.current, {
          mode: first.current.mode,
          reducedMotion: reduce,
          sound: first.current.sound,
          date: new Date(),
          onDone: finish,
          onCovered: () => coveredRef.current?.(),
        });
        intro = it;
        it.play();
        setMounted(true);
        liftVeil();
      })
      .catch((e) => {
        console.warn("[diary] 책 애니메이션을 못 불러와 페이드로 대신해요", e);
        liftVeil();
        if (!cancelled) setFallback(true);
      });
    return () => {
      cancelled = true;
      intro?.destroy();
    };
  }, [finish]);

  useEffect(() => {
    if (!fallback) return;
    const t = window.setTimeout(finish, FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, [fallback, finish]);

  if (fallback) {
    return (
      <div
        aria-hidden
        onClick={finish}
        className={cx("fixed inset-0 z-[61] bg-[#0b0920]", mode === "open" ? "diary-veil-out" : "diary-veil-in")}
        style={{ animationDuration: `${FALLBACK_MS}ms` }}
      />
    );
  }
  // visible: 덮을 때 부모(일기 화면)를 숨겨도 이 장면은 보이게
  return <div ref={host} aria-hidden className={cx("visible fixed inset-0 z-[61]", mode === "open" && !mounted && "bg-[#0b0920]")} />;
}
