"use client";

import { Check, Play, Repeat, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { taskState, type TaskState } from "@/lib/planner";
import { addMinutes, dayKey, fmtTime, MIN, minutesOfDay, sameDay, snapMinutes, startOfDay, WEEKDAYS } from "@/lib/time";
import { COLOR_HEX, type Activity, type Task } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cx } from "./ui";

interface Props {
  days: Date[];
  tasks: Task[];
  graceMin: number;
  dayStartHour: number;
  onCreate: (start: Date) => void;
  onOpen: (task: Task) => void;
  /** false 를 돌려주면 이동이 거절된 것(사유 입력 필요) */
  onMove: (task: Task, start: Date, end: Date) => boolean;
  onSelectDay?: (d: Date) => void;
  dayRates?: Record<string, number>;
  /** 시각이 있는 한 일 기록 — 일정과 다른 모양(점선)으로, 끌어서 옮기지 않는다 */
  activities?: Activity[];
  onOpenActivity?: (a: Activity) => void;
}

type Item = { kind: "task"; task: Task } | { kind: "activity"; act: Activity };

interface Placed {
  item: Item;
  col: number;
  cols: number;
  top: number;
  height: number;
}

interface Drag {
  id: string;
  mode: "move" | "resize";
  pointerId: number;
  pointerType: string;
  x0: number;
  y0: number;
  dayIndex: number;
  active: boolean;
  dMin: number;
  dDay: number;
  timer: number | null;
}

const SNAP = 5;

function layoutDay(tasks: Task[], acts: Activity[], day: Date, hourPx: number): Placed[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + 24 * 60 * MIN;
  const spans: { item: Item; start: string; end: string }[] = [
    ...tasks.map((t) => ({ item: { kind: "task", task: t } as Item, start: t.starts_at, end: t.ends_at })),
    ...acts
      .filter((a) => a.starts_at && a.ends_at)
      .map((a) => ({ item: { kind: "activity", act: a } as Item, start: a.starts_at!, end: a.ends_at! })),
  ];
  const items = spans
    .filter((x) => Date.parse(x.start) < dayEnd && Date.parse(x.end) > dayStart && sameDay(new Date(x.start), day))
    .map((x) => {
      const s = Math.max(Date.parse(x.start), dayStart);
      const e = Math.min(Date.parse(x.end), dayEnd);
      return { item: x.item, s, e };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);

  const out: Placed[] = [];
  let cluster: { item: Item; s: number; e: number; col: number }[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) {
      const top = ((c.s - dayStart) / (60 * MIN)) * hourPx;
      const height = Math.max(24, ((c.e - c.s) / (60 * MIN)) * hourPx - 2);
      out.push({ item: c.item, col: c.col, cols, top, height });
    }
    cluster = [];
  };
  for (const it of items) {
    if (it.s >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.e > it.s).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ...it, col });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return out;
}

const STATE_STYLE: Record<TaskState, string> = {
  upcoming: "",
  soon: "ring-2 ring-accent",
  late: "ring-2 ring-warn",
  overdue: "overdue-pulse ring-2 ring-danger",
  in_progress: "ring-2 ring-[var(--c)] shadow-[0_0_24px_-6px_var(--c)]",
  done: "opacity-55",
  skipped: "opacity-50",
  missed: "opacity-60",
};

