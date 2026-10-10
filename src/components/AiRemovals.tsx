"use client";

import { Check, Lock, Repeat, Trash2 } from "lucide-react";
import type { AiRemoval } from "@/lib/ai";
import { deleteHabit, deleteTask, taskState } from "@/lib/planner";
import type { PlannerStore } from "@/lib/store";
import type { DB } from "@/lib/types";
import { cx } from "./ui";

/** AI 가 지우자고 고른 일정 — 체크(on)한 것만 지운다. locked = 지금 미시작 경고 중인 강제 일정(편집 창처럼 못 지움) */
export type RemovalDraft = AiRemoval & { on: boolean; locked: boolean };

export function toRemovalDrafts(list: AiRemoval[], db: DB, now: number, graceMin: number): RemovalDraft[] {
  return list.map((r) => {
    const t = r.kind === "task" ? db.tasks[r.id] : undefined;
    const st = t ? taskState(t, now, graceMin) : null;
    const locked = Boolean(t?.strict && (st === "late" || st === "overdue"));
    return { ...r, on: !locked, locked };
  });
}

/** 지울 일정 목록(체크해서 고르기) */
export function RemovalList({ items, onToggle }: { items: RemovalDraft[]; onToggle: (i: number) => void }) {
  return (
    <ul className="space-y-1.5">
      {items.map((r, i) => (
        <li
          key={`${r.kind}:${r.id}`}
          className={cx("flex items-center gap-2.5 rounded-2xl border px-3 py-2.5", r.on ? "border-danger/50 bg-danger-soft" : "border-line bg-surface-2/60", r.locked && "opacity-70")}
        >
          <button
            type="button"
            disabled={r.locked}
            aria-label={r.on ? "지우지 않기" : "지우기"}
            onClick={() => onToggle(i)}
            className={cx(
              "grid size-6 shrink-0 place-items-center rounded-lg border-2 transition",
              r.on ? "border-danger bg-danger text-white" : "border-line-strong",
            )}
          >
            {r.locked ? <Lock size={12} /> : r.on && <Check size={14} strokeWidth={3} />}
          </button>
          <span className="min-w-0 flex-1">
            <span className={cx("block truncate text-[15px] font-semibold", r.on && "line-through decoration-danger/70")}>
              {r.kind === "habit" && <Repeat size={12} className="mr-1 inline text-muted" />}
              {r.title}
            </span>
            <span className="mt-0.5 block font-mono text-xs text-muted tabular-nums">
              {r.when}
              {r.kind === "habit" && <span className="font-sans"> · 앞으로의 회차도 지워져요</span>}
            </span>
            {r.locked && <span className="mt-0.5 block text-xs font-semibold text-warn">지금 미시작 경고 중이라 못 지워요 — 미루기·건너뛰기로 처리하세요</span>}
          </span>
          {r.on && <Trash2 size={16} className="shrink-0 text-danger" />}
        </li>
      ))}
    </ul>
  );
}

/** 고른 것을 지운다(습관이면 앞으로의 회차도 같이) — 지운 개수 */
export function applyRemovals(store: PlannerStore, items: RemovalDraft[]): number {
  let n = 0;
  for (const r of items) {
    if (!r.on || r.locked) continue;
    if (r.kind === "task") {
      const t = store.db.tasks[r.id];
      if (!t || t.deleted_at) continue;
      deleteTask(store, r.id);
    } else {
      const h = store.db.habits[r.id];
      if (!h || h.deleted_at) continue;
      deleteHabit(store, r.id);
    }
    n++;
  }
  return n;
}
