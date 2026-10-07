import type { ColorKey } from "./types";

/**
 * 결정적 UUID — 같은 사용자·같은 대상이면 어느 기기에서 만들어도 같은 id.
 * 그래서 폰과 노트북이 각자 기본 카테고리·하루 노트를 만들어도 동기화 후 한 행으로 합쳐진다.
 * (습관 회차 id 와 같은 방식: 앞 24자리 + 구분값 8자리)
 */
const LOCAL_PREFIX = "000000000000000000000000";

function toUuid(hex32: string): string {
  const h = hex32.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function prefix(userId: string | null, len: number): string {
  return (userId ? userId.replace(/-/g, "") : LOCAL_PREFIX).slice(0, len);
}

/** 기본 카테고리 — 레퍼런스 앱과 같은 이름. 사용자가 이름·색을 바꾸거나 지울 수 있다. */
export const DEFAULT_CATEGORIES: { slot: number; name: string; color: ColorKey }[] = [
  { slot: 1, name: "작업", color: "blue" },
  { slot: 2, name: "개인", color: "green" },
  { slot: 3, name: "위시리스트", color: "pink" },
  { slot: 4, name: "생일", color: "amber" },
];

export function defaultCategoryId(userId: string | null, slot: number): string {
  return toUuid(prefix(userId, 20) + "ca7e" + String(slot).padStart(8, "0"));
}

/** 로컬 모드에서 만든 기본 카테고리 id 면 그 slot, 아니면 null (계정으로 옮길 때 다시 매핑) */
export function localDefaultSlot(id: string | null | undefined): number | null {
  if (!id) return null;
  const h = id.replace(/-/g, "");
  if (!h.startsWith(LOCAL_PREFIX.slice(0, 20) + "ca7e")) return null;
  return Number(h.slice(24));
}

/** 하루 노트 id — 사용자 + 날짜(YYYY-MM-DD) */
export function dayNoteId(userId: string | null, day: string): string {
  return toUuid(prefix(userId, 24) + day.replace(/-/g, ""));
}
