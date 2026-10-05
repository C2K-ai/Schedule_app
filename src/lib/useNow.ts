"use client";

import { useSyncExternalStore } from "react";

/**
 * 공유 시계. 같은 간격을 쓰는 컴포넌트들은 타이머 하나를 나눠 쓴다.
 * 카운트다운은 1초, 타임라인의 '지금' 선은 30초 정도면 충분하다.
 */
interface Clock {
  now: number;
  subs: Set<() => void>;
  timer: number | null;
  tick: () => void;
}

const clocks = new Map<number, Clock>();

function clock(interval: number): Clock {
  let c = clocks.get(interval);
  if (!c) {
    const created: Clock = {
      now: Date.now(),
      subs: new Set(),
      timer: null,
      tick: () => {
        created.now = Date.now();
        created.subs.forEach((s) => s());
      },
    };
    clocks.set(interval, created);
    c = created;
  }
  return c;
}

export function useNow(interval = 1000): number {
  return useSyncExternalStore(
    (cb) => {
      const c = clock(interval);
      c.subs.add(cb);
      if (c.timer === null) {
        c.tick();
        c.timer = window.setInterval(c.tick, interval);
        document.addEventListener("visibilitychange", c.tick);
      }
      return () => {
        c.subs.delete(cb);
        if (c.subs.size === 0 && c.timer !== null) {
          window.clearInterval(c.timer);
          document.removeEventListener("visibilitychange", c.tick);
          c.timer = null;
        }
      };
    },
    () => clock(interval).now,
    () => 0,
  );
}
