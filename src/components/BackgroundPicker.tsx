"use client";

import { Check } from "lucide-react";
import { BACKGROUNDS, bgUrl, findBackground } from "@/lib/backgrounds";
import { usePlanner } from "./PlannerProvider";
import { cx } from "./ui";

/** 사진 배경 고르기 — ☰ 메뉴(작게)와 설정 → 화면(크게)에서 같이 쓴다 */
export function BackgroundPicker({ compact = false }: { compact?: boolean }) {
  const { settings, updateSettings } = usePlanner();
  const current = findBackground(settings.background).key;
  return (
    <div className={cx("grid gap-1.5", compact ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-4")} role="radiogroup" aria-label="배경">
      {BACKGROUNDS.map((b) => {
        const on = current === b.key;
        return (
          <button
            key={b.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => updateSettings({ background: b.key })}
            className={cx(
              "relative aspect-[4/3] overflow-hidden rounded-lg border-2 transition",
              on ? "border-accent" : "border-transparent hover:border-line-strong",
            )}
            title={b.name}
          >
            <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${bgUrl(b.thumb)})` }} />
            {on && (
              <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-accent text-accent-fg">
                <Check size={11} strokeWidth={3} />
              </span>
            )}
            <span className={cx("absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 font-semibold text-white", compact ? "text-[10px]" : "text-xs")}>
              {b.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
