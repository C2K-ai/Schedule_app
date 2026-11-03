"use client";

// 일정 사진 — '택배 갖고 오기'처럼 일정에 사진 한 장.
//   고른 사진을 줄여서(긴 변 1568px JPEG, 보통 0.3~0.6MB) 드라이브 '일정 사진' 폴더에 올리고, 일정에는 그 파일 id(photo_id)만 둔다.
//   같은 계정이면 다른 기기에서도 보인다. 한 번 받은 사진은 이 기기 캐시(Cache Storage)에 둬서 다음엔 바로·오프라인에서도.
//   DB 가 내 드라이브 파일만 붙게 하고, 드라이브에서 지우면 일정에서도 빠진다(20261103000000_task_photo).
import type { SupabaseClient } from "@supabase/supabase-js";
import { DRIVE_BUCKET, driveError, uploadFile } from "./drive";
import { shrinkPhoto } from "./photo";

export const TASK_PHOTO_FOLDER = "일정 사진";
const CACHE = "must-task-photos";
const cacheKey = (id: string) => `/__task-photo/${id}`;

async function cachePut(id: string, blob: Blob) {
  try {
    const c = await caches.open(CACHE);
    await c.put(cacheKey(id), new Response(blob, { headers: { "content-type": blob.type || "image/jpeg" } }));
  } catch {
    /* 캐시를 못 쓰면 매번 받는다 */
  }
}

async function cacheGet(id: string): Promise<Blob | null> {
  try {
    const hit = await (await caches.open(CACHE)).match(cacheKey(id));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

async function cacheDrop(id: string) {
  try {
    await (await caches.open(CACHE)).delete(cacheKey(id));
  } catch {
    /* 없으면 그만 */
  }
}

/** 파일 이름 — 일정 제목에서 쓸 수 없는 글자를 빼고 앞 40자 */
export function photoFileName(title: string): string {
  const t = title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  return `${t || "일정"} 사진.jpg`;
}

/** 고른 사진을 줄여서 드라이브에 올린다 → 파일 id. onProgress 는 0~1 */
export async function uploadTaskPhoto(sb: SupabaseClient, file: File, title: string, onProgress?: (p: number) => void): Promise<string> {
  const p = await shrinkPhoto(file);
  const blob = await (await fetch(p.preview)).blob();
  const f = await uploadFile(sb, new File([blob], photoFileName(title), { type: "image/jpeg" }), onProgress, undefined, undefined, TASK_PHOTO_FOLDER);
  await cachePut(f.id, blob);
  return f.id;
}

/** 사진 보기용 주소(blob:) — 캐시에 있으면 그것, 없으면 받아서 캐시에. 다 쓰면 URL.revokeObjectURL */
export async function taskPhotoUrl(sb: SupabaseClient | null, userId: string | null, photoId: string): Promise<string> {
  const hit = await cacheGet(photoId);
  if (hit) return URL.createObjectURL(hit);
  if (!sb || !userId) throw new Error("로그인하면 사진이 보여요.");
  const { data, error } = await sb.storage.from(DRIVE_BUCKET).download(`${userId}/${photoId}`);
  if (error || !data) throw new Error(/not.?found|404|400/i.test(String(error?.message ?? "")) ? "사진이 지워졌어요." : driveError(error ?? "사진을 받지 못했어요"));
  await cachePut(photoId, data);
  return URL.createObjectURL(data);
}

/** 사진을 뺄 때 — 드라이브에서도 지운다(실패해도 일정에서는 빠진다) */
export async function removeTaskPhoto(sb: SupabaseClient | null, userId: string | null, photoId: string) {
  await cacheDrop(photoId);
  if (!sb || !userId) return;
  await sb.storage
    .from(DRIVE_BUCKET)
    .remove([`${userId}/${photoId}`])
    .catch(() => null);
  await sb
    .from("drive_files")
    .delete()
    .eq("id", photoId)
    .then(
      () => null,
      () => null,
    );
}
