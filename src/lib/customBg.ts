"use client";

// 사진 배경의 '내 사진' — 이 기기에만 저장한다(IndexedDB). 다른 기기는 각자 고른다(없으면 기본 그림).
//   고른 사진은 긴 쪽 2560px 이하 webp(안 되면 jpeg)로 줄여 저장 — 큰 원본도 빠르게 뜨게.
import { useEffect, useState } from "react";

const DB = "must-custom-bg";
const STORE = "bg";
const KEY = "custom";
const EVENT = "must:custom-bg";
const MAX_SIDE = 2560;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadCustomBg(): Promise<Blob | null> {
  try {
    return ((await tx("readonly", (s) => s.get(KEY))) as Blob | undefined) ?? null;
  } catch {
    return null;
  }
}

/** 사진을 줄여서 저장 */
export async function saveCustomBg(file: File): Promise<void> {
  if (!file.type.startsWith("image/")) throw new Error("사진 파일만 넣을 수 있어요.");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("이 사진은 열 수 없어요. 다른 사진(JPG·PNG·WEBP)을 골라 주세요.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const encode = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.85));
  const blob = (await encode("image/webp")) ?? (await encode("image/jpeg"));
  if (!blob) throw new Error("사진을 저장하지 못했어요.");
  await tx("readwrite", (s) => s.put(blob, KEY));
  window.dispatchEvent(new Event(EVENT));
}

export async function clearCustomBg(): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(KEY));
  } finally {
    window.dispatchEvent(new Event(EVENT));
  }
}

/** 저장된 내 사진의 주소(object URL) — 없으면 null. 바뀌면 다시 읽는다 */
export function useCustomBg(enabled = true): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let current: string | null = null;
    const load = () =>
      void loadCustomBg().then((b) => {
        if (!alive) return;
        if (current) URL.revokeObjectURL(current);
        current = b ? URL.createObjectURL(b) : null;
        setUrl(current);
      });
    load();
    window.addEventListener(EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, load);
      if (current) URL.revokeObjectURL(current);
    };
  }, [enabled]);
  return enabled ? url : null;
}
