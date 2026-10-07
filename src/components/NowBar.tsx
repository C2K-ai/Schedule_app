"use client";

import { Check, Play, TriangleAlert } from "lucide-react";
import {
  completeTask,
  currentTask,
  dayStats,
  enforcementQueue,
  nextTask,
  startTask,
  taskState,
  tasksOnDay,
} from "@/lib/planner";
import { fmtCountdown, fmtSpan, fmtTime, MIN, startOfDay } from "@/lib/time";
import { COLOR_HEX } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";
import { Button, Card, cx, ProgressRing } from "./ui";

export function OverdueBanner({ onOpen }: { onOpen: () => void }) {
  const { tasks, settings } = usePlanner();
  const now = useNow(5000);
  const q = enforcementQueue(tasks, now, settings.graceMin);
  if (!q.length) return null;
  return (
    <div className="tape fade-up overflow-hidden rounded-2xl p-[3px]">
      <div className="flex flex-wrap items-center gap-3 rounded-[13px] bg-[#16050a] px-4 py-3 text-white">
        <TriangleAlert className="shrink-0 text-[#ff5a73]" size={22} />
        <p className="min-w-0 flex-1 text-sm font-semibold">
          시작 안 한 일정 <b className="text-[#ff5a73]">{q.length}건</b> — 시작하거나, 사유를 남기기 전엔 넘어갈 수
          없습니다.
        </p>
        <button
          onClick={onOpen}
          className="h-9 rounded-xl bg-[#ff3d5a] px-4 text-sm font-bold text-white hover:brightness-110"
        >
          지금 처리
        </button>
      </div>
    </div>
  );
}

/** 작업 탭 맨 위 한 장 — 지금 할 일(있으면 버튼 하나) 또는 다음 일정까지 남은 시간 + 오늘 달성률 */
export function NowStrip() {
  const { store, tasks, settings, toast } = usePlanner();
  const now = useNow(1000);
  const cur = currentTask(tasks, now);
  const nx = nextTask(tasks, now);
  const todays = tasksOnDay(tasks, startOfDay(new Date(now)));
  const s = dayStats(todays, now, settings.graceMin);
  const st = cur ? taskState(cur, now, settings.graceMin) : null;
  const late = st === "late" || st === "overdue";
  const running = cur?.status === "in_progress";
  const ringColor = s.rate >= 80 ? "var(--ok)" : s.rate >= 40 ? "var(--accent)" : "var(--danger)";

  let label: string;
  let title: string;
  let sub: string | null = null;
  if (cur) {
    label = running ? "진행 중" : late ? `시작 안 함 · ${fmtSpan(now - Date.parse(cur.starts_at))} 지남` : "지금 할 일";
    title = cur.title;
    sub = running ? `끝까지 ${fmtSpan(Math.max(0, Date.parse(cur.ends_at) - now))}` : `${fmtTime(cur.starts_at)}–${fmtTime(cur.ends_at)}`;
  } else if (nx) {
    label = "다음 일정";
    title = nx.title;
    sub = fmtTime(nx.starts_at);
  } else {
    label = "지금";
    title = "남은 시간 일정이 없어요";
  }

  return (
    <Card className={cx("relative flex items-center gap-4 overflow-hidden p-4 md:p-5", late && "border-danger/70 overdue-pulse")}>
      {cur && <div className="absolute inset-y-0 left-0 w-1" style={{ background: late ? "var(--danger)" : COLOR_HEX[cur.color] }} />}
      <div className="min-w-0 flex-1">
        <p className={cx("text-xs font-bold", late ? "text-danger" : "text-muted")}>{label}</p>
        <p className="mt-0.5 truncate text-lg font-bold">{title}</p>
        {sub && <p className="font-mono text-sm text-muted tabular-nums">{sub}</p>}
      </div>
      {cur ? (
        running ? (
          <Button
            variant="primary"
            onClick={() => {
              completeTask(store, cur.id);
              toast({ text: `✓ 완료: ${cur.title}`, tone: "ok" });
            }}
          >
            <Check size={16} /> 완료
          </Button>
        ) : (
          <Button
            variant={late ? "danger" : "primary"}
            onClick={() => {
              startTask(store, cur.id);
              toast({ text: "▶ 시작! 지금부터 카운트합니다", tone: "ok" });
            }}
          >
            <Play size={16} /> 시작
          </Button>
        )
      ) : nx ? (
        <p className={cx("font-mono text-2xl font-bold tracking-tight tabular-nums md:text-3xl", Date.parse(nx.starts_at) - now <= 10 * MIN && "text-accent-text")}>
          {fmtCountdown(Date.parse(nx.starts_at) - now)}
        </p>
      ) : null}
      <ProgressRing value={s.total ? s.done / s.total : 0} size={52} stroke={6} color={s.total ? ringColor : "var(--faint)"}>
        <span className="font-mono text-[13px] font-bold tabular-nums">{s.rate}%</span>
      </ProgressRing>
    </Card>
  );
}
