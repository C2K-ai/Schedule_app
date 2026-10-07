"use client";

import { CheckCircle2 } from "lucide-react";
import { useMemo } from "react";
import { liveCategories } from "@/lib/planner";
import { dayKey, fmtDate, parseDayKey } from "@/lib/time";
import type { Task } from "@/lib/types";
import { usePlanner } from "./PlannerProvider";
import { TaskRow } from "./TasksTab";
import { Empty, Modal } from "./ui";

/** 완료된 모든 작업 — 완료한 날짜별로 묶어서. 체크를 다시 누르면 되살린다. */
export function CompletedSheet() {
  const { sheet, openSheet, tasks, snap } = usePlanner();
  const categories = useMemo(() => liveCategories(snap.db), [snap.db]);
  const days = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.status !== "done" || !t.completed_at) continue;
      const k = dayKey(new Date(t.completed_at));
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([k, list]) => [k, list.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))] as const);
  }, [tasks]);
  if (sheet !== "completed") return null;
  const total = days.reduce((n, [, l]) => n + l.length, 0);
  return (
    <Modal open onClose={() => openSheet(null)} title="완료된 작업" subtitle={`최근 기록 ${total}개 · 체크를 누르면 다시 할 일로`} size="lg">
      {days.length === 0 ? (
        <Empty icon={<CheckCircle2 size={22} />} title="아직 완료한 작업이 없어요" />
      ) : (
        <div className="space-y-4">
          {days.map(([k, list]) => (
            <section key={k}>
              <p className="px-3 pb-1 text-[13px] font-bold text-muted">
                {fmtDate(parseDayKey(k))} <span className="font-mono tabular-nums">({list.length})</span>
              </p>
              <ul>
                {list.map((t) => (
                  <TaskRow key={t.id} t={t} categories={categories} showDate />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
