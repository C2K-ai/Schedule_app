"use client";

import { useSyncExternalStore } from "react";

/**
 * 공유 시계. 같은 간격을 쓰는 컴포넌트들은 타이머 하나를 나눠 쓴다.
 * 카운트다운은 1초, 타임라인의 '지금' 선은 30초 정도면 충분하다.
 *
 * subscribe/getSnapshot 은 간격별로 한 번만 만들어 재사용한다 — 렌더마다 새 함수를 넘기면
 * React 가 매번 다시 구독해서 무한 렌더가 난다.
 */
interface Clock {
  now: number;
  subs: Set<() => void>;
  timer: number | null;
  tick: () => void;
  subscribe: (cb: () => void) => () => void;
  get: () => number;
}

const clocks = new Map<number, Clock>();

function clock(interval: number): Clock {
  const existing = clocks.get(interval);
  if (existing) return existing;
  const c: Clock = {
    now: Date.now(),
    subs: new Set(),
    timer: null,
    tick: () => {
      c.now = Date.now();
      c.subs.forEach((s) => s());
    },
    subscribe: (cb) => {
      c.subs.add(cb);
      if (c.timer === null) {
        c.now = Date.now(); // 조용히 갱신만 — 구독 중에 알리면 렌더 루프가 생긴다
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
    get: () => c.now,
  };
  clocks.set(interval, c);
  return c;
}

const serverNow = () => 0;

export function useNow(interval = 1000): number {
  const c = clock(interval);
  return useSyncExternalStore(c.subscribe, c.get, serverNow);
}
