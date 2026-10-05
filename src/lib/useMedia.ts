"use client";

import { useSyncExternalStore } from "react";

/** CSS 미디어 쿼리 구독 — 예: useMedia("(min-width: 768px)") */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
