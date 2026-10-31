"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { registerServiceWorker } from "./notify";
import { VAPID_PUBLIC_KEY } from "./supabase";

/**
 * Web Push 구독 — 앱이 완전히 닫혀 있어도 서버(Supabase pg_cron → Edge Function)가 알림을 보낸다.
 * 기기마다 구독이 하나씩 생기고 push_subscriptions 테이블에 저장된다.
 */

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    Boolean(VAPID_PUBLIC_KEY)
  );
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await registerServiceWorker();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

const BRIEFING_KEY = "must:briefing-time";
/** 아침 브리핑 기본 시각(폰) — 아침에 폰을 켜면 이미 와 있게 */
export const DEFAULT_BRIEFING = "07:00";
export const isPhone = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/** 이 기기의 아침 브리핑 시각 — 폰은 기본 07:00, 노트북·PC 는 끔(앱을 켤 때 브리핑) */
export function briefingTime(): string | null {
  try {
    const v = localStorage.getItem(BRIEFING_KEY);
    if (v === "off") return null;
    if (v && /^\d{2}:\d{2}$/.test(v)) return v;
  } catch {
    /* 읽지 못하면 기본값 */
  }
  return isPhone() ? DEFAULT_BRIEFING : null;
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "안드로이드 폰" : "안드로이드 태블릿";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Mac OS X/i.test(ua)) return "Mac";
  return "기타 기기";
}

/** 브리핑 시각을 바꾸고, 이 기기가 푸시 등록돼 있으면 서버에도 바로 반영 */
export async function setBriefingTime(client: SupabaseClient | null, time: string | null) {
  try {
    localStorage.setItem(BRIEFING_KEY, time ?? "off");
  } catch {
    /* 저장 못 해도 서버엔 반영 */
  }
  const sub = await currentPushSubscription();
  if (client && sub) {
    const { error } = await client
      .from("push_subscriptions")
      // last_briefing_on 은 건드리지 않는다 — 오늘 이미 받았으면 바뀐 시각은 내일부터
      .update({ briefing_time: time })
      .eq("endpoint", sub.endpoint);
    if (error) throw new Error(error.message);
  }
}

async function save(client: SupabaseClient, userId: string, sub: PushSubscription) {
  const json = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
  const { error } = await client.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      user_agent: navigator.userAgent.slice(0, 300),
      device_name: deviceName(),
      briefing_time: briefingTime(),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error(error.message);
}

const subscribe = (reg: ServiceWorkerRegistration) =>
  reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });

// 사용자가 설정에서 '등록 해제'를 눌렀는지 — 눌렀으면 앱이 저절로 다시 켜지 않는다(로그아웃은 해당 없음)
const OPT_OUT_KEY = "must:push-off";
export function pushOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}
function setOptOut(on: boolean) {
  try {
    if (on) localStorage.setItem(OPT_OUT_KEY, "1");
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* 저장 못 하면 다음에 다시 켜질 수 있음 */
  }
}

/** 설정의 '이 기기 등록' — 사용자 제스처 안에서, 알림 권한을 받은 뒤 호출. 서버에 없는(죽은) 구독이면 새로 받는다 */
export async function subscribePush(client: SupabaseClient, userId: string): Promise<void> {
  setOptOut(false);
  // 앱이 막 살피던 중이면 끝나길 기다렸다가(구독을 둘이 동시에 갈아끼우지 않게)
  if (checking) await checking.catch(() => null);
  checking = check(client, userId, true).finally(() => {
    checking = null;
  });
  const st = await checking;
  if (st.state !== "ok") throw new Error(pushProblem(st) ?? "등록하지 못했어요");
}

// ───────────── 이 기기 푸시 상태 — 앱을 열 때마다 살피고 고친다 ─────────────
/**
 * ok: 서버에 등록돼 있음 · none: 등록 안 함(PC 기본) · off: 사용자가 직접 끔
 * ask: 알림 권한을 다시 받아야 함 · blocked: 권한 차단 · error: 등록 실패 · unsupported: 지원 안 함
 */
export type PushState = "unknown" | "ok" | "none" | "off" | "ask" | "blocked" | "error" | "unsupported";
export interface PushStatus {
  state: PushState;
  error?: string;
  at: number;
}

