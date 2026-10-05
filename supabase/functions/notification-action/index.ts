// 알림의 "⏱ 5분 뒤 다시" / "▶ 지금 시작" 버튼 — 앱을 열지 않고 서비스 워커가 바로 부른다.
//   배포: npx supabase functions deploy notification-action --no-verify-jwt
//   보호: 알림에 실려 온 서명 토큰(ACTION_SECRET 으로 HMAC, 6시간 유효)
import { admin, cors, json, verifyAction } from "../_shared/push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const { token, action } = (await req.json().catch(() => ({}))) as { token?: string; action?: string };
  const taskId = token ? await verifyAction(token) : null;
  if (!taskId) return json({ error: "invalid or expired token" }, 401);

  const db = admin();
  const { data: t } = await db.from("tasks").select("id, user_id, title, status").eq("id", taskId).maybeSingle();
  if (!t) return json({ error: "not found" }, 404);
  const now = new Date();

  if (action === "snooze") {
    if (t.status !== "planned") return json({ ok: true, ignored: "already started" });
    const { count } = await db
      .from("notification_jobs")
      .select("id", { count: "exact", head: true })
      .eq("task_id", t.id)
      .eq("kind", "snooze");
    const fireAt = new Date(now.getTime() + 5 * 60000);
    const { error } = await db.from("notification_jobs").insert({
      user_id: t.user_id,
      task_id: t.id,
      kind: "snooze",
      seq: (count ?? 0) + 1,
      fire_at: fireAt.toISOString(),
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, snoozedUntil: fireAt.toISOString() });
  }

  if (action === "start") {
    if (t.status === "planned") {
      const iso = now.toISOString();
      await db.from("tasks").update({ status: "in_progress", started_at: iso, updated_at: iso }).eq("id", t.id);
      await db.from("task_logs").insert({
        user_id: t.user_id,
        task_id: t.id,
        kind: "started",
        title: t.title,
        created_at: iso,
        updated_at: iso,
      });
    }
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
});
