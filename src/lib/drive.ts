"use client";

// 드라이브(내 파일 보관함) — Supabase Storage 'drive' 버킷 + drive_files 표(이름·크기·별표).
//   올리기: drive_files 에 한 줄(서버가 용량 확인) → '<내 id>/<그 줄 id>' 로 Storage 에 올림 → ready.
//   실패하면 그 줄을 지운다. 파일은 나만 볼 수 있다(남의 폴더는 서버 정책이 막음).
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./supabase";
import { lockBytes, OVERHEAD, unlockBytes } from "./vault";

export const DRIVE_BUCKET = "drive";
export const MAX_FILE = 50 * 1024 * 1024;

export interface DriveFile {
  id: string;
  user_id: string;
  filename: string;
  size: number;
  mime: string;
  starred: boolean;
  ready: boolean;
  /** 비밀번호로 잠가서(브라우저에서 암호화해) 올린 파일 */
  locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface DriveUsage {
  used: number;
  files: number;
  quota: number;
  max_file: number;
}

export type FileKind = "image" | "pdf" | "video" | "audio" | "doc" | "sheet" | "archive" | "other";

export function fileKind(f: Pick<DriveFile, "mime" | "filename">): FileKind {
  const m = f.mime.toLowerCase();
  const ext = f.filename.toLowerCase().split(".").pop() ?? "";
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (/^(xlsx?|csv|numbers|ods)$/.test(ext) || m.includes("spreadsheet")) return "sheet";
  if (/^(zip|7z|rar|tar|gz)$/.test(ext) || m.includes("zip")) return "archive";
  if (/^(docx?|hwpx?|txt|md|pptx?|key|pages|rtf|odt)$/.test(ext) || m.startsWith("text/") || m.includes("document")) return "doc";
  return "other";
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

/** 경로 구분자·제어 문자를 빼고 255자로 */
export function cleanName(name: string): string {
  const s = name.replace(/[\\/\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return (s || "이름 없는 파일").slice(0, 255);
}

const path = (f: Pick<DriveFile, "user_id" | "id">) => `${f.user_id}/${f.id}`;

/** 서버 오류 → 알아듣기 쉬운 말 */
export function driveError(e: unknown): string {
  const m = String((e as { message?: string })?.message ?? e);
  if (m.includes("drive_quota")) return "드라이브 용량이 모자라요. 안 쓰는 파일을 지우거나 운영자에게 늘려 달라고 하세요.";
  if (m.includes("drive_pending")) return "운영자가 가입을 승인한 뒤에 쓸 수 있어요.";
  if (m.includes("size") && m.includes("check")) return "파일 하나는 50MB 까지 올릴 수 있어요.";
  if (m.includes("Payload too large") || m.includes("413") || m.includes("exceeded the maximum")) return "파일 하나는 50MB 까지 올릴 수 있어요.";
  if (m.includes("Failed to fetch") || m.includes("network")) return "인터넷 연결을 확인해 주세요.";
  return m || "처리하지 못했어요. 잠시 뒤 다시 해 주세요.";
}

export async function listFiles(sb: SupabaseClient): Promise<DriveFile[]> {
  const { data, error } = await sb.from("drive_files").select("*").order("created_at", { ascending: false }).limit(1000);
  if (error) throw error;
  const all = (data ?? []) as DriveFile[];
  // 올리다 끊긴 것(1시간 넘게 ready 아님)은 조용히 치운다 — 용량만 차지하니까
  const stale = all.filter((f) => !f.ready && Date.now() - Date.parse(f.created_at) > 3600e3);
  if (stale.length) void Promise.all(stale.map((f) => removeFile(sb, f).catch(() => {})));
  return all.filter((f) => f.ready);
}

export async function driveUsage(sb: SupabaseClient): Promise<DriveUsage> {
  const { data, error } = await sb.rpc("must_drive_usage");
  if (error) throw error;
  const u = data as DriveUsage;
  return { used: Number(u.used), files: Number(u.files), quota: Number(u.quota), max_file: Number(u.max_file) };
}

/** 올리기 — 진행률(0~1)을 알려 준다. password 가 있으면 이 기기에서 암호화해서 올린다. 끝나면 새 파일 */
export async function uploadFile(
  sb: SupabaseClient,
  file: File,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
  password?: string,
): Promise<DriveFile> {
  if (file.size + (password ? OVERHEAD : 0) > MAX_FILE) throw new Error("파일 하나는 50MB 까지 올릴 수 있어요.");
  const mime = (file.type || "application/octet-stream").slice(0, 255);
  const body: Blob = password ? new Blob([(await lockBytes(await file.arrayBuffer(), password)) as BlobPart]) : file;
  const { data, error } = await sb
    .from("drive_files")
    .insert({ filename: cleanName(file.name), size: body.size, mime, locked: Boolean(password) })
    .select("*")
    .single();
  if (error) throw new Error(driveError(error));
  const row = data as DriveFile;
  try {
    const { data: s } = await sb.auth.getSession();
    const token = s.session?.access_token;
    if (!token) throw new Error("로그인이 풀렸어요. 다시 로그인해 주세요.");
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/${DRIVE_BUCKET}/${path(row)}`);
      xhr.setRequestHeader("authorization", `Bearer ${token}`);
      xhr.setRequestHeader("apikey", SUPABASE_KEY);
      xhr.setRequestHeader("x-upsert", "false");
      // 잠근 파일은 암호문이라 종류를 숨긴다(이름·종류는 표에만)
      xhr.setRequestHeader("content-type", password ? "application/octet-stream" : mime);
      xhr.setRequestHeader("cache-control", "max-age=3600");
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(driveError(`${xhr.status} ${xhr.responseText}`)));
      xhr.onerror = () => reject(new Error("인터넷 연결을 확인해 주세요."));
      xhr.onabort = () => reject(new Error("올리기를 취소했어요."));
      signal?.addEventListener("abort", () => xhr.abort());
      xhr.send(body);
    });
    const { data: done, error: e2 } = await sb
      .from("drive_files")
      .update({ ready: true, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .select("*")
      .single();
    if (e2) throw e2;
    return done as DriveFile;
  } catch (e) {
    await sb.storage.from(DRIVE_BUCKET).remove([path(row)]).catch(() => {});
    await sb.from("drive_files").delete().eq("id", row.id);
    throw e instanceof Error ? e : new Error(driveError(e));
  }
}

export async function removeFile(sb: SupabaseClient, f: DriveFile) {
  const { error } = await sb.storage.from(DRIVE_BUCKET).remove([path(f)]);
  if (error) throw new Error(driveError(error));
  const { error: e2 } = await sb.from("drive_files").delete().eq("id", f.id);
  if (e2) throw new Error(driveError(e2));
}

export async function updateFile(sb: SupabaseClient, f: DriveFile, patch: Partial<Pick<DriveFile, "filename" | "starred">>) {
  const body = { ...patch, ...(patch.filename !== undefined ? { filename: cleanName(patch.filename) } : {}), updated_at: new Date().toISOString() };
  const { data, error } = await sb.from("drive_files").update(body).eq("id", f.id).select("*").single();
  if (error) throw new Error(driveError(error));
  return data as DriveFile;
}

/** 잠깐(5분) 쓸 수 있는 주소 — download 면 그 이름으로 내려받게 */
export async function fileUrl(sb: SupabaseClient, f: DriveFile, download = false): Promise<string> {
  const { data, error } = await sb.storage.from(DRIVE_BUCKET).createSignedUrl(path(f), 300, download ? { download: f.filename } : undefined);
  if (error || !data?.signedUrl) throw new Error(driveError(error ?? "주소를 만들지 못했어요"));
  return data.signedUrl;
}

/** 잠긴 파일을 받아 이 기기에서 푼다 — 틀린 비밀번호면 WrongPassword */
export async function openLocked(sb: SupabaseClient, f: DriveFile, password: string): Promise<Blob> {
  const res = await fetch(await fileUrl(sb, f));
  if (!res.ok) throw new Error(driveError(`${res.status} ${await res.text().catch(() => "")}`));
  const plain = await unlockBytes(await res.arrayBuffer(), password);
  return new Blob([plain], { type: f.mime });
}
