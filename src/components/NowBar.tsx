"use client";

import { Check, Flame, Play, Plus, Target, TriangleAlert, Zap } from "lucide-react";
import { useMemo } from "react";
import {
  completeTask,
  currentTask,
  dayStats,
  enforcementQueue,
  nextTask,
  recentLogs,
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

function NowCard() {
  const { store, tasks, settings, setFocusScreen, openEditor, toast } = usePlanner();
  const now = useNow(1000);
  const cur = currentTask(tasks, now);

  if (!cur) {
    const nx = nextTask(tasks, now);
    return (
      <Card className="flex flex-col justify-between gap-4 p-5 md:p-6">
        <div>
          <p className="text-xs font-bold tracking-widest text-faint uppercase">지금</p>
          <p className="mt-2 text-2xl font-bold tracking-tight">비어 있는 시간</p>
          <p className="mt-1 text-sm text-muted">
            {nx ? `다음 일정 전까지 ${fmtSpan(Date.parse(nx.starts_at) - now)} 남았어요.` : "오늘 남은 일정이 없어요."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              const s = new Date(Math.ceil(now / (5 * MIN)) * 5 * MIN);
              openEditor({ start: s, end: new Date(s.getTime() + 30 * MIN) });
            }}
          >
            <Plus size={16} /> 지금 할 일 추가
          </Button>
          <Button onClick={() => setFocusScreen(true)}>
            <Target size={16} /> 그냥 집중
          </Button>
        </div>
      </Card>
    );
  }

  const st = taskState(cur, now, settings.graceMin);
  const start = Date.parse(cur.starts_at);
  const end = Date.parse(cur.ends_at);
  const color = COLOR_HEX[cur.color];
  const running = cur.status === "in_progress";
  const pct = Math.max(0, Math.min(1, (now - start) / (end - start)));
  const late = st === "late" || st === "overdue";

  return (
    <Card
      className={cx(
        "relative flex flex-col justify-between gap-4 overflow-hidden p-5 md:p-6",
        late && "border-danger/70 overdue-pulse",
      )}
    >
      <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: late ? "var(--danger)" : color }} />
      <div>
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold tracking-widest text-faint uppercase">{running ? "진행 중" : "지금 할 일"}</p>
          {late && (
            <span className="rounded-md bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger">
              시작 안 함 · {fmtSpan(now - start)} 지남
            </span>
          )}
          {cur.postpone_count > 0 && (
            <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-warn">
              {cur.postpone_count}번 미룸
            </span>
          )}
        </div>
        <p className="mt-2 line-clamp-2 text-2xl font-bold tracking-tight md:text-[26px]">{cur.title}</p>
        <p className="mt-1 font-mono text-sm text-muted tabular-nums">
          {fmtTime(cur.starts_at)} – {fmtTime(cur.ends_at)}
          {running && <span className="ml-2">· 끝까지 {fmtSpan(Math.max(0, end - now))}</span>}
        </p>
        {running && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full transition-[width] duration-1000"
              style={{ width: `${pct * 100}%`, background: color }}
            />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {running ? (
          <>
            <Button
              variant="primary"
              onClick={() => {
                completeTask(store, cur.id);
                toast({ text: `✓ 완료: ${cur.title}`, tone: "ok" });
              }}
            >
              <Check size={16} /> 완료
            </Button>
            <Button onClick={() => setFocusScreen(true)}>
              <Zap size={16} /> 집중 모드
            </Button>
          </>
        ) : (
          <Button
            variant={late ? "danger" : "primary"}
            size="lg"
            onClick={() => {
              startTask(store, cur.id);
              toast({ text: "▶ 시작! 지금부터 카운트합니다", tone: "ok" });
            }}
          >
            <Play size={18} /> 지금 시작
          </Button>
        )}
      </div>
    </Card>
  );
}

function NextCard() {
  const { tasks } = usePlanner();
  const now = useNow(1000);
  const nx = nextTask(tasks, now);
  if (!nx) {
    return (
      <Card className="flex flex-col justify-between p-5 md:p-6">
        <p className="text-xs font-bold tracking-widest text-faint uppercase">다음 일정까지</p>
        <p className="mt-3 font-mono text-5xl font-bold tracking-tight text-faint tabular-nums">--:--</p>
        <p className="mt-2 text-sm text-muted">남은 일정이 없어요. 내일을 미리 짜 두세요.</p>
      </Card>
    );
  }
  const ms = Date.parse(nx.starts_at) - now;
  const soon = ms <= 10 * MIN;
  return (
    <Card
      className={cx(
        "relative flex flex-col justify-between overflow-hidden p-5 md:p-6",
        soon && "border-accent/60 shadow-[0_0_0_1px_var(--accent),0_0_40px_-10px_var(--accent)]",
      )}
    >
      <p className="text-xs font-bold tracking-widest text-faint uppercase">다음 일정까지</p>
      <p
        className={cx(
          "mt-2 font-mono text-[44px] leading-none font-bold tracking-tighter tabular-nums md:text-[56px]",
          soon && "text-accent-text",
        )}
      >
        {fmtCountdown(ms)}
      </p>
      <div className="mt-3 flex min-w-0 items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: COLOR_HEX[nx.color] }} />
        <p className="truncate font-semibold">{nx.title}</p>
        <span className="ml-auto shrink-0 font-mono text-sm text-muted tabular-nums">{fmtTime(nx.starts_at)}</span>
      </div>
    </Card>
  );
}

function TodayCard() {
  const { tasks, settings, snap } = usePlanner();
  const now = useNow(10_000);
  const today = useMemo(() => startOfDay(new Date(now)), [now]);
  const todays = tasksOnDay(tasks, today);
  const focus = Object.values(snap.db.focus_sessions).filter(
    (f) => !f.deleted_at && Date.parse(f.started_at) >= today.getTime(),
  );
  const s = dayStats(todays, now, settings.graceMin, focus);
  const postponed = recentLogs(snap.db, today.getTime()).filter((l) => l.kind === "postponed").length;
  const ringColor = s.rate >= 80 ? "var(--accent)" : s.rate >= 40 ? "var(--warn)" : "var(--danger)";

  return (
    <Card className="flex items-center gap-5 p-5 md:p-6">
      <ProgressRing value={s.total ? s.done / s.total : 0} size={112} stroke={11} color={s.total ? ringColor : "var(--faint)"}>
        <div className="text-center">
          <p className="font-mono text-[28px] leading-none font-bold tabular-nums">{s.rate}%</p>
          <p className="mt-1 text-[11px] font-semibold text-muted">오늘 달성</p>
        </div>
      </ProgressRing>
      <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Stat label="완료" value={`${s.done}/${s.total}`} />
        <Stat label="남음" value={s.remaining} />
        <Stat label="미룸" value={postponed} warn={postponed > 0} />
        <Stat label="놓침·건너뜀" value={s.missed + s.skipped} danger={s.missed + s.skipped > 0} />
        <div className="col-span-2 mt-1 flex items-center gap-1.5 text-xs text-muted">
          <Flame size={14} className="text-warn" /> 오늘 집중 {s.focusMin}분
        </div>
      </dl>
    </Card>
  );
}

function Stat({ label, value, warn, danger }: { label: string; value: number | string; warn?: boolean; danger?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cx("font-mono text-lg font-bold tabular-nums", warn && "text-warn", danger && "text-danger")}>{value}</dd>
    </div>
  );
}

export function NowBar() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.25fr_1fr_1fr]">
      <NowCard />
      <NextCard />
      <div className="md:col-span-2 xl:col-span-1">
        <TodayCard />
      </div>
    </div>
  );
}
