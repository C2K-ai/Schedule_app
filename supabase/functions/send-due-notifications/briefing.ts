// 기기별 아침 브리핑 — claim_due_briefings() 가 꺼낸 기기마다 오늘 일정 목록(시각 순서 + 시간 미정) · 미시작 n건
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { safeTz, sendToSubscription, VIBRATIONS, type PushPayload } from "../_shared/push.ts";

export interface BriefTask {
  title: string;
  status: string;
  starts_at: string;
  schedule: string | null;
  strict: boolean;
}

const hhmm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));

/** 브리핑에 이름을 적는 일정 수 — 넘으면 '외 n개' */
export const BRIEF_MAX = 8;
/** 브리핑 푸시를 푸시 서버가 들고 있는 시간 */
export const BRIEF_TTL_SEC = 6 * 3600;
const short = (s: string) => (s.length > 20 ? `${s.slice(0, 19)}…` : s);

/**
 * 앱의 buildBriefing(src/lib/briefing.ts)과 같은 문구. 시간표 수업은 넣지 않는다(사용자 요청 2026-11-03).
 *   1줄: 시각 있는 일정 "09:00 회의 · 14:30 병원"(접힌 알림에도 보이는 줄)
 *   2줄: "시간 미정 · 장보기, 보고서" — 날짜만 정한 일정도 이름으로
 *   끝줄: 미시작 n건 · 했는지 확인할 일정 n건
 * overdue = 지금 시간 안의 미시작 강제 일정 수(앱 enforcementQueue), unchecked = 끝났는데 체크 안 한 일정 수(앱 checkinQueue)
 */
export function briefingText(tasks: BriefTask[], tz: string, overdue: number, unchecked = 0): { title: string; body: string } {
  const open = tasks.filter((t) => t.status === "planned" || t.status === "in_progress");
  const timed = (t: BriefTask) => (t.schedule ?? "timed") === "timed";
  const withTime = open
    .filter(timed)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((t) => ({ t, at: hhmm(t.starts_at, tz) }));
  const noTime = open.filter((t) => !timed(t));
  // 시간 미정 일정이 있으면 그 자리를 남겨 둔다(둘 다 보이게)
  const shownTimed = withTime.slice(0, noTime.length ? BRIEF_MAX - Math.min(noTime.length, 3) : BRIEF_MAX);
  const shownNoTime = noTime.slice(0, BRIEF_MAX - shownTimed.length);
  const rest = open.length - shownTimed.length - shownNoTime.length;
  const lines = [
    shownTimed.map(({ t, at }) => `${at} ${short(t.title)}`).join(" · "),
    shownNoTime.length ? `시간 미정 · ${shownNoTime.map((t) => short(t.title)).join(", ")}` : "",
    rest > 0 ? `외 ${rest}개` : "",
    [overdue ? `미시작 ${overdue}건` : "", unchecked ? `했는지 확인할 일정 ${unchecked}건` : ""].filter(Boolean).join(" · "),
  ].filter(Boolean);
  if (!open.length) lines.unshift("오늘 잡힌 일정이 없어요");
  return { title: open.length ? `☀ 오늘 일정 ${open.length}개` : "☀ 좋은 아침이에요", body: lines.join("\n") };
}

/** sendToSubscription 의 오류 문자열("403 ...", "? ...")에서 다시 해 볼 만한지 */
export function retryable(err: string): boolean {
  const code = Number(err.split(" ")[0]);
  return !Number.isFinite(code) || code === 429 || code >= 500;
}

interface Due {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  tz: string;
  local_day: string;
  day_start: string;
  day_end: string;
}

export async function sendBriefings(db: SupabaseClient): Promise<{ briefed: number; failed: number }> {
  const { data, error } = await db.rpc("claim_due_briefings");
  if (error) throw new Error(error.message);
  let briefed = 0,
    failed = 0;
  for (const d of (data ?? []) as Due[]) {
    // 한 기기에서 난 오류가 뒤 사람들의 브리핑을 막지 않게(보안 점검 2026-10-11)
    try {
      const { data: tasks } = await db
        .from("tasks")
        .select("title, status, starts_at, schedule, strict")
        .eq("user_id", d.user_id)
        .is("deleted_at", null)
        .neq("schedule", "someday")
        .gte("starts_at", d.day_start)
        .lt("starts_at", d.day_end);
      const now = Date.now();
      const { data: prof } = await db.from("profiles").select("grace_min").eq("id", d.user_id).maybeSingle();
      const grace = prof?.grace_min ?? 5;
      const nowIso = new Date(now).toISOString();
      const [{ count: overdue }, { count: unchecked }] = await Promise.all([
        // 지금 시간 안의 미시작 강제 일정
        db
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("user_id", d.user_id)
          .is("deleted_at", null)
          .eq("status", "planned")
          .eq("strict", true)
          .eq("schedule", "timed")
          .lt("starts_at", new Date(now - grace * 60_000).toISOString())
          .gt("ends_at", nowIso),
        // 끝났는데 체크 안 한 일정(최근 7일) — 실패가 아니라 '했나요?'. 날짜만 일정은 그날이 지나면(앱 checkinQueue 와 같게)
        db
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("user_id", d.user_id)
          .is("deleted_at", null)
          .eq("status", "planned")
          .in("schedule", ["timed", "day"])
          .lte("ends_at", nowIso)
          .gt("ends_at", new Date(now - 7 * 86_400_000).toISOString()),
      ]);
      const text = briefingText((tasks ?? []) as BriefTask[], safeTz(d.tz), overdue ?? 0, unchecked ?? 0);
      const payload: PushPayload = {
        ...text,
        tag: `must-briefing-${d.local_day}`,
        kind: "briefing",
        url: "/",
        requireInteraction: false,
        vibrate: VIBRATIONS.short,
      };
      // 6시간 동안 살려 둔다 — 그때 폰이 꺼져 있었어도 아침에 켜면 와 있게
      const r = await sendToSubscription(db, d, payload, BRIEF_TTL_SEC);
      if (r === "sent") briefed++;
      else if (r !== "removed") {
        failed++;
        // 잠깐의 실패(네트워크·429·5xx)만 다음 분에 다시 — 계속 거절되는 기기는 오늘은 포기(매분 3시간 재시도 방지)
        if (retryable(r)) await db.from("push_subscriptions").update({ last_briefing_on: null }).eq("id", d.id);
      }
    } catch (e) {
      failed++;
      console.error("briefing", d.id, String(e).slice(0, 200));
    }
  }
  return { briefed, failed };
}
