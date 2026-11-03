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
  /** 같은 일정의 몇 번째 알림인지(곧 시작 = 몇 분 전, 미시작 = 1·2·3) — 같은 것이 이미 떠 있으면 다시 안 띄운다 */
  seq?: number;
  vibration: VibrationKey;
  /** 무음 알람 모드 — 소리·진동 없이 알림만 */
  silent?: boolean;
  /** 같은 자리(tag)의 알림을 바꿀 때 다시 울릴지 — 일정 알림은 켬, 브리핑은 끔 */
  renotify?: boolean;
}

/** 같은 자리(tag)에 같은 종류·회차 알림이 이미 떠 있는지 — 서버 푸시가 먼저 왔거나 두 번 불린 것 */
export async function alreadyShown(reg: ServiceWorkerRegistration, tag: string, kind: string, seq = 0): Promise<boolean> {
  try {
    const list = await reg.getNotifications({ tag });
    return list.some((x) => {
      const d = x.data as { kind?: string; seq?: number } | null;
      return d?.kind === kind && (d?.seq ?? 0) === seq;
    });
  } catch {
    return false;
  }
}

/** 앱(탭)이 살아 있을 때 직접 띄우는 시스템 알림. 서버 푸시와 tag 가 같아서 중복으로 쌓이지 않는다. */
export async function showSystemNotification(n: LocalNotice) {
  if (notificationPermission() !== "granted") return false;
  const urgent = n.kind === "start" || n.kind === "overdue" || n.kind === "snooze";
  const reg = await registerServiceWorker();
  if (reg && (await alreadyShown(reg, n.tag, n.kind, n.seq ?? 0))) return true;
  const opts: RichOptions = {
    body: n.body,
    tag: n.tag,
    icon: withBase("/icons/icon-192.png"),
    badge: withBase("/icons/badge-96.png"),
    requireInteraction: urgent,
    // 같은 일정 자리에서 다음 알림(곧 시작 → 정각 → 미시작)으로 바뀔 때도 다시 울린다. 무음이면 조용히
    renotify: Boolean((n.renotify ?? true) && !n.silent),
    // 브라우저 규칙: 소리 없는 알림엔 진동 패턴을 줄 수 없다(같이 주면 알림이 안 뜸)
    ...(n.silent ? { silent: true } : { vibrate: VIBRATIONS[n.vibration]?.pattern ?? [] }),
    timestamp: n.startsAt ? Date.parse(n.startsAt) : Date.now(),
    data: { taskId: n.taskId, kind: n.kind, seq: n.seq ?? 0, startsAt: n.startsAt },
    actions: urgent
      ? [
          { action: "start", title: "▶ 지금 시작" },
          { action: "snooze", title: "⏱ 5분 뒤 다시" },
        ]
      : [{ action: "open", title: "열기" }],
  };
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
