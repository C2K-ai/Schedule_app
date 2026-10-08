"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { BASE_PATH } from "./base";
import { getSupabase } from "./supabase";

// 관리자 화면 — Edge Function `admin` 이 관리자인지 확인한 뒤 서비스 롤로 통계·작업을 한다.

export interface AdminSettings {
  signups_open: boolean;
  ai_daily_limit: number;
  updated_at?: string;
}

export interface ModelUsage {
  model: string;
  calls: number;
  input: number;
  output: number;
}

export interface CronJob {
  name: string;
  schedule: string;
  active: boolean;
  last_status: string | null;
  last_at: string | null;
  fails_24h: number;
}

export interface Overview {
  now: string;
  users: number;
  users_week: number;
  active_week: number;
  settings: AdminSettings;
  ai_today: number;
  ai_month: ModelUsage[];
  devices: number;
  pushes_today: number;
  push_errors_24h: number;
  cron: CronJob[];
  ai_key: boolean;
  /** 가입 승인 대기 수 */
  pending: number;
}

export interface AdminUser {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  last_active_at: string | null;
  banned_until: string | null;
  provider: string;
  confirmed: boolean;
  is_admin: boolean;
  tasks: number;
  tasks_done: number;
  habits: number;
  study_sec: number;
  career: number;
  devices: number;
  sessions: number;
  ai_today: number;
  ai_month_calls: number;
  ai_month_input: number;
  ai_month_output: number;
  ai_month_models: { model: string; input: number; output: number }[];
  /** 관리자가 승인했는지(관리자는 늘 true) */
  approved: boolean;
  requested_at: string | null;
}

export type UserAction =
  | "approve"
  | "ban"
  | "unban"
  | "signout"
  | "reset_password"
  | "recovery_link"
  | "confirm"
  | "make_admin"
  | "remove_admin"
  | "delete";

const MESSAGES: Record<string, string> = {
  forbidden: "관리자만 쓸 수 있어요.",
  unauthorized: "로그인이 풀렸어요. 다시 로그인해 주세요.",
  self: "자기 자신에게는 할 수 없는 작업이에요.",
  target_admin: "관리자는 먼저 '관리자 해제'를 해야 정지·삭제할 수 있어요.",
  confirm_email: "확인용 이메일이 맞지 않아요.",
  not_found: "그 사용자를 찾지 못했어요(이미 삭제됐을 수 있어요).",
  no_email: "이메일이 없는 계정이라 메일을 보낼 수 없어요.",
  mail: "메일을 보내지 못했어요. 기본 메일 서버는 시간당 몇 통만, Supabase 팀원 주소로만 보내요 — 대시보드에서 SMTP 를 연결하면 풀려요.",
  bad_ai_daily_limit: "AI 하루 한도는 0~1000 사이 정수예요.",
  last_admin: "관리자가 최소 한 명은 있어야 해요.",
};

async function call<T>(client: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke("admin", { body });
  if (error) {
    let code = "";
    let message = "";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const j = (await ctx.json().catch(() => ({}))) as { error?: string; message?: string };
      code = j.error ?? "";
      message = j.message ?? "";
    }
    throw new Error(MESSAGES[code] ?? (message || (navigator.onLine ? "서버에서 처리하지 못했어요. 잠시 뒤 다시 해 주세요." : "인터넷이 끊겨 있어요.")));
  }
  return data as T;
}

export const adminOverview = (c: SupabaseClient) => call<Overview>(c, { action: "overview" });
export const adminUsers = (c: SupabaseClient) => call<{ users: AdminUser[]; me: string }>(c, { action: "users" });
export const adminSettings = (c: SupabaseClient, patch: Partial<Pick<AdminSettings, "signups_open" | "ai_daily_limit">>) =>
  call<{ settings: AdminSettings }>(c, { action: "settings", ...patch });
export const adminUserAction = (c: SupabaseClient, action: UserAction, userId: string, extra: Record<string, unknown> = {}) =>
  call<{ ok: true; sessions?: number | null; link?: string | null }>(c, {
    action,
    user_id: userId,
    ...(action === "reset_password" || action === "recovery_link" ? { redirect_to: `${window.location.origin}${BASE_PATH}/` } : {}),
    ...extra,
  });

/** 내가 관리자인지 — 메뉴에 '관리자'를 보일지. 로그인 안 했거나 서버가 없으면 false */
export function useIsAdmin(userId: string | null): boolean {
  const [admin, setAdmin] = useState<{ user: string; v: boolean } | null>(null);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    let alive = true;
    void sb.rpc("must_is_admin").then(({ data, error }) => {
      if (alive) setAdmin({ user: userId, v: !error && data === true });
    });
    return () => {
      alive = false;
    };
  }, [userId]);
  return Boolean(userId && admin?.user === userId && admin.v);
}

// ── 비용 어림 ── 모델별 100만 토큰당 달러(입력, 출력). 모르는 모델은 비용을 안 보여 준다.
//   Haiku 5.5 는 한 번에 10만 토큰이 넘으면 5배(0.5, 2.5)지만 이 앱의 요청은 3천 토큰 안팎이라 기본값만 쓴다.
const PRICE_PER_MTOK: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5-5": [2, 10],
};
/** 원화 환산용 어림 환율 */
export const KRW_PER_USD = 1400;

const priceOf = (model: string) =>
  PRICE_PER_MTOK[model] ?? Object.entries(PRICE_PER_MTOK).find(([k]) => model.startsWith(k))?.[1] ?? null;

/** 토큰 → 원(어림). 모르는 모델이면 null */
export function costKrw(model: string, input: number, output: number): number | null {
  const p = priceOf(model);
  if (!p) return null;
  return ((input * p[0] + output * p[1]) / 1e6) * KRW_PER_USD;
}

/** 사용자 한 명의 이번 달 비용(모델별 합) — 모르는 모델은 Haiku 값으로 어림 */
export const userCostKrw = (u: Pick<AdminUser, "ai_month_models">) =>
  (u.ai_month_models ?? []).reduce(
    (sum, m) => sum + (costKrw(m.model, Number(m.input), Number(m.output)) ?? costKrw("claude-haiku-4-5", Number(m.input), Number(m.output)) ?? 0),
    0,
  );

export const fmtKrw = (n: number) => (n < 10 ? `${n.toFixed(1)}원` : `${Math.round(n).toLocaleString("ko-KR")}원`);

export function fmtAgo(iso: string | null, now: number): string {
  if (!iso) return "-";
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

/** 정지 중인지 — banned_until 이 미래 */
export const isBanned = (u: Pick<AdminUser, "banned_until">, now: number) => Boolean(u.banned_until && Date.parse(u.banned_until) > now);
