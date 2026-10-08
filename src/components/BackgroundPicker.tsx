"use client";

import { Check, ImagePlus } from "lucide-react";
import { useRef, useState } from "react";
import { BACKGROUNDS, bgUrl, CUSTOM_BG, findBackground } from "@/lib/backgrounds";
import { clearCustomBg, saveCustomBg, useCustomBg } from "@/lib/customBg";
import { usePlanner } from "./PlannerProvider";
import { cx } from "./ui";

/** 사진 배경 고르기 — ☰ 메뉴(작게)와 설정 → 화면(크게)에서 같이 쓴다. 맨 앞 칸은 '내 사진'(이 기기에만 저장) */
export function BackgroundPicker({ compact = false }: { compact?: boolean }) {
  const { settings, updateSettings, toast } = usePlanner();
  const custom = useCustomBg();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const current = settings.background === CUSTOM_BG && custom ? CUSTOM_BG : findBackground(settings.background).key;
  const customOn = current === CUSTOM_BG;

  const pick = async (file: File) => {
    setBusy(true);
    try {
      await saveCustomBg(file);
      updateSettings({ background: CUSTOM_BG });
      toast({ text: "내 사진을 배경으로 했어요 — 이 기기에서만 보여요", tone: "ok" });
    } catch (e) {
      toast({ text: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const tile = (on: boolean) =>
    cx("relative aspect-[4/3] overflow-hidden rounded-lg border-2 transition", on ? "border-accent" : "border-transparent hover:border-line-strong");
  const label = cx("absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 font-semibold text-white", compact ? "text-[10px]" : "text-xs");
  const tick = (
    <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-accent text-accent-fg">
      <Check size={11} strokeWidth={3} />
    </span>
  );

  return (
    <div>
      <div className={cx("grid gap-1.5", compact ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-4")} role="radiogroup" aria-label="배경">
        <button
          type="button"
          role="radio"
          aria-checked={customOn}
          disabled={busy}
          // 내 사진이 있으면 고르기, 이미 골라져 있거나 없으면 사진 고르기
          onClick={() => (custom && !customOn ? updateSettings({ background: CUSTOM_BG }) : input.current?.click())}
          className={cx(tile(customOn), !custom && "border-dashed border-line-strong bg-surface-2")}
          title={custom ? (customOn ? "다른 사진으로 바꾸기" : "내 사진") : "내 사진 넣기"}
        >
          {custom ? (
            <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${custom})` }} />
          ) : (
            <span className="absolute inset-0 grid place-items-center pb-3 text-muted">
              <ImagePlus size={compact ? 18 : 22} />
            </span>
          )}
          {customOn && tick}
          <span className={label}>{busy ? "넣는 중…" : custom ? (customOn ? "내 사진 · 바꾸기" : "내 사진") : "+ 내 사진"}</span>
        </button>
        {BACKGROUNDS.map((b) => {
          const on = current === b.key;
          return (
            <button
              key={b.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => updateSettings({ background: b.key })}
              className={tile(on)}
              title={b.name}
            >
              <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${bgUrl(b.thumb)})` }} />
              {on && tick}
              <span className={label}>{b.name}</span>
            </button>
          );
        })}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="배경으로 쓸 사진"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />
      {!compact && custom && (
        <button
          type="button"
          onClick={() => {
            void clearCustomBg();
            if (settings.background === CUSTOM_BG) updateSettings({ background: BACKGROUNDS[0].key });
          }}
          className="mt-2 text-xs font-semibold text-muted underline hover:text-fg"
        >
          내 사진 지우기
        </button>
      )}
    </div>
  );
}