export function Timeline({
  days,
  tasks,
  graceMin,
  dayStartHour,
  onCreate,
  onOpen,
  onMove,
  onSelectDay,
  dayRates,
  activities = [],
  onOpenActivity,
}: Props) {
  const now = useNow(30_000);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [hourPx, setHourPx] = useState(64);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const tapRef = useRef<{ x: number; y: number; t: number; dayIndex: number } | null>(null);

  useLayoutEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const set = () => setHourPx(mq.matches ? 72 : 64);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  // 처음 열 때 지금 시각(오늘이 보이면) 또는 하루 시작 시각으로 스크롤
  const firstKey = dayKey(days[0]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const showsToday = days.some((d) => sameDay(d, new Date()));
    const targetMin = showsToday ? Math.max(0, minutesOfDay(new Date()) - 90) : dayStartHour * 60;
    el.scrollTo({ top: (targetMin / 60) * hourPx, behavior: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey, days.length, hourPx]);

  const placed = useMemo(() => days.map((d) => layoutDay(tasks, activities, d, hourPx)), [days, tasks, activities, hourPx]);

  const setD = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const colWidth = () => (gridRef.current?.clientWidth ?? 1) / days.length;

  const onWindowMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      if (!d.active) {
        if (d.pointerType === "mouse" && Math.hypot(dx, dy) > 4) {
          setD({ ...d, active: true });
        } else if (d.pointerType !== "mouse" && Math.hypot(dx, dy) > 8) {
          // 길게 누르기 전에 움직임 → 스크롤로 간주
          if (d.timer) window.clearTimeout(d.timer);
          setD(null);
        }
        return;
      }
      const dMin = snapMinutes((dy / hourPx) * 60, SNAP);
      const dDay =
        d.mode === "move" && days.length > 1
          ? Math.max(-d.dayIndex, Math.min(days.length - 1 - d.dayIndex, Math.round(dx / colWidth())))
          : 0;
      if (dMin !== d.dMin || dDay !== d.dDay) setD({ ...d, dMin, dDay });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hourPx, days.length],
  );

  const finish = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (d.timer) window.clearTimeout(d.timer);
      setD(null);
      const task = tasks.find((t) => t.id === d.id);
      if (!task) return;
      if (!d.active) {
        if (e.type === "pointerup") onOpen(task);
        return;
      }
      if (d.dMin === 0 && d.dDay === 0) return;
      const s = new Date(task.starts_at);
      const en = new Date(task.ends_at);
      if (d.mode === "move") {
        const ns = addMinutes(s, d.dMin + d.dDay * 24 * 60);
        const ne = addMinutes(en, d.dMin + d.dDay * 24 * 60);
        onMove(task, ns, ne);
      } else {
        const ne = addMinutes(en, d.dMin);
        if (ne.getTime() - s.getTime() >= 10 * MIN) onMove(task, s, ne);
      }
    },
    [tasks, onMove, onOpen],
  );

  useEffect(() => {
    if (!drag) return;
    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onWindowMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [drag, onWindowMove, finish]);

  // 터치로 끄는 동안 화면이 스크롤되지 않게 (passive:false 여야 preventDefault 가능)
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (dragRef.current?.active) e.preventDefault();
    };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  const beginDrag = (e: React.PointerEvent, task: Task, mode: Drag["mode"], dayIndex: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const d: Drag = {
      id: task.id,
      mode,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      x0: e.clientX,
      y0: e.clientY,
      dayIndex,
      active: false,
      dMin: 0,
      dDay: 0,
      timer: null,
    };
    if (e.pointerType !== "mouse") {
      d.timer = window.setTimeout(() => {
        if (dragRef.current?.id === task.id) {
          navigator.vibrate?.(12);
          setD({ ...dragRef.current, active: true });
        }
      }, 320);
    }
    setD(d);
  };

  const onColumnPointerDown = (e: React.PointerEvent, dayIndex: number) => {
    if (e.button !== 0) return;
    tapRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, dayIndex };
  };

  const onColumnPointerUp = (e: React.PointerEvent, day: Date) => {
    const tap = tapRef.current;
    tapRef.current = null;
    if (!tap || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8 || e.timeStamp - tap.t > 600) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const mins = Math.max(0, Math.min(24 * 60 - 15, Math.floor(((y / hourPx) * 60) / 15) * 15));
    const start = new Date(startOfDay(day).getTime() + mins * MIN);
    onCreate(start);
  };

  const today = new Date(now);
  const nowTop = (minutesOfDay(today) / 60) * hourPx;
  const todayIndex = days.findIndex((d) => sameDay(d, today));
  const week = days.length > 1;

  return (
    <div className="flex min-h-0 flex-col">
      {week && (
        <div className="flex border-b border-line pr-1 pl-12">
          {days.map((d, i) => {
            const isToday = i === todayIndex;
            const rate = dayRates?.[dayKey(d)];
            return (
              <button
                key={i}
                onClick={() => onSelectDay?.(d)}
                className="flex flex-1 flex-col items-center gap-0.5 py-2 hover:bg-surface-2"
              >
                <span className={cx("text-[11px] font-semibold", d.getDay() === 0 ? "text-danger" : "text-muted")}>
                  {WEEKDAYS[d.getDay()]}
                </span>
                <span
                  className={cx(
                    "grid size-8 place-items-center rounded-full font-mono text-sm font-bold tabular-nums",
                    isToday && "bg-accent text-accent-fg",
                  )}
                >
                  {d.getDate()}
                </span>
                <span className="h-1 w-8 overflow-hidden rounded-full bg-surface-3">
                  {rate !== undefined && (
                    <span className="block h-full bg-accent" style={{ width: `${rate}%` }} />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div ref={scrollRef} className="relative h-[62dvh] overflow-y-auto overscroll-contain md:h-[min(72dvh,760px)]">
        <div className="relative flex" style={{ height: hourPx * 24 + 12 }}>
          {/* 시간 눈금 */}
          <div className="relative w-12 shrink-0 select-none">
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 font-mono text-[11px] text-faint tabular-nums"
                style={{ top: h * hourPx + 6 }}
              >
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
            {todayIndex >= 0 && (
              <span
                className="absolute right-1 z-10 -translate-y-1/2 rounded-md bg-danger px-1 font-mono text-[10px] font-bold text-white tabular-nums"
                style={{ top: nowTop + 6 }}
              >
                {fmtTime(today)}
              </span>
            )}
          </div>

          <div ref={gridRef} className="grid-hours relative mt-1.5 flex-1 border-l border-line" style={{ height: hourPx * 24 }}>
            {days.map((day, di) => (
              <div
                key={di}
                className={cx(
                  "absolute top-0 bottom-0 border-line",
                  di > 0 && "border-l",
                  di === todayIndex && week && "bg-[color-mix(in_oklab,var(--accent)_4%,transparent)]",
                )}
                style={{ left: `${(di / days.length) * 100}%`, width: `${100 / days.length}%` }}
                onPointerDown={(e) => onColumnPointerDown(e, di)}
                onPointerUp={(e) => onColumnPointerUp(e, day)}
              >
                {placed[di].map((p) => {
                  if (p.item.kind === "activity") {
                    const a = p.item.act;
                    const color = COLOR_HEX[a.color];
                    const compact = p.height < 44;
                    return (
                      <div
                        key={a.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`한 일: ${a.title}`}
                        onKeyDown={(e) => e.key === "Enter" && onOpenActivity?.(a)}
                        onPointerDown={(e) => e.stopPropagation()}
                        onPointerUp={(e) => {
                          e.stopPropagation();
                          onOpenActivity?.(a);
                        }}
                        className="absolute cursor-pointer overflow-hidden rounded-xl border-2 border-dashed px-2 py-1 text-left select-none hover:brightness-110"
                        style={{
                          top: p.top,
                          height: Math.max(22, p.height),
                          left: `calc(${(p.col / p.cols) * 100}% + 3px)`,
                          width: `calc(${100 / p.cols}% - 6px)`,
                          borderColor: `color-mix(in oklab, ${color} 70%, transparent)`,
                          background: `repeating-linear-gradient(135deg, color-mix(in oklab, ${color} 16%, var(--surface)) 0 8px, color-mix(in oklab, ${color} 9%, var(--surface)) 8px 16px)`,
                        }}
                      >
                        <div className={cx("flex min-w-0 items-center gap-1", compact ? "text-[12px]" : "text-[13px]")}>
                          <span className="grid size-3.5 shrink-0 place-items-center rounded-full" style={{ background: color }}>
                            <Check size={10} strokeWidth={3.5} className="text-[#0b0c10]" />
                          </span>
                          <span className="truncate font-semibold">{a.title}</span>
                          {compact && (
                            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted tabular-nums">{fmtTime(a.starts_at!)}</span>
                          )}
                        </div>
                        {!compact && (
                          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted tabular-nums">
                            {fmtTime(a.starts_at!)} – {fmtTime(a.ends_at!)}
                            <span className="rounded bg-did-soft px-1 font-sans text-[10px] font-bold text-did">한 일</span>
                          </div>
                        )}
                      </div>
                    );
                  }
                  const t = p.item.task;
                  const st = taskState(t, now, graceMin);
                  const isDragging = drag?.id === t.id && drag.active;
                  const dTop = isDragging && drag.mode === "move" ? (drag.dMin / 60) * hourPx : 0;
                  const dH = isDragging && drag.mode === "resize" ? (drag.dMin / 60) * hourPx : 0;
                  const color = COLOR_HEX[t.color];
                  const compact = p.height < 44;
                  const dimmed = st === "done" || st === "skipped" || st === "missed";
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && onOpen(t)}
                      onPointerDown={(e) => beginDrag(e, t, "move", di)}
                      onPointerUp={(e) => e.stopPropagation()}
                      className={cx(
                        "group absolute overflow-hidden rounded-xl border-l-[3px] px-2 py-1 text-left transition-[box-shadow,opacity] select-none",
                        STATE_STYLE[st],
                        isDragging && "z-20 cursor-grabbing opacity-90 shadow-2xl",
                        !isDragging && "cursor-grab hover:brightness-110",
                        st === "overdue" && "!border-l-danger",
                      )}
                      style={
                        {
                          "--c": color,
                          top: p.top + dTop,
                          height: Math.max(22, p.height + dH),
                          left: `calc(${(p.col / p.cols) * 100}% + 3px)`,
                          width: `calc(${100 / p.cols}% - 6px)`,
                          transform: isDragging && drag.dDay ? `translateX(${drag.dDay * 100 * p.cols}%)` : undefined,
                          borderLeftColor: color,
                          background:
                            st === "overdue"
                              ? "var(--danger-soft)"
                              : dimmed
                                ? "repeating-linear-gradient(-45deg, var(--surface-2) 0 6px, var(--surface-3) 6px 12px)"
                                : `color-mix(in oklab, ${color} ${st === "in_progress" ? 30 : 17}%, var(--surface))`,
                          touchAction: isDragging ? "none" : "pan-y",
                        } as React.CSSProperties
                      }
                    >
                      <div className={cx("flex min-w-0 items-center gap-1", compact ? "text-[12px]" : "text-[13px]")}>
                        {st === "done" && <Check size={13} className="shrink-0 text-ok" />}
                        {st === "in_progress" && <Play size={12} className="shrink-0" style={{ color }} />}
                        {st === "overdue" && <TriangleAlert size={13} className="shrink-0 text-danger" />}
                        {t.habit_id && <Repeat size={11} className="shrink-0 text-muted" />}
                        <span
                          className={cx(
                            "truncate font-semibold",
                            dimmed && "line-through",
                            st === "overdue" && "text-danger",
                          )}
                        >
                          {t.title}
                        </span>
                        {compact && (
                          <span className="ml-auto shrink-0 font-mono text-[10px] text-muted tabular-nums">
                            {fmtTime(t.starts_at)}
                          </span>
                        )}
                      </div>
                      {!compact && (
                        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted tabular-nums">
                          {isDragging
                            ? drag.mode === "move"
                              ? `${fmtTime(addMinutes(new Date(t.starts_at), drag.dMin + drag.dDay * 1440))} – ${fmtTime(addMinutes(new Date(t.ends_at), drag.dMin + drag.dDay * 1440))}`
                              : `${fmtTime(t.starts_at)} – ${fmtTime(addMinutes(new Date(t.ends_at), drag.dMin))}`
                            : `${fmtTime(t.starts_at)} – ${fmtTime(t.ends_at)}`}
                          {t.postpone_count > 0 && (
                            <span className="rounded bg-warn/15 px-1 font-sans text-[10px] font-bold text-warn">
                              {t.postpone_count}회 미룸
                            </span>
                          )}
                        </div>
                      )}
                      {/* 길이 조절 손잡이 */}
                      <div
                        onPointerDown={(e) => beginDrag(e, t, "resize", di)}
                        className="absolute inset-x-0 bottom-0 flex h-2.5 cursor-ns-resize items-end justify-center"
                      >
                        <span className="mb-0.5 h-1 w-6 rounded-full bg-fg/20 opacity-0 transition group-hover:opacity-100" />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {todayIndex >= 0 && (
              <div
                className="pointer-events-none absolute z-10 h-0.5 bg-danger"
                style={{
                  top: nowTop,
                  left: `${(todayIndex / days.length) * 100}%`,
                  width: `${100 / days.length}%`,
                }}
              >
                <span className="absolute -top-[5px] -left-[5px] size-3 rounded-full bg-danger ring-4 ring-danger/20" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
