"use client";

import { BellOff, Brain, Coffee, Maximize2, Minimize2, Pause, Play, Square, X, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { requestWakeLock } from "@/lib/notify";
import {
  abandonFocus,
  activeFocus,
  focusRemaining,
  pauseFocus,
  resumeFocus,
  startFocus,
  tasksOnDay,
} from "@/lib/planner";
import { fmtCountdown, MIN, startOfDay } from "@/lib/time";
import { COLOR_HEX } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { ReasonForm } from "./Enforcement";
import { usePlanner } from "./PlannerProvider";
import { Button, cx, Modal, ProgressRing } from "./ui";

function useFocus() {
  const p = usePlanner();
  const now = useNow(1000);
  const f = activeFocus(p.snap.db);
  const remaining = f ? focusRemaining(f, now) : 0;
  const total = f ? Date.parse(f.planned_end) - Date.parse(f.started_at) : p.settings.focusMin * MIN;
  const task = f?.task_id ? (p.store.db.tasks[f.task_id] ?? null) : null;
  return { ...p, f, remaining, total, task, now };
}

function AbandonDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { store, settings, snap, toast } = usePlanner();
  const [reason, setReason] = useState("");
  const [shake, setShake] = useState(0);
  const f = activeFocus(snap.db);
  if (!open || !f) return null;
  const isBreak = f.mode === "break";
  return (
    <Modal
      open
      onClose={onClose}
      title={isBreak ? "휴식을 끝낼까요?" : "집중을 중단할까요?"}
      subtitle={isBreak ? undefined : "중간에 그만두는 것도 기록에 남습니다. 이유를 적어 주세요."}
      size="sm"
    >
      {!isBreak && (
        <ReasonForm
          value={reason}
          onChange={setReason}
          minLength={Math.min(settings.reasonMinLength, 6)}
          placeholder="무엇이 집중을 깨뜨렸나요?"
          shake={shake}
        />
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="ghost" onClick={onClose}>
          계속하기
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          onClick={() => {
            if (!isBreak && reason.trim().length < Math.min(settings.reasonMinLength, 6)) return setShake((n) => n + 1);
            abandonFocus(store, f.id, isBreak ? "휴식 종료" : reason.trim());
            if (!isBreak) toast({ text: "집중 중단 — 사유 기록됨", tone: "danger" });
            setReason("");
            onClose();
          }}
        >
          {isBreak ? "휴식 끝내기" : "중단하기"}
        </Button>
      </div>
    </Modal>
  );
}

export function FocusDock() {
  const { f, remaining, total, task, store, settings, setFocusScreen } = useFocus();
  const [abandon, setAbandon] = useState(false);
  const pct = f ? 1 - remaining / total : 0;
  const isBreak = f?.mode === "break";
  if (!f) return null;

  return (
    <>
      <div className="pointer-events-none fixed right-[84px] bottom-[calc(72px+env(safe-area-inset-bottom))] left-0 z-30 md:right-0 md:bottom-0 md:left-[264px]">
        <div className="mx-auto max-w-[1200px] px-3 md:px-8 md:pb-3">
          <div className="pointer-events-auto relative overflow-hidden rounded-2xl border border-line bg-[color-mix(in_oklab,var(--surface)_88%,transparent)] shadow-card backdrop-blur-xl">
            {f && (
              <div className="absolute inset-x-0 top-0 h-[3px] bg-surface-3">
                <div
                  className={cx("h-full transition-[width] duration-1000", isBreak ? "bg-ok" : "bg-accent")}
                  style={{ width: `${pct * 100}%` }}
                />
              </div>
            )}
            <div className="flex items-center gap-3 p-2.5 pl-4">
              <div
                className={cx(
                  "grid size-9 shrink-0 place-items-center rounded-xl",
                  f ? (isBreak ? "bg-ok/15 text-ok" : "bg-accent text-accent-fg") : "bg-surface-2 text-muted",
                )}
              >
                {isBreak ? <Coffee size={18} /> : <Brain size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-muted uppercase">
                  {f ? (isBreak ? "휴식" : `집중 ${f.cycle}회차`) : "집중 모드"}
                  {f && !isBreak && (
                    <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-px text-[10px] text-muted normal-case">
                      <BellOff size={10} /> 방해금지
                    </span>
                  )}
                  {f?.paused_at && <span className="text-warn">일시정지</span>}
                </p>
                <p className="truncate text-sm font-semibold">
                  {f ? (task?.title ?? (isBreak ? "숨 돌리기" : "자유 집중")) : `${settings.focusMin}분 집중 · ${settings.breakMin}분 휴식`}
                </p>
              </div>
              {f && (
                <p className="font-mono text-2xl font-bold tracking-tight tabular-nums md:text-3xl">
                  {fmtCountdown(remaining)}
                </p>
              )}
              <div className="flex shrink-0 items-center gap-1">
                {!f ? (
                  <Button variant="primary" size="sm" onClick={() => startFocus(store, settings, {})}>
                    <Play size={14} /> 시작
                  </Button>
                ) : f.paused_at ? (
                  <Button variant="primary" size="sm" onClick={() => resumeFocus(store, f.id)}>
                    <Play size={14} /> 재개
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => pauseFocus(store, f.id)} aria-label="일시정지">
                    <Pause size={14} />
                  </Button>
                )}
                {f && (
                  <Button size="sm" variant="ghost" onClick={() => setAbandon(true)} aria-label="중단">
                    <Square size={14} />
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setFocusScreen(true)} aria-label="전체화면 집중">
                  <Maximize2 size={14} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <AbandonDialog open={abandon} onClose={() => setAbandon(false)} />
    </>
  );
}

export function FocusScreen() {
  const { f, remaining, total, task, store, settings, tasks, focusScreen, setFocusScreen } = useFocus();
  const [abandon, setAbandon] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [wake, setWake] = useState(false);
  const [full, setFull] = useState(false);

  const todays = useMemo(
    () =>
      tasksOnDay(tasks, startOfDay(new Date())).filter((t) => t.status === "planned" || t.status === "in_progress"),
    [tasks],
  );

  // 집중 화면이 열려 있는 동안 화면 꺼짐 방지
  useEffect(() => {
    if (!focusScreen) return;
    let lock: { release: () => Promise<void> } | null = null;
    let alive = true;
    const acquire = async () => {
      lock = await requestWakeLock();
      if (alive) setWake(Boolean(lock));
    };
    void acquire();
    const onVis = () => document.visibilityState === "visible" && void acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
      setWake(false);
    };
  }, [focusScreen]);

  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  if (!focusScreen) return null;
  const isBreak = f?.mode === "break";
  const color = isBreak ? "var(--ok)" : task ? COLOR_HEX[task.color] : "var(--accent)";
  const pct = f ? 1 - remaining / total : 0;
  const defaultTask = pick ?? todays.find((t) => t.status === "in_progress")?.id ?? todays[0]?.id ?? null;

  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-bg">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(50% 45% at 50% 42%, color-mix(in oklab, ${color} 16%, transparent), transparent 70%)` }}
      />
      <header className="safe-top relative flex items-center justify-between px-4 py-3 md:px-6">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted">
          <span className={cx("inline-flex items-center gap-1 rounded-lg px-2 py-1", f && !isBreak ? "bg-accent text-accent-fg" : "bg-surface-2")}>
            <BellOff size={12} /> {f && !isBreak ? "방해금지 켜짐" : "방해금지 대기"}
          </span>
          <span className="rounded-lg bg-surface-2 px-2 py-1">{wake ? "화면 꺼짐 방지 ✓" : "화면 꺼짐 방지 안 됨"}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="grid size-10 place-items-center rounded-xl text-muted hover:bg-surface-2"
            aria-label="전체화면"
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}
          >
            {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button
            className="grid size-10 place-items-center rounded-xl text-muted hover:bg-surface-2"
            aria-label="닫기"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              setFocusScreen(false);
            }}
          >
            <X size={20} />
          </button>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-10">
        <ProgressRing value={pct} size={Math.min(340, typeof window !== "undefined" ? window.innerWidth - 64 : 300)} stroke={14} color={color}>
          <div className="text-center">
            <p className="text-sm font-bold tracking-widest text-muted uppercase">
              {f ? (isBreak ? "휴식" : `집중 ${f.cycle}회차`) : "준비"}
            </p>
            <p className="mt-1 font-mono text-6xl font-bold tracking-tighter tabular-nums md:text-7xl">
              {f ? fmtCountdown(remaining) : fmtCountdown((minutes ?? settings.focusMin) * MIN)}
            </p>
            <p className="mt-2 max-w-[220px] truncate text-sm font-semibold text-muted">
              {f ? (task?.title ?? (isBreak ? "물 한 잔, 스트레칭" : "자유 집중")) : "무엇에 집중할까요?"}
            </p>
          </div>
        </ProgressRing>

        {f && (
          <div className="flex gap-1.5">
            {Array.from({ length: settings.cyclesPerLong }, (_, i) => (
              <span
                key={i}
                className={cx(
                  "h-2 w-8 rounded-full",
                  i < ((f.cycle - 1) % settings.cyclesPerLong) + (isBreak ? 1 : 0) ? "bg-accent" : "bg-surface-3",
                )}
              />
            ))}
          </div>
        )}

        {!f ? (
          <div className="w-full max-w-md space-y-4">
            <div className="flex flex-wrap justify-center gap-1.5">
              {[15, 25, 45, 50, 90].map((m) => (
                <button
                  key={m}
                  onClick={() => setMinutes(m)}
                  className={cx(
                    "h-9 rounded-xl px-3 text-sm font-semibold",
                    (minutes ?? settings.focusMin) === m ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
                  )}
                >
                  {m}분
                </button>
              ))}
            </div>
            {todays.length > 0 && (
              <select
                value={defaultTask ?? ""}
                onChange={(e) => setPick(e.target.value || null)}
                className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm"
              >
                <option value="">일정 없이 자유 집중</option>
                {todays.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            )}
            <Button
              variant="primary"
              size="lg"
              className="h-14 w-full text-base"
              onClick={() => startFocus(store, settings, { taskId: defaultTask, minutes: minutes ?? undefined })}
            >
              <Zap size={18} /> 집중 시작
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {f.paused_at ? (
              <Button variant="primary" size="lg" className="h-14 px-8" onClick={() => resumeFocus(store, f.id)}>
                <Play size={20} /> 재개
              </Button>
            ) : (
              <Button size="lg" className="h-14 px-8" onClick={() => pauseFocus(store, f.id)}>
                <Pause size={20} /> 일시정지
              </Button>
            )}
            <Button variant="dangerSoft" size="lg" className="h-14" onClick={() => setAbandon(true)}>
              <Square size={18} /> {isBreak ? "휴식 끝" : "중단"}
            </Button>
          </div>
        )}
        <p className="text-xs text-faint">집중 중엔 ‘곧 시작’ 알림이 조용해지고, 정각·미시작 경고만 울립니다.</p>
      </main>
      <AbandonDialog open={abandon} onClose={() => setAbandon(false)} />
    </div>
  );
}
