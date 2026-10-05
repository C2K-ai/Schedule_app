"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// NEXT_PUBLIC_* 는 빌드 때 문자열로 박힌다 — 반드시 이 형태 그대로 참조해야 한다.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** Supabase 키가 없으면 앱은 로컬 모드(이 기기 저장)로만 동작한다. */
export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_KEY);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!cloudEnabled) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return client;
}

export const functionsUrl = (name: string) => `${SUPABASE_URL}/functions/v1/${name}`;
