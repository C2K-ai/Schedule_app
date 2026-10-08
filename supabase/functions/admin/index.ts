// 운영자(관리자) 화면 — 통계 보기 · 가입/AI 한도/드라이브 용량 설정 · 가입 승인 · 사용자 정지·로그아웃·삭제·비밀번호 재설정 메일
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
      const [{ data, error }, aiKey, pend, drive] = await Promise.all([
        db.rpc("must_admin_overview"),
        setting("ANTHROPIC_API_KEY").then(Boolean, () => false),
        db.from("must_members").select("user_id", { count: "exact", head: true }).eq("approved", false),
        db.rpc("must_admin_drive"),
      ]);
      if (error) throw error;
      if (pend.error) throw pend.error;
      if (drive.error) throw drive.error;
      const driveBytes = ((drive.data ?? []) as { bytes: number }[]).reduce((n, r) => n + Number(r.bytes), 0);
      return json({ ...(data as Record<string, unknown>), ai_key: aiKey, pending: pend.count ?? 0, drive_bytes: driveBytes });
    }

    if (a.action === "users") {
      const [{ data, error }, members, drive] = await Promise.all([
        db.rpc("must_admin_users"),
        db.from("must_members").select("user_id, approved, requested_at"),
        db.rpc("must_admin_drive"),
      ]);
      if (error) throw error;
      if (members.error) throw members.error;
      if (drive.error) throw drive.error;
      const m = new Map((members.data ?? []).map((r) => [r.user_id as string, r]));
      const d = new Map(((drive.data ?? []) as { user_id: string; files: number; bytes: number }[]).map((r) => [r.user_id, r]));
      // 승인 기록이 없는 사용자(표가 생기기 전)는 승인 대기로 보인다 — must_my_access 와 같은 규칙
      const users = ((data ?? []) as { id: string; is_admin: boolean }[]).map((u) => ({
        ...u,
        approved: u.is_admin || Boolean(m.get(u.id)?.approved),
        requested_at: m.get(u.id)?.requested_at ?? null,
        drive_files: d.get(u.id)?.files ?? 0,
        drive_bytes: Number(d.get(u.id)?.bytes ?? 0),
      }));
      return json({ users, me });
    }

    if (a.action === "settings") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (a.signups_open !== undefined) patch.signups_open = a.signups_open;
      if (a.ai_daily_limit !== undefined) patch.ai_daily_limit = a.ai_daily_limit;
      if (a.drive_quota_mb !== undefined) patch.drive_quota_mb = a.drive_quota_mb;
      const { data, error } = await db
        .from("must_app_settings")
        .update(patch)
        .eq("id", true)
        .select("signups_open, ai_daily_limit, drive_quota_mb, updated_at")
        .single();
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
      case "approve": {
        const { error } = await db
          .from("must_members")
          .upsert({ user_id: a.user_id, approved: true, approved_at: new Date().toISOString(), approved_by: me }, { onConflict: "user_id" });
        if (error) throw error;
        return json({ ok: true });
      }
      case "ban": {
        const { error } = await db.auth.admin.updateUserById(a.user_id, { ban_duration: BAN_FOREVER });
        if (error) throw error;
        // 로그인 세션도 바로 끊는다(남은 접속 토큰은 길어야 1시간). 실패해도 정지는 됐고, 다음 토큰 갱신 때 막힌다
        const { data: n, error: soErr } = await db.rpc("must_admin_signout", { p_user: a.user_id });
        if (soErr) console.error("admin ban signout", soErr.message);
        return json({ ok: true, sessions: soErr ? null : (n ?? 0) });
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
      case "recovery_link": {
        // 메일이 안 갈 때(기본 메일 서버 한도·스팸함) — 링크를 직접 만들어 다른 길(메신저 등)로 전한다
        const email = target.user.email;
        if (!email) return json({ error: "no_email" }, 400);
        const { data, error } = await db.auth.admin.generateLink({
          type: "recovery",
          email,
          options: a.redirect_to ? { redirectTo: a.redirect_to } : undefined,
        });
        if (error) throw error;
        return json({ ok: true, link: data.properties?.action_link ?? null });
      }
      case "confirm": {
        // 확인 메일을 못 받은 사람 — 운영자가 대신 '메일 확인됨'으로
        const { error } = await db.auth.admin.updateUserById(a.user_id, { email_confirm: true });
        if (error) throw error;
        return json({ ok: true });
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
        // 나 자신은 guard 가 막으니 부른 관리자는 남는다. 두 관리자가 동시에 서로를 빼는 경우는 DB 트리거가 막는다
        const { error } = await db.from("must_admins").delete().eq("user_id", a.user_id);
        if (error) {
          if (error.message.includes("last_admin")) return json({ error: "last_admin" }, 400);
          throw error;
        }
        return json({ ok: true });
      }
      case "delete": {
        if (!emailMatches(a.confirm_email, target.user.email)) return json({ error: "confirm_email" }, 400);
        // 드라이브 파일부터 — 계정을 지우면 표(drive_files)는 같이 지워지지만 Storage 의 실제 파일은 남는다
        const bucket = db.storage.from("drive");
        for (let i = 0; i < 50; i++) {
          const { data: objs, error: lErr } = await bucket.list(a.user_id, { limit: 1000 });
          if (lErr) throw lErr;
          if (!objs?.length) break;
          const { error: rErr } = await bucket.remove(objs.map((o) => `${a.user_id}/${o.name}`));
          if (rErr) throw rErr;
        }
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