let status: PushStatus = { state: "unknown", at: 0 };
const listeners = new Set<() => void>();
export const pushStatus = () => status;
export function onPushStatus(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function setStatus(s: PushStatus) {
  status = s;
  listeners.forEach((fn) => fn());
}

// 인터넷이 잠깐 끊긴 것 — 고장으로 띄우지 않고 다음에 다시 본다
const offlineError = (m: string) => /fetch|network|load failed|offline/i.test(m);

let checking: Promise<PushStatus> | null = null;

/**
 * 이 기기 푸시가 살아 있는지 보고 고친다(앱을 열 때·다시 볼 때·브라우저가 구독을 갈아끼울 때).
 *  · 서버에 이 기기 구독이 없으면(푸시 서버가 '만료'라고 해 서버가 지웠거나 저장이 실패했던 것) → 새로 구독해 다시 저장
 *  · 폰인데 구독이 없고 권한은 있으면 → 조용히 다시 구독(권한 창 없음)
 *  · 권한이 없거나 막혔으면 → 상태만 알린다(화면의 '알림 켜기' 카드가 받아서 보여 준다)
 */
export function ensurePush(client: SupabaseClient, userId: string): Promise<PushStatus> {
  checking ??= check(client, userId, false).finally(() => {
    checking = null;
  });
  return checking;
}

/** 사람이 읽는 문제 설명(정상이면 null) */
export function pushProblem(st: PushStatus): string | null {
  if (st.state === "ask") return "알림 권한이 꺼져 있어요";
  if (st.state === "blocked") return "알림이 차단돼 있어요 — 폰 설정에서 이 앱(또는 Chrome)의 알림을 허용해 주세요";
  if (st.state === "error") return `알림 등록이 안 됐어요${st.error ? ` (${st.error.slice(0, 80)})` : ""}`;
  if (st.state === "unsupported") return "이 브라우저는 서버 푸시를 지원하지 않아요";
  return null;
}

/** force: 사용자가 직접 켠 것 — PC 라도 구독을 만든다 */
async function check(client: SupabaseClient, userId: string, force: boolean): Promise<PushStatus> {
  const done = (state: PushState, error?: string) => {
    setStatus({ state, error, at: Date.now() });
    return status;
  };
  if (!pushSupported()) return done("unsupported");
  if (pushOptedOut()) return done("off");
  if (!force && navigator.onLine === false) return status;
  const perm = Notification.permission;
  try {
    const reg = await registerServiceWorker();
    if (!reg) return done("error", "서비스 워커를 등록하지 못했어요");
    let sub = await reg.pushManager.getSubscription();
    const had = Boolean(sub) || hadPush();
    if (perm === "denied") return done("blocked");
    if (perm !== "granted") return done("ask");
    if (sub) {
      const { data, error } = await client.from("push_subscriptions").select("id").eq("endpoint", sub.endpoint).maybeSingle();
      if (error) return !force && offlineError(error.message) ? status : done("error", error.message);
      if (!data) {
        // 서버에 없는 구독 = 죽었을 수 있다 → 버리고 새로
        await sub.unsubscribe().catch(() => false);
        sub = null;
      }
    }
    if (!sub) {
      // PC 는 사용자가 '이 기기 등록'을 눌러야 켠다(예전처럼). 폰은 알림이 핵심이라 저절로
      if (!force && !isPhone() && !had) return done("none");
      sub = await subscribe(reg);
    }
    await save(client, userId, sub);
    markHadPush();
    return done("ok");
  } catch (e) {
    const m = (e as Error).message || String(e);
    return !force && offlineError(m) ? status : done("error", m);
  }
}

// 이 기기가 한 번이라도 서버 푸시에 등록됐었는지 — PC 도 등록했던 적이 있으면 구독이 죽었을 때 다시 살린다
const HAD_KEY = "must:push-had";
function hadPush() {
  try {
    return localStorage.getItem(HAD_KEY) === "1";
  } catch {
    return false;
  }
}
function markHadPush() {
  try {
    localStorage.setItem(HAD_KEY, "1");
  } catch {
    /* 못 적어도 이번 등록은 됨 */
  }
}

/** 이 기기 구독을 지운다. byUser: 설정에서 직접 끈 것 → 다음에 앱을 열어도 저절로 다시 켜지 않는다 */
export async function unsubscribePush(client: SupabaseClient, byUser = false) {
  if (byUser) setOptOut(true);
  const sub = await currentPushSubscription();
  if (byUser) setStatus({ state: "off", at: Date.now() });
  if (!sub) return;
  await client.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

export async function sendTestPush(client: SupabaseClient) {
  const { data, error } = await client.functions.invoke("push-test", { body: {} });
  if (error) throw new Error(error.message);
  return data as { sent: number; removed: number; failed: number };
}
