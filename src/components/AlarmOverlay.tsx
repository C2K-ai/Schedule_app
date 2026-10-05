"use client";

import { AlarmClock, Play, TriangleAlert, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { activeFocus, startFocus, startTask } from "@/lib/planner";
import { addSnooze } from "@/lib/reminders";
import { findSound, playSound, stopAllSounds } from "@/lib/sound";
import { fmtTime } from "@/lib/time";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";
import { cx } from "./ui";

const KIND_LABEL = {
  before: "곧 시작",
  start: "지금 시작할 시간",
  snooze: "다시 알림",
  overdue: "시작하지 않았습니다",
  end: "끝날 시간",
  focus: "집중 타이머",
} as const;

/** 전체화면 알람 — 앱이 열려 있을 때 정각/미시작 시점에 뜬다. 자체 사운드가 반복되며 점점 커진다. */
export function AlarmOverlay() {
  const { alarm, dismissAlarm, settings, store, toast, snap } = usePlanner();
  const now = useNow(1000);
  const [muted, setMuted] = useState(false);
  const alarmKey = alarm?.key;

  useEffect(() => {
    if (!alarm) return;
    setMuted(false);
    const sound = findSound(alarm.soundId, settings.customSounds);
    const h = playSound(sound, {
      loop: true,
      escalate: settings.escalate || alarm.kind === "overdue",
      volume: settings.volume,
      maxSeconds: alarm.kind === "focus" ? 12 : 90,
    });
    return () => h.stop();
    // 같은 알람이 이어지는 동안 설정 변경으로 다시 울리지 않게 key 기준
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarmKey]);

  if (!alarm) return null;
  const task = alarm.taskId ? store.db.tasks[alarm.taskId] : null;
  const overdue = alarm.kind === "overdue";
  const theme = overdue && settings.alarmTheme !== "calm" ? (settings.alarmTheme === "strobe" ? "strobe" : "danger") : settings.alarmTheme;
  const ringColor = overdue ? "#ff3d5a" : "#c8ff2e";
  const focus = activeFocus(snap.db);

  const close = () => {
    stopAllSounds();
    dismissAlarm();
  };

  return (
    <div
      className={cx(
        "fixed inset-0 z-[70] flex flex-col items-center justify-center overflow-hidden px-6 text-white",
        theme === "strobe" ? "strobe" : "bg-[#07080b]",
      )}
      role="alertdialog"
      aria-live="assertive"
    >
      {/* 배경 연출 */}
      {theme === "calm" ? (
        <div className="breathe absolute size-[120vmin] rounded-full bg-[radial-gradient(circle,rgba(200,255,46,0.18),transparent_60%)]" />
      ) : (
        theme !== "strobe" &&
        [0, 0.8, 1.6].map((d) => (
          <span
            key={d}
            className="ring-wave absolute size-[44vmin] rounded-full border-[3px]"
            style={{ borderColor: ringColor, animationDelay: `${d}s` }}
          />
        ))
      )}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(60% 50% at 50% 40%, ${overdue ? "rgba(255,61,90,0.22)" : "rgba(200,255,46,0.12)"}, transparent 70%)`,
        }}
      />

      <div className="relative z-10 flex w-full max-w-lg flex-col items-center text-center">
        <p className="font-mono text-6xl font-bold tracking-tighter tabular-nums md:text-7xl">{fmtTime(new Date(now || Date.now()))}</p>
        <span
          className={cx(
            "mt-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold",
            overdue ? "bg-[#ff3d5a] text-white" : "bg-[#c8ff2e] text-[#0b0c10]",
          )}
        >
          {overdue ? <TriangleAlert size={16} /> : <AlarmClock size={16} />}
          {KIND_LABEL[alarm.kind]}
        </span>
        <h2 className="mt-4 text-3xl leading-tight font-black tracking-tight md:text-4xl">
          {task?.title ?? alarm.title}
        </h2>
        <p className="mt-2 text-base text-white/70">{alarm.body}</p>

        <div className="mt-10 grid w-full gap-3">
          {task && task.status === "planned" && alarm.kind !== "end" && (
            <button
              onClick={() => {
                startTask(store, task.id);
                toast({ text: "▶ 시작! 지금부터입니다", tone: "ok" });
                close();
              }}
              className={cx(
                "flex h-16 items-center justify-center gap-2 rounded-2xl text-lg font-black transition active:scale-[0.98]",
                overdue ? "bg-[#ff3d5a] text-white" : "bg-[#c8ff2e] text-[#0b0c10]",
              )}
            >
              <Play size={22} /> 지금 시작
            </button>
          )}
          <div className="grid grid-cols-2 gap-3">
            {task && (alarm.kind === "start" || alarm.kind === "snooze") && (
              <button
                onClick={() => {
                  addSnooze(task.id, 5);
                  toast({ text: "⏱ 5분 뒤 다시 울립니다" });
                  close();
                }}
                className="h-12 rounded-2xl bg-white/10 font-bold hover:bg-white/15"
              >
                5분 뒤 다시
              </button>
            )}
            {overdue && (
              <button onClick={close} className="h-12 rounded-2xl bg-white/10 font-bold hover:bg-white/15">
                사유 쓰고 미루기
              </button>
            )}
            {alarm.kind === "focus" && focus?.mode === "break" && (
              <button
                onClick={() => {
                  startFocus(store, settings, { taskId: focus.task_id, cycle: focus.cycle + 1 });
                  close();
                }}
                className="h-12 rounded-2xl bg-white/10 font-bold hover:bg-white/15"
              >
                휴식 건너뛰고 집중
              </button>
            )}
            {(alarm.kind === "focus" || alarm.kind === "before" || alarm.kind === "end" || !task) && (
              <button onClick={close} className="h-12 rounded-2xl bg-white/10 font-bold hover:bg-white/15">
                확인
              </button>
            )}
            <button
              onClick={() => {
                stopAllSounds();
                setMuted(true);
              }}
              disabled={muted}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/5 font-semibold text-white/70 hover:bg-white/10 disabled:opacity-40"
            >
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />} {muted ? "소리 끔" : "소리만 끄기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
