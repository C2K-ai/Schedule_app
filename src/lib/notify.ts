"use client";

import { withBase } from "./base";
import { VIBRATIONS } from "./sound";
import type { AlarmKind, VibrationKey } from "./types";

export type PermissionState = NotificationPermission | "unsupported";

export function notificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): PermissionState {
  if (!notificationSupported()) return "unsupported";
  return Notification.permission;
}

/** 반드시 버튼 클릭 같은 사용자 제스처 안에서 호출 (iOS 요구사항) */
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (!notificationSupported()) return "unsupported";
  return Notification.requestPermission();
}

let swReg: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  if (!swReg) {
    const mode = process.env.NODE_ENV === "production" ? "production" : "development";
    swReg = navigator.serviceWorker
      .register(withBase(`/sw.js?mode=${mode}`), { scope: withBase("/"), updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .catch((e) => {
        console.warn("[must] 서비스 워커 등록 실패", e);
        return null;
      });
  }
  return swReg;
}

type RichOptions = NotificationOptions & {
  actions?: { action: string; title: string }[];
  vibrate?: number[];
  renotify?: boolean;
  timestamp?: number;
};

export interface LocalNotice {
  title: string;
  body: string;
  tag: string;
  kind: AlarmKind;
  taskId?: string;
  startsAt?: string;
  vibration: VibrationKey;
}

/** 앱(탭)이 살아 있을 때 직접 띄우는 시스템 알림. 서버 푸시와 tag 가 같아서 중복으로 쌓이지 않는다. */
export async function showSystemNotification(n: LocalNotice) {
  if (notificationPermission() !== "granted") return false;
  const urgent = n.kind === "start" || n.kind === "overdue" || n.kind === "snooze";
  const opts: RichOptions = {
    body: n.body,
    tag: n.tag,
    icon: withBase("/icons/icon-192.png"),
    badge: withBase("/icons/badge-96.png"),
    requireInteraction: urgent,
    renotify: n.kind === "overdue",
    vibrate: VIBRATIONS[n.vibration]?.pattern ?? [],
    timestamp: n.startsAt ? Date.parse(n.startsAt) : Date.now(),
    data: { taskId: n.taskId, kind: n.kind, startsAt: n.startsAt },
    actions: urgent
      ? [
          { action: "start", title: "▶ 지금 시작" },
          { action: "snooze", title: "⏱ 5분 뒤 다시" },
        ]
      : [{ action: "open", title: "열기" }],
  };
  const reg = await registerServiceWorker();
  try {
    if (reg) {
      await reg.showNotification(n.title, opts);
    } else {
      new Notification(n.title, opts);
    }
    return true;
  } catch (e) {
    console.warn("[must] 알림 표시 실패", e);
    return false;
  }
}

/** 설치된 앱 아이콘에 숫자 배지(미처리 일정 수) */
export function setAppBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) void nav.setAppBadge?.(count);
    else void nav.clearAppBadge?.();
  } catch {
    /* 지원 안 함 */
  }
}

/** 설치한 앱으로 열렸는지 — PC 앱의 제목 줄 숨김 모드·전체 화면도 설치한 앱이다 */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    ["standalone", "window-controls-overlay", "fullscreen", "minimal-ui"].some((m) => window.matchMedia(`(display-mode: ${m})`).matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** 화면 꺼짐 방지 (집중 모드) */
export async function requestWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
  };
  try {
    return (await nav.wakeLock?.request("screen")) ?? null;
  } catch {
    return null;
  }
}
