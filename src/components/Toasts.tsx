"use client";

import { X } from "lucide-react";
import { usePlanner } from "./PlannerProvider";
import { cx } from "./ui";

export function Toasts() {
  const { toasts, dropToast } = usePlanner();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex flex-col items-center gap-2 px-4 md:right-6 md:bottom-28 md:left-auto md:items-end">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "fade-up pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-2xl backdrop-blur-xl",
            t.tone === "danger"
              ? "border-danger/40 bg-[color-mix(in_oklab,var(--danger)_14%,var(--surface))]"
              : t.tone === "ok"
                ? "border-accent/40 bg-[color-mix(in_oklab,var(--accent)_10%,var(--surface))]"
                : "border-line bg-surface/95",
          )}
        >
          <span className="min-w-0 flex-1">{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.onClick();
                dropToast(t.id);
              }}
              className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-xs font-bold text-accent-fg"
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dropToast(t.id)} className="shrink-0 text-muted hover:text-fg" aria-label="닫기">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
