"use client";

import { useMemo, useState } from "react";
import { dayStats, recentLogs, tasksOnDay, weekDays } from "@/lib/planner";
import { addDays, dayKey, fmtTime, MIN, startOfDay, WEEKDAYS } from "@/lib/time";
import type { LogKind } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";
import { Chip, cx, Modal } from "./ui";

const KINDS: { value: "all" | LogKind; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "postponed", label: "미룸" },
  { value: "skipped", label: "건너뜀" },
  { value: "missed", label: "놓침" },
  { value: "focus_abandoned", label: "집중 중단" },
];

const BADGE: Partial<Record<LogKind, string>> = {
  postponed: "bg-warn/15 text-warn",
  skipped: "bg-surface-3 text-muted",
  missed: "bg-danger-soft text-danger",
  focus_abandoned: "bg-danger-soft text-danger",
};
const LABEL: Partial<Record<LogKind, string>> = {
  postponed: "미룸",
  skipped: "건너뜀",
  missed: "놓침",
  focus_abandoned: "집중 중단",
};

export function LogSheet() {
  const { sheet, openSheet, snap, tasks, settings } = usePlanner();
  const [filter, setFilter] = useState<"all" | LogKind>("all");
  const [weekOffset, setWeekOffset] = useState(0);

  const anchor = addDays(startOfDay(new Date()), weekOffset * 7);
  const week = weekDays(anchor);
  const from = week[0].getTime();
  const to = addDays(week[6], 1).getTime();

  const now = useNow(60_000);
  const data = useMemo(() => {
    const perDay = week.map((d) => {
      const list = tasksOnDay(tasks, d);
      return { d, s: dayStats(list, now, settings.graceMin) };
    });
    const logs = recentLogs(snap.db, from).filter((l) => Date.parse(l.created_at) < to);
    const focus = Object.values(snap.db.focus_sessions).filter(
      (f) => !f.deleted_at && f.mode === "focus" && Date.parse(f.started_at) >= from && Date.parse(f.started_at) < to,
    );
    const focusMin = Math.round(
      focus.filter((f) => f.completed).reduce((n, f) => n + (Date.parse(f.planned_end) - Date.parse(f.started_at)) / MIN, 0),
    );
    const total = perDay.reduce((n, x) => n + x.s.total, 0);
    const done = perDay.reduce((n, x) => n + x.s.done, 0);
    const reasons = logs.filter((l) => l.reason && LABEL[l.kind]);
    const freq = new Map<string, number>();
    for (const l of reasons) {
      const k = l.reason!.trim().replace(/\s+/g, " ").slice(0, 40);
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      perDay,
      reasons,
      top,
      focusMin,
      rate: total ? Math.round((done / total) * 100) : 0,
      postponed: logs.filter((l) => l.kind === "postponed").length,
      skipped: logs.filter((l) => l.kind === "skipped" || l.kind === "missed").length,
      abandoned: logs.filter((l) => l.kind === "focus_abandoned").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, snap.db, from, to, settings.graceMin, now]);

  if (sheet !== "log") return null;
  const shown = data.reasons.filter((l) => filter === "all" || l.kind === filter);

  return (
    <Modal open onClose={() => openSheet(null)} title="기록 · 변명 노트" size="lg">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => setWeekOffset(weekOffset - 1)} className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface-2">
          ← 지난주
        </button>
        <p className="flex-1 text-center font-bold">
          {week[0].getMonth() + 1}/{week[0].getDate()} – {week[6].getMonth() + 1}/{week[6].getDate()}
          {weekOffset === 0 && <span className="ml-1 text-xs font-semibold text-accent-text">이번 주</span>}
        </p>
        <button
          disabled={weekOffset >= 0}
          onClick={() => setWeekOffset(weekOffset + 1)}
          className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface-2 disabled:opacity-30"
        >
          다음주 →
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { k: "주간 달성률", v: `${data.rate}%`, cls: data.rate >= 70 ? "text-accent-text" : data.rate >= 40 ? "text-warn" : "text-danger" },
          { k: "미룬 횟수", v: data.postponed, cls: data.postponed ? "text-warn" : "" },
          { k: "건너뜀·놓침", v: data.skipped, cls: data.skipped ? "text-danger" : "" },
          { k: "집중 시간", v: `${Math.floor(data.focusMin / 60)}h ${data.focusMin % 60}m`, cls: "" },
        ].map((x) => (
          <div key={x.k} className="rounded-2xl bg-surface-2 p-3">
            <p className="text-xs text-muted">{x.k}</p>
            <p className={cx("mt-1 font-mono text-2xl font-bold tabular-nums", x.cls)}>{x.v}</p>
          </div>
        ))}
      </div>

      {/* 일별 달성률 막대 */}
      <div className="mt-5 flex h-40 items-end gap-2 rounded-2xl border border-line p-3">
        {data.perDay.map(({ d, s }) => {
          const today = dayKey(d) === dayKey(new Date());
          return (
            <div key={dayKey(d)} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="font-mono text-[11px] text-muted tabular-nums">{s.total ? `${s.rate}%` : ""}</span>
              <div className="flex w-full flex-1 items-end overflow-hidden rounded-lg bg-surface-2">
                <div
                  className="w-full rounded-lg transition-[height] duration-500"
                  style={{
                    height: `${s.total ? Math.max(4, s.rate) : 0}%`,
                    background: s.rate >= 80 ? "var(--accent)" : s.rate >= 40 ? "var(--warn)" : "var(--danger)",
                  }}
                />
              </div>
              <span className={cx("text-xs font-semibold", today ? "text-accent-text" : "text-muted")}>{WEEKDAYS[d.getDay()]}</span>
            </div>
          );
        })}
      </div>

      {data.top.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-bold">자주 쓰는 변명</p>
          <div className="flex flex-wrap gap-1.5">
            {data.top.map(([r, n]) => (
              <span key={r} className="rounded-xl bg-surface-2 px-3 py-1.5 text-sm">
                “{r}” <b className="ml-1 font-mono text-warn">×{n}</b>
              </span>
            ))}
          </div>
          {data.top[0][1] >= 3 && (
            <p className="mt-2 text-sm text-muted">
              같은 이유가 {data.top[0][1]}번 나왔어요. 이유를 없애는 쪽으로 계획을 바꿔 보세요 — 시간대를 옮기거나 길이를 줄이거나.
            </p>
          )}
        </div>
      )}

      <div className="mt-5">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <Chip key={k.value} active={filter === k.value} onClick={() => setFilter(k.value)}>
              {k.label}
            </Chip>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">이 주에는 기록된 사유가 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((l) => (
              <li key={l.id} className="rounded-2xl border border-line px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={cx("rounded px-1.5 py-px font-bold", BADGE[l.kind])}>{LABEL[l.kind]}</span>
                  <span className="font-semibold">{l.title}</span>
                  {l.kind === "postponed" && l.from_starts_at && l.to_starts_at && (
                    <span className="font-mono text-muted tabular-nums">
                      {fmtTime(l.from_starts_at)} → {new Date(l.to_starts_at).getDate() !== new Date(l.from_starts_at).getDate() ? `${new Date(l.to_starts_at).getMonth() + 1}/${new Date(l.to_starts_at).getDate()} ` : ""}
                      {fmtTime(l.to_starts_at)}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-faint tabular-nums">
                    {WEEKDAYS[new Date(l.created_at).getDay()]} {fmtTime(l.created_at)}
                  </span>
                </div>
                <p className="mt-1.5 text-[15px] leading-snug">“{l.reason}”</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-6 text-center text-xs text-faint">사유 기록은 지울 수 없습니다 — 그래야 패턴이 보입니다.</p>
    </Modal>
  );
}
