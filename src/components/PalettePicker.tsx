"use client";

import { Check } from "lucide-react";
import { PALETTES } from "@/lib/palettes";
import { usePlanner } from "./PlannerProvider";
import { cx } from "./ui";

/** 테마 고르기 — ☰ 메뉴(작게)와 설정 → 화면·데이터에서 같이 쓴다 */
export function PalettePicker({ compact = false }: { compact?: boolean }) {
  const { settings, updateSettings } = usePlanner();
  return (
    <div className={cx("grid gap-1.5", compact ? "grid-cols-5" : "grid-cols-3 sm:grid-cols-5")} role="radiogroup" aria-label="테마">
      {PALETTES.map((p) => {
        const on = settings.palette === p.value;
        return (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => updateSettings({ palette: p.value })}
            className={cx(
              "flex flex-col items-center gap-1 rounded-xl border-2 p-1.5 transition",
              on ? "border-accent bg-surface-2" : "border-transparent hover:border-line-strong",
            )}
            title={p.label}
          >
            <span
              className="relative grid size-8 place-items-center overflow-hidden rounded-full ring-1 ring-line-strong"
              style={{ background: `linear-gradient(135deg, ${p.swatch[0]} 0 50%, ${p.swatch[1]} 50% 100%)` }}
            >
              {on && (
                <span className="grid size-4 place-items-center rounded-full bg-black/45 text-white">
                  <Check size={11} strokeWidth={3} />
                </span>
              )}
            </span>
            <span className={cx("w-full truncate text-center font-semibold", compact ? "text-[10px]" : "text-xs")}>{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}
