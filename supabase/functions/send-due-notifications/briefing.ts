// 기기별 아침 브리핑 — claim_due_briefings() 가 꺼낸 기기마다 "오늘 할 일 n개 · 다음 HH:MM 무엇 · 미시작 n건"
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendToSubscription, VIBRATIONS, type PushPayload } from "../_shared/push.ts";

export interface BriefTask {
  title: string;
  status: string;
  starts_at: string;
  schedule: string | null;
  strict: boolean;
}

const hhmm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));

/** 앱의 buildBriefing(src/components/Briefing.tsx)과 같은 문구. overdue = 최근 7일 미시작 강제 일정 수(앱의 enforcementQueue 와 같은 기준) */
export function briefingText(tasks: BriefTask[], now: number, tz: string, graceMin: number, overdue: number): { title: string; body: string } {
  const open = tasks.filter((t) => t.status === "planned" || t.status === "in_progress");
  const timed = (t: BriefTask) => (t.schedule ?? "timed") === "timed";
  const first = open
    .filter((t) => timed(t) && Date.parse(t.starts_at) >= now - graceMin * 60_000)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const parts = [
    open.length ? `오늘 할 일 ${open.length}개` : "오늘 잡힌 할 일이 없어요",
    first ? `다음 ${hhmm(first.starts_at, tz)} ${first.title}` : null,
    overdue ? `미시작 ${overdue}건` : null,
  ].filter(Boolean);
  return { title: "☀ 좋은 아침이에요", body: parts.join(" · ") };
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
    const { count: overdue } = await db
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", d.user_id)
      .is("deleted_at", null)
      .eq("status", "planned")
      .eq("strict", true)
      .eq("schedule", "timed")
      .lt("starts_at", new Date(now - grace * 60_000).toISOString())
      .gt("starts_at", new Date(now - 7 * 86_400_000).toISOString());
    const text = briefingText((tasks ?? []) as BriefTask[], now, d.tz, grace, overdue ?? 0);
    const payload: PushPayload = {
      ...text,
      tag: `must-briefing-${d.local_day}`,
      kind: "briefing",
      url: "/",
      requireInteraction: false,
      vibrate: VIBRATIONS.short,
    };
    const r = await sendToSubscription(db, d, payload, 3 * 3600);
    if (r === "sent") briefed++;
    else if (r !== "removed") {
      failed++;
      // 잠깐의 실패(네트워크·429·5xx)만 다음 분에 다시 — 계속 거절되는 기기는 오늘은 포기(매분 3시간 재시도 방지)
      if (retryable(r)) await db.from("push_subscriptions").update({ last_briefing_on: null }).eq("id", d.id);
    }
  }
  return { briefed, failed };
}
