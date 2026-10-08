"use client";

import { useEffect } from "react";
import { lockCardSupported, syncLockCard } from "@/lib/lockCard";
import { usePlanner } from "./PlannerProvider";

/** 화면 없는 컴포넌트 — 일정이 바뀔 때·앱을 내릴 때·1분마다 잠금화면 카드 내용을 서비스 워커에 넘긴다 */
export function LockCardSync() {
  const { tasks, settings } = usePlanner();
  const on = settings.lockCard;

  useEffect(() => {
    if (!lockCardSupported()) return;
    const sync = () => void syncLockCard(on ? tasks : null);
    sync();
    if (!on) return;
    // 앱을 내리는 순간 잠금화면에 바로 보이게(지웠던 카드도 다시) + 앱이 떠 있는 동안 일정 시작·끝에 맞춰
    const onVis = () => {
      if (document.visibilityState === "hidden") sync();
    };
    document.addEventListener("visibilitychange", onVis);
    const id = window.setInterval(sync, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(id);
    };
  }, [on, tasks]);

  return null;
}
