// Edge Function 공용 — CORS·JSON 응답, 관리자 클라이언트, 비밀값(환경변수 → Vault)
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

function must(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`환경변수 ${name} 가 없습니다 — supabase secrets set ${name}=...`);
  return v;
}

export function admin(): SupabaseClient {
  return createClient(must("SUPABASE_URL"), must("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// 비밀값: 환경변수(supabase secrets set) → 없으면 Vault(SQL 로 넣은 값). CLI 없이 SQL 만으로 설정할 수 있게.
const VAULT_NAMES: Record<string, string> = {
  VAPID_PUBLIC_KEY: "must_vapid_public",
  VAPID_PRIVATE_KEY: "must_vapid_private",
  VAPID_SUBJECT: "must_vapid_subject",
  CRON_SECRET: "must_cron_secret",
  ACTION_SECRET: "must_action_secret",
  ANTHROPIC_API_KEY: "must_anthropic_key",
};
let vaultCache: Promise<Record<string, string>> | null = null;

export async function setting(name: keyof typeof VAULT_NAMES | string, fallback?: string): Promise<string> {
  const env = Deno.env.get(name);
  if (env) return env;
  const load = () =>
    (vaultCache ??= (async () => {
      const { data, error } = await admin().rpc("must_function_config");
      if (error) throw new Error(`Vault 설정을 읽지 못했습니다: ${error.message}`);
      return (data ?? {}) as Record<string, string>;
    })().catch((e) => {
      vaultCache = null; // 다음 호출에서 다시 시도
      throw e;
    }));
  let v = (await load())[VAULT_NAMES[name] ?? ""];
  if (!v) {
    // 함수가 떠 있는 동안 Vault 에 새로 넣은 값도 보이게 — 없을 때만 한 번 새로 읽는다
    vaultCache = null;
    v = (await load())[VAULT_NAMES[name] ?? ""];
  }
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} 설정이 없습니다 — Vault 에 ${VAULT_NAMES[name]} 를 넣거나 supabase secrets set ${name}=...`);
}
