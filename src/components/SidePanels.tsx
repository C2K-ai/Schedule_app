"use client";

import { Check, CircleDashed, Flame, ListChecks, NotebookPen, Play, Plus, Repeat, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import {
  completeTask,
  habitStreak,
  recentLogs,
  startTask,
  taskState,
  tasksOnDay,
  type TaskState,
} from "@/lib/planner";
import { addDays, DAY, dayKey, fmtTime, startOfDay, WEEKDAYS } from "@/lib/time";
import { COLOR_HEX } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";
import { Card, cx, Empty } from "./ui";

const STATE_LABEL: Record<TaskState, { text: string; cls: string }> = {
  upcoming: { text: "예정", cls: "text-muted" },
  soon: { text: "곧", cls: "text-accent-text" },
  late: { text: "시작 전", cls: "text-warn" },
  overdue: { text: "미시작", cls: "text-danger" },
  in_progress: { text: "진행 중", cls: "text-accent-text" },
  done: { text: "완료", cls: "text-ok" },
  skipped: { text: "건너뜀", cls: "text-faint" },
  missed: { text: "놓침", cls: "text-danger" },
};

function PanelTitle({ icon, children, action }: { icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-2">
      <span className="text-muted">{icon}</span>
      <h3 className="text-sm font-bold">{children}</h3>
      <div className="ml-auto">{action}</div>
    </div>
  );
}

export function Agenda({ day }: { day: Date }) {
  const { tasks, settings, store, openEditor, toast } = usePlanner();
  const now = useNow(15_000);
  const list = tasksOnDay(tasks, day);
  return (
    <Card>
      <PanelTitle
        icon={<ListChecks size={16} />}
        action={
          <button onClick={() => openEditor({})} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="추가">
            <Plus size={16} />
          </button>
        }
      >
        {sameDayLabel(day)} 할 일 <span className="font-mono text-muted tabular-nums">{list.length}</span>
      </PanelTitle>
      {list.length === 0 ? (
        <Empty icon={<CircleDashed size={22} />} title="비어 있어요" desc="타임라인 빈 곳을 누르거나 + 로 추가하세요." />
      ) : (
        <ul className="px-2 pb-2">
          {list.map((t) => {
            const st = taskState(t, now, settings.graceMin);
            const lab = STATE_LABEL[st];
            const closed = st === "done" || st === "skipped" || st === "missed";
            return (
              <li key={t.id} className="group flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-surface-2">
                <button
                  aria-label={closed ? "완료됨" : "완료"}
                  onClick={() => {
                    if (closed) return;
                    completeTask(store, t.id);
                    toast({ text: `✓ ${t.title}`, tone: "ok" });
                  }}
                  className={cx(
                    "grid size-6 shrink-0 place-items-center rounded-lg border-2 transition",
                    st === "done" ? "border-ok bg-ok text-white" : st === "overdue" ? "border-danger" : "border-line-strong hover:border-accent",
                  )}
                >
                  {st === "done" && <Check size={14} strokeWidth={3} />}
                  {st === "overdue" && <TriangleAlert size={12} className="text-danger" />}
                </button>
                <button onClick={() => openEditor({ taskId: t.id })} className="min-w-0 flex-1 text-left">
                  <p className={cx("truncate text-sm font-semibold", closed && "text-muted line-through")}>
                    {t.habit_id && <Repeat size={11} className="mr-1 inline text-muted" />}
                    {t.title}
                  </p>
                  <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted tabular-nums">
                    <span className="size-1.5 rounded-full" style={{ background: COLOR_HEX[t.color] }} />
                    {fmtTime(t.starts_at)}–{fmtTime(t.ends_at)}
                    <span className={cx("font-sans font-bold", lab.cls)}>{lab.text}</span>
                    {t.postpone_count > 0 && <span className="font-sans text-warn">· {t.postpone_count}회 미룸</span>}
                  </p>
                </button>
                {t.status === "planned" && (
                  <button
                    onClick={() => startTask(store, t.id)}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-muted opacity-100 hover:bg-accent hover:text-accent-fg md:opacity-0 md:group-hover:opacity-100"
                    aria-label="시작"
                  >
                    <Play size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function sameDayLabel(d: Date) {
  const t = startOfDay(new Date());
  const diff = Math.round((startOfDay(d).getTime() - t.getTime()) / DAY);
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff === -1) return "어제";
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

export function HabitMini() {
  const { habits, tasks, store, openSheet, toast } = usePlanner();
  const today = startOfDay(new Date());
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const byKey = useMemo(() => {
    const m = new Map<string, (typeof tasks)[number]>();
    for (const t of tasks) if (t.habit_id && t.occurrence_date) m.set(`${t.habit_id}:${t.occurrence_date}`, t);
    return m;
  }, [tasks]);
  const active = habits.filter((h) => h.active);

  return (
    <Card>
      <PanelTitle
        icon={<Repeat size={16} />}
        action={
          <button onClick={() => openSheet("habits")} className="text-xs font-semibold text-muted hover:text-fg">
            관리
          </button>
        }
      >
        습관
      </PanelTitle>
      {active.length === 0 ? (
        <Empty
          icon={<Flame size={22} />}
          title="아직 습관이 없어요"
          desc="매주 반복할 일을 습관으로 만들면 자동으로 일정이 생기고 연속 기록이 쌓입니다."
          action={
            <button onClick={() => openSheet("habits")} className="text-sm font-bold text-accent-text">
              + 습관 만들기
            </button>
          }
        />
      ) : (
        <ul className="space-y-1 px-2 pb-3">
          {active.map((h) => {
            const streak = habitStreak(h, tasks, today);
            const todayTask = byKey.get(`${h.id}:${dayKey(today)}`);
            return (
              <li key={h.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
                <button
                  disabled={!todayTask || todayTask.status === "done"}
                  onClick={() => {
                    if (!todayTask) return;
                    completeTask(store, todayTask.id);
                    toast({ text: `🔥 ${h.title} — ${streak + 1}일 연속!`, tone: "ok" });
                  }}
                  className={cx(
                    "grid size-9 shrink-0 place-items-center rounded-xl text-sm transition",
                    todayTask?.status === "done"
                      ? "bg-accent text-accent-fg"
                      : todayTask
                        ? "border-2 border-dashed border-line-strong text-muted hover:border-accent"
                        : "bg-surface-2 text-faint",
                  )}
                  aria-label="오늘 완료"
                >
                  {todayTask?.status === "done" ? <Check size={16} strokeWidth={3} /> : todayTask ? "" : "–"}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{h.title}</p>
                  <div className="mt-1 flex gap-1">
                    {last7.map((d) => {
                      const t = byKey.get(`${h.id}:${dayKey(d)}`);
                      const scheduled = h.days.includes(d.getDay());
                      return (
                        <span
                          key={dayKey(d)}
                          title={`${d.getMonth() + 1}/${d.getDate()}`}
                          className={cx(
                            "h-1.5 w-4 rounded-full",
                            !scheduled
                              ? "bg-transparent"
                              : t?.status === "done"
                                ? "bg-accent"
                                : t && (t.status === "missed" || t.status === "skipped")
                                  ? "bg-danger"
                                  : "bg-surface-3",
                          )}
                        />
                      );
                    })}
                  </div>
                </div>
                <span className={cx("flex items-center gap-0.5 font-mono text-sm font-bold tabular-nums", streak ? "text-warn" : "text-faint")}>
                  <Flame size={14} /> {streak}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const KIND_TEXT = {
  postponed: { text: "미룸", cls: "bg-warn/15 text-warn" },
  skipped: { text: "건너뜀", cls: "bg-surface-3 text-muted" },
  missed: { text: "놓침", cls: "bg-danger-soft text-danger" },
  focus_abandoned: { text: "집중 중단", cls: "bg-danger-soft text-danger" },
} as const;

export function ReasonFeed() {
  const { snap, openSheet } = usePlanner();
  const now = useNow(60_000);
  const logs = recentLogs(snap.db, now - 7 * DAY)
    .filter((l) => l.reason && l.kind in KIND_TEXT)
    .slice(0, 5);
  return (
    <Card>
      <PanelTitle
        icon={<NotebookPen size={16} />}
        action={
          <button onClick={() => openSheet("log")} className="text-xs font-semibold text-muted hover:text-fg">
            전체
          </button>
        }
      >
        변명 노트 <span className="text-xs font-normal text-muted">최근 7일</span>
      </PanelTitle>
      {logs.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">아직 미룬 기록이 없어요. 계속 이렇게.</p>
      ) : (
        <ul className="space-y-2 px-4 pb-4">
          {logs.map((l) => {
            const k = KIND_TEXT[l.kind as keyof typeof KIND_TEXT];
            return (
              <li key={l.id} className="rounded-xl bg-surface-2 px-3 py-2">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={cx("rounded px-1.5 py-px font-bold", k.cls)}>{k.text}</span>
                  <span className="truncate font-semibold text-fg">{l.title}</span>
                  <span className="ml-auto shrink-0 font-mono text-faint tabular-nums">
                    {new Date(l.created_at).getMonth() + 1}/{new Date(l.created_at).getDate()} {fmtTime(l.created_at)}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-snug">“{l.reason}”</p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
