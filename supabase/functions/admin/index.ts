// 운영자(관리자) 화면 — 통계 보기 · 가입/AI 한도 설정 · 사용자 정지·로그아웃·삭제·비밀번호 재설정 메일
//   배포: npx supabase functions deploy admin   (JWT 검증 켠 채로)
//   부른 사람이 must_admins 에 있을 때만 동작한다. 나머지는 403.
//   비밀번호는 누구도 볼 수 없다(되돌릴 수 없는 해시로만 저장) — 대신 재설정 메일을 보낸다.
import { admin, cors, json, setting } from "../_shared/env.ts";
import { BAN_FOREVER, emailMatches, guard, parseAction } from "./logic.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const db = admin();
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !auth.user) return json({ error: "unauthorized" }, 401);
  const me = auth.user.id;

  const { data: mine, error: adminErr } = await db.from("must_admins").select("user_id").eq("user_id", me).maybeSingle();
  if (adminErr) return json({ error: "db", message: adminErr.message }, 500);
  if (!mine) return json({ error: "forbidden" }, 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const a = parseAction(body);
  if ("error" in a) return json(a, 400);

  try {
    if (a.action === "overview") {
      const [{ data, error }, aiKey] = await Promise.all([
        db.rpc("must_admin_overview"),
        setting("ANTHROPIC_API_KEY").then(Boolean, () => false),
      ]);
      if (error) throw error;
      return json({ ...(data as Record<string, unknown>), ai_key: aiKey });
    }

    if (a.action === "users") {
      const { data, error } = await db.rpc("must_admin_users");
      if (error) throw error;
      return json({ users: data ?? [], me });
    }

    if (a.action === "settings") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (a.signups_open !== undefined) patch.signups_open = a.signups_open;
      if (a.ai_daily_limit !== undefined) patch.ai_daily_limit = a.ai_daily_limit;
      const { data, error } = await db.from("must_app_settings").update(patch).eq("id", true).select("signups_open, ai_daily_limit, updated_at").single();
      if (error) throw error;
      return json({ settings: data });
    }

    // ── 사용자 한 명에게 하는 작업 ──
    const { data: target, error: targetErr } = await db.auth.admin.getUserById(a.user_id);
    if (targetErr || !target?.user) return json({ error: "not_found" }, 404);
    const { data: targetAdmin, error: taErr } = await db.from("must_admins").select("user_id").eq("user_id", a.user_id).maybeSingle();
    if (taErr) throw taErr;
    const blocked = guard(a.action, { self: a.user_id === me, targetIsAdmin: Boolean(targetAdmin) });
    if (blocked) return json({ error: blocked }, 400);

    switch (a.action) {
      case "ban": {
        const { error } = await db.auth.admin.updateUserById(a.user_id, { ban_duration: BAN_FOREVER });
        if (error) throw error;
        // 로그인 세션도 바로 끊는다(남은 접속 토큰은 길어야 1시간)
        const { data: n } = await db.rpc("must_admin_signout", { p_user: a.user_id });
        return json({ ok: true, sessions: n ?? 0 });
      }
      case "unban": {
        const { error } = await db.auth.admin.updateUserById(a.user_id, { ban_duration: "none" });
        if (error) throw error;
        return json({ ok: true });
      }
      case "signout": {
        const { data: n, error } = await db.rpc("must_admin_signout", { p_user: a.user_id });
        if (error) throw error;
        return json({ ok: true, sessions: n ?? 0 });
      }
      case "reset_password": {
        const email = target.user.email;
        if (!email) return json({ error: "no_email" }, 400);
        const { error } = await db.auth.resetPasswordForEmail(email, a.redirect_to ? { redirectTo: a.redirect_to } : undefined);
        if (error) return json({ error: "mail", message: error.message }, 502);
        return json({ ok: true });
      }
      case "make_admin": {
        const { error } = await db.from("must_admins").upsert({ user_id: a.user_id }, { onConflict: "user_id", ignoreDuplicates: true });
        if (error) throw error;
        return json({ ok: true });
      }
      case "remove_admin": {
        const { error } = await db.from("must_admins").delete().eq("user_id", a.user_id);
        if (error) throw error;
        return json({ ok: true });
      }
      case "delete": {
        if (!emailMatches(a.confirm_email, target.user.email)) return json({ error: "confirm_email" }, 400);
        const { error } = await db.auth.admin.deleteUser(a.user_id);
        if (error) throw error;
        return json({ ok: true });
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
    console.error("admin", a.action, message);
    return json({ error: "internal", message }, 500);
  }
});
