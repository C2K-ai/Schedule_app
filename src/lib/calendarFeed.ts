// 구글 캘린더에서 DREAM 일정 보기 — 표 calendar_feeds(내 행 하나)의 비밀 토큰으로 Edge `calendar-feed` 가 일정(ICS)을 내준다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { functionsUrl } from "./supabase";

/** 구글 캘린더 'URL로 추가'에 붙여 넣을 주소 */
export const feedUrl = (token: string) => `${functionsUrl("calendar-feed")}?token=${token}`;

/** 구글 캘린더의 'URL로 추가' 설정 화면 */
export const GOOGLE_ADD_BY_URL = "https://calendar.google.com/calendar/u/0/r/settings/addbyurl";

/** 32바이트 무작위 → base64url 43자(서버 CHECK: [A-Za-z0-9_-]{32,128}) */
export function newFeedToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const fail = (what: string, msg: string) => new Error(`${what}에 실패했어요. 잠시 뒤 다시 해 주세요. (${msg})`);

export async function loadFeed(sb: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await sb.from("calendar_feeds").select("token").eq("user_id", userId).maybeSingle();
  if (error) throw fail("구독 주소 불러오기", error.message);
  return (data as { token: string } | null)?.token ?? null;
}

/** 주소 만들기(이미 있으면 새 주소로 바꾸기 — 옛 주소는 바로 끊김) */
export async function makeFeed(sb: SupabaseClient, userId: string): Promise<string> {
  const token = newFeedToken();
  const { error } = await sb.from("calendar_feeds").upsert({ user_id: userId, token }, { onConflict: "user_id" });
  if (error) throw fail("구독 주소 만들기", error.message);
  return token;
}

export async function removeFeed(sb: SupabaseClient, userId: string): Promise<void> {
  const { error } = await sb.from("calendar_feeds").delete().eq("user_id", userId);
  if (error) throw fail("구독 끄기", error.message);
}
