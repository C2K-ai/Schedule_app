"use client";

import { ImageOff, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabase } from "@/lib/supabase";
import { taskPhotoUrl } from "@/lib/taskPhoto";
import { usePlanner } from "./PlannerProvider";
import { cx, useLayer } from "./ui";

/**
 * 일정에 붙인 사진 — 일정을 열면 맨 위에 크게(누르면 화면 가득). 한 번 받은 사진은 기기 캐시에서 바로.
 * 사진이 바뀌면 부모가 key 로 새로 만든다(이전 사진 상태가 남지 않게).
 */
export function TaskPhoto({
  photoId,
  onReplace,
  onRemove,
  className,
}: {
  photoId: string;
  onReplace?: () => void;
  onRemove?: () => void;
  className?: string;
}) {
  const { session } = usePlanner();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  useLayer(big, () => setBig(false));

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    taskPhotoUrl(getSupabase(), session.userId, photoId).then(
      (u) => {
        made = u;
        if (alive) setUrl(u);
        else URL.revokeObjectURL(u);
      },
      (e) => alive && setErr((e as Error).message),
    );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [photoId, session.userId]);

  return (
    <div className={cx("relative overflow-hidden rounded-2xl border border-line bg-black/25", className)}>
      {url ? (
        <button type="button" onClick={() => setBig(true)} className="block w-full" aria-label="사진 크게 보기">
          {/* eslint-disable-next-line @next/next/no-img-element -- 기기에서 만든 blob 주소라 next/image 를 못 쓴다 */}
          <img src={url} alt="일정 사진" className="mx-auto max-h-[42dvh] w-full object-contain" />
        </button>
      ) : (
        <div className="grid h-40 place-items-center px-4 text-center text-sm text-muted">
          {err ? (
            <span className="inline-flex items-center gap-1.5">
              <ImageOff size={16} /> {err}
            </span>
          ) : (
            "사진 불러오는 중…"
          )}
        </div>
      )}
      {(onReplace || onRemove) && (
        <div className="absolute top-2 right-2 flex gap-1.5">
          {onReplace && (
            <button
              type="button"
              onClick={onReplace}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-black/55 px-2.5 text-xs font-semibold text-white backdrop-blur hover:bg-black/70"
            >
              <RefreshCw size={13} /> 바꾸기
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-black/55 px-2.5 text-xs font-semibold text-white backdrop-blur hover:bg-black/70"
            >
              <X size={13} /> 빼기
            </button>
          )}
        </div>
      )}
      {big &&
        url &&
        createPortal(
        <div
          role="dialog"
          aria-label="일정 사진"
          onClick={() => setBig(false)}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-3"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 기기에서 만든 blob 주소 */}
          <img src={url} alt="일정 사진" className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            aria-label="닫기"
            onClick={() => setBig(false)}
            className="absolute top-[calc(12px+env(safe-area-inset-top))] right-3 grid size-10 place-items-center rounded-full bg-white/15 text-white"
          >
            <X size={20} />
          </button>
        </div>,
          document.body,
        )}
    </div>
  );
}
