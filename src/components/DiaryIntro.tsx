"use client";

import { useCallback, useEffect, useRef } from "react";
import { cx } from "./ui";

export interface DiaryIntroProps {
  /** open = 일기를 펼칠 때(어둠 → 종이), close = 덮을 때(종이 → 어둠) */
  mode: "open" | "close";
  /** 책 효과음(설정 → 소리 → 일기). 지금 임시 화면은 소리를 내지 않는다 */
  sound: boolean;
  /** 다 끝났을 때(또는 눌러서 건너뛰었을 때) 한 번 */
  onDone: () => void;
}

const MS = 350;

/** 여닫기 연출에 소리가 있는지 — 지금 임시 화면은 소리가 없어서 효과음 버튼·설정을 숨긴다(진짜 책 애니메이션을 넣을 때 true) */
export const DIARY_INTRO_SOUND = false;

/**
 * 일기 여닫기 연출 — 지금은 잠깐 어두워졌다 밝아지는 임시 화면.
 * 나중에 진짜 책 애니메이션(펼치기 / 반대로 덮이며 뒷표지 DIARY)이 이 자리를 그대로 바꾼다 — props 는 그대로 둘 것.
 */
export function DiaryIntro({ mode, onDone }: DiaryIntroProps) {
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

  useEffect(() => {
    // 움직임 줄이기를 켠 사람은 기다리지 않는다
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(finish, reduce ? 0 : MS);
    return () => window.clearTimeout(t);
  }, [finish]);

  return (
    <div
      aria-hidden
      onClick={finish}
      className={cx("fixed inset-0 z-[61] bg-[#0b0920]", mode === "open" ? "diary-veil-out" : "diary-veil-in")}
      style={{ animationDuration: `${MS}ms` }}
    />
  );
}
