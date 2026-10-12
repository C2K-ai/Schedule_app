"use client";

// 복사한 사진 붙여넣기 — 파일을 고르지 않고 캡처·사진을 바로 넣는다(PC Ctrl+V, 폰 '붙여넣기' 버튼).

import { useEffect, useRef, type RefObject } from "react";

/** 붙여넣기 이벤트에 사진이 있으면 그 파일 */
export function imageFromPaste(e: ClipboardEvent): File | null {
  for (const it of Array.from(e.clipboardData?.items ?? [])) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

/** 클립보드에 있는 사진 읽기('붙여넣기' 버튼) — 없으면 null. 브라우저가 못 읽게 하면 이유를 담아 throw */
export async function readClipboardImage(): Promise<File | null> {
  if (!navigator.clipboard?.read) throw new Error("이 브라우저는 붙여넣기 버튼을 못 써요. 입력칸에 길게 눌러 붙여넣거나 '사진' 버튼으로 골라 주세요.");
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error("복사한 사진을 읽지 못했어요. 붙여넣기를 허용했는지 확인하거나 '사진' 버튼으로 골라 주세요.");
  }
  for (const it of items) {
    const type = it.types.find((t) => t.startsWith("image/"));
    if (type) return new File([await it.getType(type)], "clipboard", { type });
  }
  return null;
}

/**
 * 이 창이 떠 있는 동안 사진을 붙여넣으면 받는다. onImage 가 true 를 돌려줄 때만 원래 붙여넣기를 막는다.
 *  · 입력칸에 글도 같이 붙여넣는 중이면(엑셀·워드는 글과 함께 '셀 그림'도 넣는다) 글을 그대로 둔다 — 캡처·'이미지 복사'엔 글이 없다.
 *  · scope 가 있으면 그 안의 입력칸이거나 입력칸이 아닌 곳에서 붙여넣을 때만(위에 뜬 다른 창의 입력칸은 건드리지 않음).
 */
export function usePasteImage(onImage: (f: File) => boolean, scope?: RefObject<HTMLElement | null>) {
  const cb = useRef(onImage);
  useEffect(() => {
    cb.current = onImage;
  });
  useEffect(() => {
    const on = (e: ClipboardEvent) => {
      const f = imageFromPaste(e);
      if (!f) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const editable = Boolean(t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA"));
      if (editable && e.clipboardData?.getData("text/plain").trim()) return;
      if (editable && scope?.current && !scope.current.contains(t)) return;
      if (cb.current(f)) e.preventDefault();
    };
    window.addEventListener("paste", on);
    return () => window.removeEventListener("paste", on);
  }, [scope]);
}
