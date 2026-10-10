"use client";

import { useMemo, useState } from "react";
import { dayStats, recentLogs, tasksOnDay, weekDays } from "@/lib/planner";
import { buildReview, fmtMin } from "@/lib/review";
import { addDays, dayKey, fmtTime, MIN, startOfDay, WEEKDAYS } from "@/lib/time";
import { COLOR_HEX, type LogKind } from "@/lib/types";
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
  const [unit, setUnit] = useState<"week" | "month">("week");
  const [offset, setOffset] = useState(0);

  // 주: 이번 주(월~일) 기준 앞뒤 / 달: 이번 달 기준 앞뒤
  const today0 = startOfDay(new Date());
  const week =
    unit === "week"
      ? weekDays(addDays(today0, offset * 7))
      : (() => {
          const first = new Date(today0.getFullYear(), today0.getMonth() + offset, 1);
          const n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
          return Array.from({ length: n }, (_, i) => addDays(first, i));
        })();
  const last = week[week.length - 1];
  const from = week[0].getTime();
  const to = addDays(last, 1).getTime();

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
    const db = snap.db;
    const review = buildReview(
      {
        tasks,
        activities: Object.values(db.activities),
        categories: Object.values(db.categories),
        habits: Object.values(db.habits),
        logs: Object.values(db.task_logs),
      },
      from,
      to,
      now,
    );
    return {
      review,
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
  const rv = data.review;
  const span = unit === "week" ? "주" : "달";
  const catMax = Math.max(1, ...rv.cats.map((c) => Math.max(c.planMin, c.doneMin + c.actMin)));

  return (
    <Modal open onClose={() => openSheet(null)} title="돌아보기 · 변명 노트" size="lg">
      <div className="mb-3 flex gap-1.5">
        {(["week", "month"] as const).map((u) => (
          <Chip
            key={u}
            active={unit === u}
            onClick={() => {
              setUnit(u);
              setOffset(0);
            }}
          >
            {u === "week" ? "주" : "달"}
          </Chip>
        ))}
      </div>
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => setOffset(offset - 1)} className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface-2">
          ← 지난{span}
        </button>
        <p className="flex-1 text-center font-bold">
          {unit === "week"
            ? `${week[0].getMonth() + 1}/${week[0].getDate()} – ${last.getMonth() + 1}/${last.getDate()}`
            : `${week[0].getFullYear()}년 ${week[0].getMonth() + 1}월`}
          {offset === 0 && <span className="ml-1 text-xs font-semibold text-accent-text">이번 {span}</span>}
        </p>
        <button
          disabled={offset >= 0}
          onClick={() => setOffset(offset + 1)}
          className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface-2 disabled:opacity-30"
        >
          다음{span} →
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { k: unit === "week" ? "주간 달성률" : "한 달 달성률", v: `${data.rate}%`, cls: data.rate >= 70 ? "text-accent-text" : data.rate >= 40 ? "text-warn" : "text-danger" },
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
      <div className={cx("mt-5 flex h-40 items-end rounded-2xl border border-line p-3", unit === "week" ? "gap-2" : "gap-0.5")}>
        {data.perDay.map(({ d, s }) => {
          const today = dayKey(d) === dayKey(new Date());
          return (
            <div key={dayKey(d)} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              {unit === "week" && <span className="font-mono text-[11px] text-muted tabular-nums">{s.total ? `${s.rate}%` : ""}</span>}
              <div className="flex w-full flex-1 items-end overflow-hidden rounded-lg bg-surface-2">
                <div
                  className="w-full rounded-lg transition-[height] duration-500"
                  style={{
                    height: `${s.total ? Math.max(4, s.rate) : 0}%`,
                    background: s.rate >= 80 ? "var(--accent)" : s.rate >= 40 ? "var(--warn)" : "var(--danger)",
                  }}
                />
              </div>
              <span className={cx("font-semibold", unit === "week" ? "text-xs" : "text-[9px]", today ? "text-accent-text" : "text-muted")}>
                {unit === "week" ? WEEKDAYS[d.getDay()] : d.getDate() % 5 === 1 ? d.getDate() : ""}
              </span>
            </div>
          );
        })}
      </div>

      {/* 계획 대비 실제 + 시간을 어디에 썼나 */}
      <div className="mt-5 rounded-2xl border border-line p-4">
        <p className="text-sm font-bold">계획 대비 실제</p>
        {rv.planMin === 0 && rv.actCount === 0 ? (
          <p className="mt-1 text-sm text-muted">이 {span}엔 시각을 정한 일정도, 한 일 기록도 없어요.</p>
        ) : (
          <>
            <p className="mt-1 text-sm">
              계획 <b>{fmtMin(rv.planMin)}</b> 중 <b className="text-accent-text">{fmtMin(rv.doneMin)}</b> 해냈어요
              {rv.planMin > 0 && <span className="text-muted"> ({Math.round((rv.doneMin / rv.planMin) * 100)}%)</span>}
              {rv.actCount > 0 && (
                <>
                  {" "}· 한 일 기록 <b className="text-[var(--did)]">{rv.actCount}건</b>
                  {rv.actMin > 0 && <span className="text-muted"> ({fmtMin(rv.actMin)})</span>}
                </>
              )}
            </p>
            <p className="mt-4 mb-2 text-xs font-bold text-muted">시간을 어디에 썼나</p>
            <ul className="space-y-2.5">
              {rv.cats.map((c) => (
                <li key={c.id}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: COLOR_HEX[c.color] }} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
                    <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
                      {c.planMin > 0 && `${fmtMin(c.doneMin)} / ${fmtMin(c.planMin)}`}
                      {c.actCount > 0 && <span className="ml-1.5 text-[var(--did)]">+한 일 {c.actMin ? fmtMin(c.actMin) : `${c.actCount}건`}</span>}
                    </span>
                  </div>
                  {/* 옅은 막대 = 계획, 진한 막대 = 해낸 시간, 청록 = 한 일 기록 */}
                  <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className="absolute inset-y-0 left-0 rounded-full opacity-30" style={{ width: `${(c.planMin / catMax) * 100}%`, background: COLOR_HEX[c.color] }} />
                    <div className="absolute inset-y-0 left-0 flex w-full">
                      <div className="h-full rounded-l-full" style={{ width: `${(c.doneMin / catMax) * 100}%`, background: COLOR_HEX[c.color] }} />
                      <div className="h-full bg-[var(--did)]" style={{ width: `${(c.actMin / catMax) * 100}%` }} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {rv.habits.length > 0 && (
        <div className="mt-4 rounded-2xl border border-line p-4">
          <p className="mb-2 text-sm font-bold">습관</p>
          <ul className="space-y-2">
            {rv.habits.map((h) => (
              <li key={h.id} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: COLOR_HEX[h.color] }} />
                <span className="min-w-0 flex-1 truncate">{h.title}</span>
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${(h.done / h.total) * 100}%`, background: COLOR_HEX[h.color] }} />
                </div>
                <span className="w-10 text-right font-mono text-xs text-muted tabular-nums">
                  {h.done}/{h.total}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rv.slots.some((x) => x.total > 0 || x.slipped > 0) && (
        <div className="mt-4 rounded-2xl border border-line p-4">
          <p className="mb-2 text-sm font-bold">시간대별로 얼마나 지켰나</p>
          <div className="grid grid-cols-4 gap-2">
            {rv.slots.map((x) => (
              <div key={x.key} className={cx("rounded-xl p-2 text-center", rv.weakSlot?.key === x.key ? "bg-danger-soft" : "bg-surface-2")}>
                <p className="text-xs font-semibold text-muted">{x.label}</p>
                <p className="mt-0.5 font-mono text-lg font-bold tabular-nums">{x.total ? `${Math.round((x.kept / x.total) * 100)}%` : "–"}</p>
                <p className="text-[11px] text-muted">
                  {x.kept}/{x.total}
                  {x.slipped > 0 && <span className="text-danger"> · 어김 {x.slipped}</span>}
                </p>
              </div>
            ))}
          </div>
          {(rv.weakSlot || rv.weakDow) && (
            <p className="mt-2 text-sm text-muted">
              {rv.weakSlot && `${rv.weakSlot.label}에 가장 많이 어겼어요(${rv.weakSlot.slipped}번). ${rv.weakSlot.label} 일정을 줄이거나 시간을 옮겨 보세요. `}
              {rv.weakDow && `${WEEKDAYS[rv.weakDow.dow]}요일에 자주 어겨요(${rv.weakDow.slipped}번).`}
            </p>
          )}
        </div>
      )}

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
          <p className="py-6 text-center text-sm text-muted">이 {span}에는 기록된 사유가 없습니다.</p>
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
