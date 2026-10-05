"use client";

import { useCallback, useEffect, useRef } from "react";
import { setAppBadge, showSystemNotification, registerServiceWorker } from "@/lib/notify";
import {
  activeFocus,
  completeTask,
  enforcementQueue,
  finishFocus,
  focusRemaining,
  startFocus,
  startTask,
} from "@/lib/planner";
import { refreshPushSubscription } from "@/lib/push";
import {
  addSnooze,
  computeTriggers,
  describeTrigger,
  dueTriggers,
  markFired,
  readFired,
  readSnoozes,
  soundForKind,
  type Trigger,
} from "@/lib/reminders";
import { findSound, playSound, preloadSounds, speak, unlockAudio, vibrate } from "@/lib/sound";
import { getSupabase } from "@/lib/supabase";
import { DAY } from "@/lib/time";
import type { AlarmKind, Task } from "@/lib/types";
import { usePlanner } from "./PlannerProvider";

const PRIORITY: Record<AlarmKind, number> = { overdue: 5, start: 4, snooze: 3, end: 2, before: 1, focus: 0 };

/** 여러 탭이 열려 있어도 한 번만 울리도록 Web Locks 로 감싼다 */
async function once(key: string, fn: () => void) {
  const run = () => {
    if (readFired()[key]) return;
    markFired(key);
    fn();
  };
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks?.request) await locks.request("must-fire", run);
  else run();
}

interface PushPayload {
  kind?: AlarmKind;
  seq?: number;
  taskId?: string;
  startsAt?: string;
  title?: string;
  body?: string;
}

/**
 * 화면 없는 컴포넌트 — 앱 안 알림 엔진.
 * 1초마다 알림 시점을 확인하고, 때가 되면 자체 소리 + 전체화면 알람 + (탭이 가려져 있으면) 시스템 알림.
 * 서버 푸시가 같은 시점에 와도 tag/키가 같아서 한 번만 울린다.
 */
