// Edge Function 공용 — Web Push 발송, 알림 문구, 알림 버튼용 서명 토큰
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { setting } from "./env.ts";

export { admin, cors, json, setting } from "./env.ts";

let vapidReady = false;
async function ensureVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(
    await setting("VAPID_SUBJECT", "mailto:admin@example.com"),
    await setting("VAPID_PUBLIC_KEY"),
    await setting("VAPID_PRIVATE_KEY"),
  );
  vapidReady = true;
}

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  kind: "before" | "start" | "overdue" | "snooze" | "briefing" | "signup";
  seq?: number;
  taskId?: string;
  startsAt?: string;
  url?: string;
  requireInteraction?: boolean;
  renotify?: boolean;
  vibrate?: number[];
  actionUrl?: string;
  actionToken?: string;
  badgeCount?: number;
  /** 알림 본문을 눌렀을 때 앱이 할 일(예: "admin" = 관리자 화면 열기) */
  openAction?: string;
}

export interface SendResult {
  sent: number;
  removed: number;
  failed: number;
  errors: string[];
}

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** 기기 하나로 보낸다. 만료된 구독(404/410)이면 지우고 "removed" */
export async function sendToSubscription(
  db: SupabaseClient,
  s: PushTarget,
  payload: PushPayload,
  ttlSec = 900,
): Promise<"sent" | "removed" | string> {
  await ensureVapid();
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify(payload),
      // urgency high: 안드로이드 절전(Doze) 중에도 바로 깨워서 보낸다
      { TTL: ttlSec, urgency: "high" },
    );
    return "sent";
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) {
      await db.from("push_subscriptions").delete().eq("id", s.id);
      return "removed";
    }
    return `${code ?? "?"} ${(e as Error).message}`.slice(0, 200);
  }
}

/** 이 사용자의 모든 기기로 보낸다. 만료된 구독(404/410)은 지운다. */
export async function sendToUser(
  db: SupabaseClient,
  userId: string,
  payload: PushPayload,
  ttlSec = 900,
): Promise<SendResult> {
  const { data: subs, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error) return { sent: 0, removed: 0, failed: 1, errors: [error.message] };
  const r: SendResult = { sent: 0, removed: 0, failed: 0, errors: [] };
  await Promise.all(
    (subs ?? []).map(async (s) => {
      const out = await sendToSubscription(db, s, payload, ttlSec);
      if (out === "sent") r.sent++;
      else if (out === "removed") r.removed++;
      else {
        r.failed++;
        r.errors.push(out);
      }
    }),
  );
  return r;
}

// ───────────── 알림 문구 (앱 src/lib/reminders.ts 의 describeTrigger 와 같은 톤) ─────────────
const hhmm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));

const span = (ms: number) => {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 1) return "1분 미만";
  const h = Math.floor(m / 60);
  return h ? (m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`) : `${m}분`;
};

export function describe(
  kind: Exclude<PushPayload["kind"], "briefing" | "signup">,
  seq: number,
  t: { title: string; starts_at: string; ends_at: string },
  now: number,
  tz: string,
): { title: string; body: string } {
  const range = `${hhmm(t.starts_at, tz)}–${hhmm(t.ends_at, tz)}`;
  switch (kind) {
    case "before": {
      const left = Math.round((Date.parse(t.starts_at) - now) / 60000);
      return { title: `⏰ ${left >= 1 ? `${left}분 뒤 시작` : "곧 시작"} · ${t.title}`, body: `${range} · 지금 정리하고 준비하세요` };
    }
    case "start":
      return { title: `▶ 지금 시작: ${t.title}`, body: `${range} · 미루지 말고 바로 시작` };
    case "snooze":
      return { title: `🔁 다시 알림: ${t.title}`, body: `${range} · 아직 시작 전입니다` };
    case "overdue": {
      const tone =
        seq >= 3 ? "지금 못 하면 앱에서 미루기를 눌러 두세요." : seq === 2 ? "지금이라도 시작하세요." : "시작하거나 사유를 남기세요.";
      return {
        title: `⚠ 시작 안 함 (${span(now - Date.parse(t.starts_at))} 지남) · ${t.title}`,
        body: `${range} · ${tone}`,
      };
    }
  }
}

export const VIBRATIONS: Record<string, number[]> = {
  none: [],
  short: [150],
  double: [120, 80, 120],
  heartbeat: [90, 90, 90, 500, 90, 90, 90],
  sos: [100, 60, 100, 60, 100, 200, 300, 60, 300, 60, 300, 200, 100, 60, 100, 60, 100],
  alarm: [600, 200, 600, 200, 600, 200, 600],
};

// ───────────── 알림 버튼 토큰 ─────────────
// 잠금화면의 "5분 뒤 다시"/"지금 시작" 은 로그인 세션 없이 서비스 워커가 호출한다.
// 그래서 일정 id + 만료시각을 서버 비밀키로 서명한 토큰을 알림에 실어 보낸다.
const enc = new TextEncoder();
let hmacKey: Promise<CryptoKey> | null = null;
const key = () =>
  (hmacKey ??= setting("ACTION_SECRET").then((secret) =>
    crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  ));

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function signAction(taskId: string, ttlSec = 6 * 3600): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const msg = `${taskId}.${exp}`;
  return `${msg}.${b64url(await crypto.subtle.sign("HMAC", await key(), enc.encode(msg)))}`;
}

/** 올바른 토큰이면 일정 id, 아니면 null */
export async function verifyAction(token: string): Promise<string | null> {
  const [taskId, exp, sig] = token.split(".");
  if (!taskId || !exp || !sig || Number(exp) * 1000 < Date.now()) return null;
  const expected = b64url(await crypto.subtle.sign("HMAC", await key(), enc.encode(`${taskId}.${exp}`)));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? taskId : null;
}
