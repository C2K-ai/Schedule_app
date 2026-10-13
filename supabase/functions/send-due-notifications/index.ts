// pg_cron 이 1분마다 부른다 → 보낼 때가 된 알림을 꺼내 Web Push 로 보낸다.
//   배포: npx supabase functions deploy send-due-notifications --no-verify-jwt
//   보호: x-cron-secret 헤더 == CRON_SECRET
import { admin, cors, describe, json, safeTz, sendToUser, setting, signAction, VIBRATIONS, type PushPayload } from "../_shared/push.ts";
import { sendBriefings } from "./briefing.ts";
import { badgeCounts, skipEndedOverdue, type BadgeRow } from "./rules.ts";

interface Job {
  id: number;
  user_id: string;
  task_id: string;
  kind: Exclude<PushPayload["kind"], "briefing" | "signup">;
  seq: number;
  fire_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.headers.get("x-cron-secret") !== (await setting("CRON_SECRET"))) return json({ error: "unauthorized" }, 401);

  const db = admin();
  // 일정 알림을 먼저(제때 가야 함), 아침 브리핑(하루 한 번)은 그 뒤에 — 브리핑이 늦어져도 일정 알림은 안 밀린다
  const { data, error } = await db.rpc("claim_due_notification_jobs", { p_limit: 300 });
  const briefLater = () => sendBriefings(db).catch((e) => ({ error: String(e) }));
  // 알림 꺼내기가 실패해도 브리핑은 따로 보낸다(예전처럼 서로 묶이지 않게)
  if (error) return json({ error: error.message, briefing: await briefLater() }, 500);
  const jobs = (data ?? []) as Job[];
  if (!jobs.length) return json({ claimed: 0, briefing: await briefLater() });

  const taskIds = [...new Set(jobs.map((j) => j.task_id))];
  const userIds = [...new Set(jobs.map((j) => j.user_id))];
  const [{ data: tasks }, { data: profiles }, { data: open }] = await Promise.all([
    db.from("tasks").select("id, title, status, starts_at, ends_at, deleted_at").in("id", taskIds),
    db.from("profiles").select("id, timezone, grace_min, settings").in("id", userIds),
    // 앱 아이콘 배지 숫자 = 시간 안의 미시작 강제 일정 + 끝났는데 체크 안 한 일정(최근 7일) — rules.ts
    db
      .from("tasks")
      .select("user_id, strict, starts_at, ends_at")
      .in("user_id", userIds)
      .eq("status", "planned")
      .eq("schedule", "timed")
      .is("deleted_at", null)
      .lt("starts_at", new Date().toISOString())
      .gt("ends_at", new Date(Date.now() - 7 * 86_400_000).toISOString()),
  ]);
  const T = new Map((tasks ?? []).map((t) => [t.id, t]));
  const P = new Map((profiles ?? []).map((p) => [p.id, p]));
  const badge = badgeCounts((open ?? []) as BadgeRow[], Date.now(), (uid) => P.get(uid)?.grace_min ?? 5);

  const actionUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/notification-action`;
  let sent = 0,
    skipped = 0,
    failed = 0;

  for (const job of jobs) {
    // 한 건에서 난 오류(이상한 데이터 등)가 같은 묶음의 다른 사람 알림을 막지 않게 — 그 건만 다음 분에 다시
    try {
      const t = T.get(job.task_id);
      if (!t || t.deleted_at || t.status !== "planned") {
        await db.from("notification_jobs").update({ sent_at: new Date().toISOString(), last_error: "skipped: not planned" }).eq("id", job.id);
        skipped++;
        continue;
      }
      // 끝난 일정엔 '시작 안 함'을 보내지 않는다(앱을 열면 '했나요?'로 묻는다)
      if (skipEndedOverdue(job.kind, t, Date.now())) {
        await db.from("notification_jobs").update({ sent_at: new Date().toISOString(), last_error: "skipped: ended" }).eq("id", job.id);
        skipped++;
        continue;
      }
      const prof = P.get(job.user_id);
      const tz = safeTz(prof?.timezone);
      const vibration = (prof?.settings as { vibration?: string } | null)?.vibration ?? "heartbeat";
      const text = describe(job.kind, job.seq, t, Date.now(), tz);
      const payload: PushPayload = {
        ...text,
        // 앱이 직접 띄우는 알림과 tag 가 같다 → 같은 알림이 두 번 쌓이지 않고 교체된다
        tag: `must-${t.id}-${job.kind}-${job.seq}`,
        kind: job.kind,
        seq: job.seq,
        taskId: t.id,
        startsAt: t.starts_at,
        url: `/?task=${t.id}`,
        requireInteraction: job.kind !== "before",
        renotify: job.kind === "overdue",
        vibrate: VIBRATIONS[vibration] ?? VIBRATIONS.heartbeat,
        actionUrl,
        actionToken: await signAction(t.id),
        badgeCount: badge.get(job.user_id) ?? 0,
      };
      const r = await sendToUser(db, job.user_id, payload, job.kind === "before" ? 600 : 1800);
      if (r.failed && !r.sent) {
        // 전부 실패 → claimed_at 을 풀어 다음 분에 다시 시도 (최대 5번)
        failed++;
        await db.from("notification_jobs").update({ claimed_at: null, last_error: r.errors.join("; ").slice(0, 500) }).eq("id", job.id);
      } else {
        sent += r.sent;
        await db
          .from("notification_jobs")
          .update({ sent_at: new Date().toISOString(), last_error: r.sent ? null : "no subscriptions" })
          .eq("id", job.id);
      }
    } catch (e) {
      failed++;
      await db
        .from("notification_jobs")
        .update({ claimed_at: null, last_error: `error: ${String(e)}`.slice(0, 500) })
        .eq("id", job.id)
        .then(
          () => {},
          () => {},
        );
    }
  }
  const briefing = await briefLater();
  return json({ claimed: jobs.length, sent, skipped, failed, briefing });
});
