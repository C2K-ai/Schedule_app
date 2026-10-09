"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "./ui";

export interface DiaryIntroProps {
  /** open = 일기를 펼칠 때(덮인 책 → 종이), close = 덮을 때(종이 → 덮인 책, 뒷표지 DIARY) */
  mode: "open" | "close";
  /** 책 효과음(설정 → 일기 열고 닫을 때 효과음, 기본 꺼짐) */
  sound: boolean;
  /** 다 끝났을 때(또는 눌러서 건너뛰었을 때) 한 번 */
  onDone: () => void;
}

/** 엔진을 못 불러왔을 때 대신 보여 주는 짧은 페이드 */
const FALLBACK_MS = 350;

/** 여닫기 연출에 소리가 있는지 — 효과음 설정 스위치를 보여 줄지 */
export const DIARY_INTRO_SOUND = true;

/**
 * 일기 여닫기 연출 — 책 애니메이션 엔진(src/lib/diaryIntro)을 필요할 때만 불러와 붙인다.
 * 펼치기: 덮인 책 → 표지가 열리고 촤라락 + 금빛 → 종이가 앞으로 나와 일기장. 덮기: 반대로 덮이며 뒷표지 DIARY.
 * 엔진을 못 불러오면(오프라인 첫 실행 등) 예전처럼 잠깐 어두워졌다 밝아진다.
 */
export function DiaryIntro({ mode, sound, onDone }: DiaryIntroProps) {
  const host = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  // 엔진이 붙기 전 잠깐 — 펼칠 땐 어둡게 가려 둔다(맨 종이가 번쩍 보이지 않게)
  const [mounted, setMounted] = useState(false);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
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
        });
        intro = it;
        it.play();
        setMounted(true);
      })
      .catch((e) => {
        console.warn("[diary] 책 애니메이션을 못 불러와 페이드로 대신해요", e);
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
  return <div ref={host} aria-hidden className={cx("fixed inset-0 z-[61]", mode === "open" && !mounted && "bg-[#0b0920]")} />;
}
