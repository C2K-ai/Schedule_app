// 구글 캘린더 구독 주소 — GET ?token=… → 그 사람의 DREAM 일정(ICS, 지난 30일 ~ 앞으로 180일).
//   JWT 검증 끔(구글 서버가 부름) — 대신 표 calendar_feeds 의 비밀 토큰으로 주인을 찾는다. 모르는 토큰이면 404.
//   배포: verify_jwt false. 앱: 설정 → '구글 캘린더에서 보기'.
import { admin } from "../_shared/env.ts";
import { buildIcs, TOKEN_RE, validTz, type FeedTask } from "./logic.ts";

const DAY = 86_400_000;
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return text("method", 405);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) return text("not found", 404);

  const db = admin();
  const { data: feed, error } = await db.from("calendar_feeds").select("user_id").eq("token", token).maybeSingle();
  if (error) {
    console.error(error.message);
    return text("error", 500);
  }
  if (!feed) return text("not found", 404);

  const now = new Date();
  const { data: prof } = await db.from("profiles").select("timezone").eq("id", feed.user_id).maybeSingle();
  const tz = validTz(prof?.timezone) ? prof.timezone : "Asia/Seoul";
  const { data: tasks, error: e2 } = await db
    .from("tasks")
    .select("id,title,notes,starts_at,ends_at,schedule,status,updated_at")
    .eq("user_id", feed.user_id)
    .is("deleted_at", null)
    .in("schedule", ["timed", "day"])
    .neq("status", "skipped")
    .gte("ends_at", new Date(now.getTime() - 30 * DAY).toISOString())
    .lte("starts_at", new Date(now.getTime() + 180 * DAY).toISOString())
    .order("starts_at")
    .limit(3000);
  if (e2) {
    console.error(e2.message);
    return text("error", 500);
  }
  const body = buildIcs((tasks ?? []) as FeedTask[], tz, now);
  return new Response(req.method === "HEAD" ? null : body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="dream.ics"',
      "cache-control": "private, max-age=600",
    },
  });
});