export function ReminderEngine() {
  const p = usePlanner();
  const { session } = p;
  const latest = useRef(p);
  useEffect(() => {
    latest.current = p;
  });

  // 알람 소리 미리 받기 — 울릴 때 네트워크를 기다리지 않게
  const { settings, tasks } = p;
  useEffect(() => {
    const now = Date.now();
    const ids = new Set<string>(Object.values(settings.sounds));
    for (const t of tasks) if (t.sound_id && Math.abs(Date.parse(t.starts_at) - now) < 2 * DAY) ids.add(t.sound_id);
    preloadSounds([...ids].map((id) => findSound(id, settings.customSounds)));
  }, [settings.sounds, settings.customSounds, tasks]);

  // 오디오 잠금 해제 — 첫 터치/클릭 때
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: false, passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const fire = useCallback(
    (kind: AlarmKind, seq: number, task: Task | null, key: string, text?: { title: string; body: string }) => {
      const { settings: s, ring, toast, store: st, snap } = latest.current;
      const desc = text ?? (task ? describeTrigger({ kind, seq, task }) : { title: "MUST", body: "" });
      const soundId = soundForKind(kind, task, s);
      const sound = findSound(soundId, s.customSounds);
      const hidden = document.visibilityState !== "visible";
      const focusOn = Boolean(activeFocus(snap.db));
      const tag = task ? `must-${task.id}-${kind}-${seq}` : key;

      if (hidden) {
        void showSystemNotification({
          title: desc.title,
          body: desc.body,
          tag,
          kind,
          taskId: task?.id,
          startsAt: task?.starts_at,
          vibration: s.vibration,
        });
      }

      if (kind === "before") {
        // 집중 모드(방해금지) 중에는 사전 알림을 조용히
        if (!focusOn) playSound(sound, { volume: s.volume * 0.8 });
        toast({ text: desc.title, ttl: 8000 });
        return;
      }
      if (kind === "end" && task) {
        playSound(findSound(s.sounds.before, s.customSounds), { volume: s.volume * 0.8 });
        toast({
          text: desc.title,
          ttl: 15000,
          action: { label: "완료", onClick: () => completeTask(st, task.id) },
        });
        return;
      }
      vibrate(s.vibration);
      if (kind === "overdue") {
        // 경고창이 이미 떠 있으니 화면은 덮지 않고 소리만 — 사유를 쓰던 중이어도 입력이 날아가지 않는다
        latest.current.ringOverdue({
          key,
          kind,
          seq,
          taskId: task?.id ?? null,
          title: desc.title,
          body: desc.body,
          soundId,
          at: Date.now(),
        });
        if (s.speak && task) window.setTimeout(() => speak(`${task.title}, 아직 시작하지 않았습니다.`, s.volume), 1800);
        return;
      }
      ring({
        key,
        kind,
        seq,
        taskId: task?.id ?? null,
        title: desc.title,
        body: desc.body,
        soundId,
        at: Date.now(),
      });
      if (s.speak && task) {
        const line = kind === "focus" ? desc.title : `${task.title}, 시작할 시간입니다.`;
        window.setTimeout(() => speak(line, s.volume), 1800);
      }
    },
    [],
  );

  // 1초 루프
  useEffect(() => {
    let titleFlip = false;
    const baseTitle = document.title;
    const tick = () => {
      const { tasks: all, settings: s, snap, store: st } = latest.current;
      const now = Date.now();
      const near = all.filter((t) => Math.abs(Date.parse(t.starts_at) - now) < 2 * DAY);
      const triggers = computeTriggers(near, s, readSnoozes());
      const due = dueTriggers(triggers, now, readFired());
      if (due.length) {
        // 앱을 늦게 열어 알림이 여러 개 밀렸으면: 일정마다 가장 최근 것, 그중 가장 급한 것 하나만 울린다.
        // 나머지는 조용히 처리(미시작 일정은 어차피 경고창이 하나씩 보여 준다).
        const latestByTask = new Map<string, Trigger>();
        for (const tr of due) {
          const cur = latestByTask.get(tr.task.id);
          if (!cur || tr.fireAt > cur.fireAt) latestByTask.set(tr.task.id, tr);
        }
        const [primary, ...rest] = [...latestByTask.values()].sort(
          (a, b) => PRIORITY[b.kind] - PRIORITY[a.kind] || b.fireAt - a.fireAt,
        );
        for (const tr of due) if (tr !== primary) markFired(tr.key);
        void once(primary.key, () => fire(primary.kind, primary.seq, primary.task, primary.key));
        if (rest.length) latest.current.toast({ text: `밀린 알림 ${rest.length}건이 더 있어요 — 목록을 확인하세요`, ttl: 6000 });
      }

      // 뽀모도로 종료
      const f = activeFocus(snap.db);
      if (f && !f.paused_at && focusRemaining(f, now) <= 0) {
        void once(`focus:${f.id}`, () => {
          finishFocus(st, f.id);
          const task = f.task_id ? (st.db.tasks[f.task_id] ?? null) : null;
          const isFocus = f.mode === "focus";
          fire("focus", f.cycle, task, `focus:${f.id}`, {
            title: isFocus ? "🎉 집중 완료! 잠깐 쉬세요" : "⏰ 휴식 끝 — 다시 집중할 시간",
            body: task ? task.title : "",
          });
          if (isFocus && s.autoStartBreak) {
            startFocus(st, s, { mode: "break", cycle: f.cycle, taskId: f.task_id });
          }
        });
      }

      // 탭 제목 깜빡임 + 앱 아이콘 배지
      const overdue = enforcementQueue(all, now, s.graceMin).length;
      setAppBadge(overdue);
      if (overdue > 0 && document.visibilityState !== "visible") {
        titleFlip = !titleFlip;
        document.title = titleFlip ? `⚠ 미시작 ${overdue}건 — MUST` : "MUST — 지금 처리하세요";
      } else if (document.title !== baseTitle) {
        document.title = baseTitle;
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      document.title = baseTitle;
    };
  }, [fire]);

  // 서비스 워커 메시지(서버 푸시 도착 / 알림 버튼 클릭)
  const handleAction = useCallback(
    (action: string, taskId: string | null | undefined, handled: boolean) => {
      const { store: st, toast, setFocusScreen, openEditor, dismissAlarm } = latest.current;
      if (handled) {
        void st.pull();
        return;
      }
      if (action === "new") return openEditor({});
      if (action === "focus") return setFocusScreen(true);
      if (!taskId || !st.db.tasks[taskId]) return;
      if (action === "start") {
        startTask(st, taskId);
        dismissAlarm();
        toast({ text: "▶ 시작했습니다. 집중!", tone: "ok" });
      } else if (action === "snooze") {
        addSnooze(taskId, 5);
        dismissAlarm();
        toast({ text: "⏱ 5분 뒤 다시 알려드릴게요" });
      }
    },
    [],
  );

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void registerServiceWorker();
    const onMsg = (e: MessageEvent) => {
      const data = e.data as { type?: string; payload?: PushPayload; action?: string; taskId?: string; handled?: boolean };
      if (data?.type === "must:push" && data.payload) {
        const pl = data.payload;
        const task = pl.taskId ? (latest.current.store.db.tasks[pl.taskId] ?? null) : null;
        const kind = pl.kind ?? "start";
        // 로컬 일정의 starts_at 으로 키를 만든다 — 앱 안 알림과 같은 키라서 둘 다 와도 한 번만 울린다
        const key = task ? `${task.id}:${kind}:${pl.seq ?? 0}:${task.starts_at}` : `push:${pl.title}:${pl.startsAt}`;
        void once(key, () =>
          fire(kind, pl.seq ?? 0, task, key, pl.title ? { title: pl.title, body: pl.body ?? "" } : undefined),
        );
      } else if (data?.type === "must:notification-action") {
        handleAction(data.action ?? "open", data.taskId, Boolean(data.handled));
      } else if (data?.type === "must:resubscribe") {
        const sb = getSupabase();
        const uid = latest.current.session.userId;
        if (sb && uid) void refreshPushSubscription(sb, uid);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [fire, handleAction]);

  // 알림을 눌러 앱이 새로 열린 경우: ?action=start&task=...
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const action = q.get("action");
    if (action) {
      handleAction(action, q.get("task"), false);
      window.history.replaceState(null, "", "/");
    }
  }, [handleAction]);

  // 로그인 상태면 푸시 구독을 매번 갱신
  useEffect(() => {
    const sb = getSupabase();
    if (sb && session.userId) void refreshPushSubscription(sb, session.userId);
  }, [session.userId]);

  return null;
}
