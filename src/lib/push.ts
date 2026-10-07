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
const isPhone = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/** 이 기기의 아침 브리핑 시각 — 폰은 기본 10:00, 노트북·PC 는 끔(앱을 켤 때 브리핑) */
export function briefingTime(): string | null {
  try {
    const v = localStorage.getItem(BRIEFING_KEY);
    if (v === "off") return null;
    if (v && /^\d{2}:\d{2}$/.test(v)) return v;
  } catch {
    /* 읽지 못하면 기본값 */
  }
  return isPhone() ? "10:00" : null;
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
      .update({ briefing_time: time, last_briefing_on: null })
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

/** 사용자 제스처 안에서 호출 */
export async function subscribePush(client: SupabaseClient, userId: string): Promise<PushSubscription> {
  const reg = await registerServiceWorker();
  if (!reg) throw new Error("서비스 워커를 등록하지 못했습니다");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  await save(client, userId, sub);
  return sub;
}

/** 앱을 열 때마다 구독을 다시 저장 — 브라우저가 구독을 갈아끼웠을 때(pushsubscriptionchange) 복구 */
export async function refreshPushSubscription(client: SupabaseClient, userId: string) {
  const sub = await currentPushSubscription();
  if (sub) await save(client, userId, sub).catch(() => {});
  return sub;
}

export async function unsubscribePush(client: SupabaseClient) {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await client.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

export async function sendTestPush(client: SupabaseClient) {
  const { data, error } = await client.functions.invoke("push-test", { body: {} });
  if (error) throw new Error(error.message);
  return data as { sent: number; removed: number; failed: number };
}
