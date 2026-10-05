"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useCallback, useMemo } from "react";
import { dayStats, moveTask, tasksOnDay, weekDays } from "@/lib/planner";
import { addDays, dayKey, fmtDate, fmtTime, MIN, sameDay, startOfDay, WEEKDAYS } from "@/lib/time";
import type { Task } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";
import { Timeline } from "./Timeline";
import { Button, Card, cx, IconButton, Segmented } from "./ui";

export type View = "day" | "week";

function WeekStrip({ selected, onSelect, rates }: { selected: Date; onSelect: (d: Date) => void; rates: Record<string, number> }) {
  const days = weekDays(selected);
  const today = new Date();
  return (
    <div className="grid grid-cols-7 gap-1 border-b border-line px-2 py-2">
      {days.map((d) => {
        const sel = sameDay(d, selected);
        const isToday = sameDay(d, today);
        const rate = rates[dayKey(d)];
        return (
          <button
            key={dayKey(d)}
            onClick={() => onSelect(d)}
            className={cx(
              "flex flex-col items-center gap-1 rounded-xl py-1.5 transition",
              sel ? "bg-fg text-bg" : "hover:bg-surface-2",
            )}
          >
            <span className={cx("text-[11px] font-semibold", !sel && (d.getDay() === 0 ? "text-danger" : "text-muted"))}>
              {WEEKDAYS[d.getDay()]}
            </span>
            <span className="relative font-mono text-[15px] font-bold tabular-nums">
              {d.getDate()}
              {isToday && !sel && <span className="absolute -top-0.5 -right-1.5 size-1.5 rounded-full bg-accent" />}
            </span>
            <span className={cx("h-1 w-7 overflow-hidden rounded-full", sel ? "bg-bg/25" : "bg-surface-3")}>
              {rate !== undefined && (
                <span
                  className="block h-full"
                  style={{
                    width: `${rate}%`,
                    background: rate >= 80 ? "var(--accent)" : rate >= 40 ? "var(--warn)" : "var(--danger)",
                  }}
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Board({
  selected,
  setSelected,
  view,
  setView,
}: {
  selected: Date;
  setSelected: (d: Date) => void;
  view: View;
  setView: (v: View) => void;
}) {
  const { tasks, settings, store, openEditor, askPostpone, toast } = usePlanner();
  const now = useNow(60_000);

  const days = useMemo(() => (view === "day" ? [startOfDay(selected)] : weekDays(selected)), [selected, view]);
  const rates = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of weekDays(selected)) {
      const list = tasksOnDay(tasks, d);
      if (list.length) out[dayKey(d)] = dayStats(list, now || Date.now(), settings.graceMin).rate;
    }
    return out;
  }, [tasks, selected, now, settings.graceMin]);

  const onMove = useCallback(
    (t: Task, s: Date, e: Date) => {
      const ok = moveTask(store, t.id, s, e);
      if (!ok) askPostpone(t.id, s);
      else toast({ text: `${t.title} → ${fmtTime(s)}–${fmtTime(e)}` });
      return ok;
    },
    [store, askPostpone, toast],
  );

  const step = view === "day" ? 1 : 7;
  const isToday = sameDay(selected, new Date());

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 md:px-4">
        <div className="flex items-center">
          <IconButton label="이전" onClick={() => setSelected(addDays(selected, -step))}>
            <ChevronLeft size={20} />
          </IconButton>
          <p className="min-w-[124px] text-center font-bold">
            {view === "day"
              ? fmtDate(selected)
              : `${days[0].getMonth() + 1}/${days[0].getDate()} – ${days[6].getMonth() + 1}/${days[6].getDate()}`}
          </p>
          <IconButton label="다음" onClick={() => setSelected(addDays(selected, step))}>
            <ChevronRight size={20} />
          </IconButton>
        </div>
        {!isToday && (
          <Button size="sm" variant="outline" onClick={() => setSelected(new Date())}>
            오늘
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "day", label: "일" },
              { value: "week", label: "주" },
            ]}
          />
          <Button
            variant="primary"
            size="sm"
            className="hidden md:inline-flex"
            onClick={() => {
              const base = isToday ? new Date(Math.ceil(Date.now() / (15 * MIN)) * 15 * MIN) : new Date(startOfDay(selected).getTime() + 9 * 60 * MIN);
              openEditor({ start: base });
            }}
          >
            <Plus size={15} /> 일정
          </Button>
        </div>
      </div>
      {view === "day" && <WeekStrip selected={selected} onSelect={setSelected} rates={rates} />}
      <Timeline
        days={days}
        tasks={tasks}
        graceMin={settings.graceMin}
        dayStartHour={settings.dayStartHour}
        onCreate={(start) => openEditor({ start })}
        onOpen={(t) => openEditor({ taskId: t.id })}
        onMove={onMove}
        onSelectDay={(d) => {
          setSelected(d);
          setView("day");
        }}
        dayRates={rates}
      />
      <p className="border-t border-line px-4 py-2 text-[11px] text-faint">
        빈 곳을 눌러 추가 · 블록을 끌어 이동(모바일은 길게 눌러서) · 아래 끝을 끌어 길이 조절
      </p>
    </Card>
  );
}
