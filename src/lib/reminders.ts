import { fmtSpan, fmtTime, MIN } from "./time";
import type { AlarmKind, Settings, Task } from "./types";

/**
 * 알림 시점 계산 — 서버(send-due-notifications)와 같은 규칙.
 *  before  : 시작 N분 전 (reminder_offsets 의 0보다 큰 값)
 *  start   : 정각 (offset 0)
 *  overdue : 강제 모드에서 유예 시간 뒤 + 10분 뒤 + 25분 뒤 (세 번, 점점 세게)
 *  end     : 진행 중인 일정의 끝 시각 (앱 전용)
 *  snooze  : "5분 뒤 다시" 로 미뤄 둔 알림
 */
export const OVERDUE_STEPS = [0, 10, 25];
export const STALE_AFTER = 15 * MIN;

export interface Trigger {
  key: string;
  tag: string;
  kind: AlarmKind;
  seq: number;
  fireAt: number;
  task: Task;
}

export interface Snooze {
  taskId: string;
  fireAt: number;
}

export function triggerTag(taskId: string, kind: AlarmKind, seq: number) {
  // 서버 푸시와 같은 tag → 같은 알림이 두 번 쌓이지 않고 교체된다
  return `must-${taskId}-${kind}-${seq}`;
}

export function computeTriggers(tasks: Task[], settings: Settings, snoozes: Snooze[]): Trigger[] {
  const out: Trigger[] = [];
  const mk = (task: Task, kind: AlarmKind, seq: number, fireAt: number) =>
    out.push({
      key: `${task.id}:${kind}:${seq}:${task.starts_at}`,
      tag: triggerTag(task.id, kind, seq),
      kind,
      seq,
      fireAt,
      task,
    });

  for (const t of tasks) {
    if (t.deleted_at) continue;
    const start = Date.parse(t.starts_at);
    if (t.status === "planned") {
      const created = Date.parse(t.created_at);
      for (const off of t.reminder_offsets) {
        const at = start - off * MIN;
        if (at >= created - MIN) mk(t, off > 0 ? "before" : "start", off, at);
      }
      if (t.strict) {
        OVERDUE_STEPS.forEach((extra, i) => {
          const at = start + (settings.graceMin + extra) * MIN;
          if (i === 0 || at < Date.parse(t.ends_at) + 30 * MIN) mk(t, "overdue", i + 1, at);
        });
      }
    }
    if (t.status === "in_progress") mk(t, "end", 0, Date.parse(t.ends_at));
  }
  for (const s of snoozes) {
    const t = tasks.find((x) => x.id === s.taskId);
    if (t && t.status === "planned") mk(t, "snooze", s.fireAt, s.fireAt);
  }
  return out;
}

export function dueTriggers(all: Trigger[], now: number, fired: Record<string, number>): Trigger[] {
  return all
    .filter((tr) => tr.fireAt <= now && now - tr.fireAt < STALE_AFTER && !fired[tr.key])
    .sort((a, b) => a.fireAt - b.fireAt);
}

export function describeTrigger(tr: { kind: AlarmKind; seq: number; task: Task }, now = Date.now()) {
  const { task: t, kind, seq } = tr;
  const range = `${fmtTime(t.starts_at)}–${fmtTime(t.ends_at)}`;
  switch (kind) {
    case "before": {
      const left = Math.round((Date.parse(t.starts_at) - now) / MIN);
      const when = left >= 1 ? `${left}분 뒤 시작` : "곧 시작";
      return { title: `⏰ ${when} · ${t.title}`, body: `${range} · 지금 정리하고 준비하세요` };
    }
    case "start":
      return { title: `▶ 지금 시작: ${t.title}`, body: `${range} · 미루지 말고 바로 시작` };
    case "snooze":
      return { title: `🔁 다시 알림: ${t.title}`, body: `${range} · 아직 시작 전입니다` };
    case "overdue": {
      const late = fmtSpan(now - Date.parse(t.starts_at));
      const tone =
        seq >= 3 ? "더 미루면 기록에 '놓침'으로 남습니다." : seq === 2 ? "지금이라도 시작하세요." : "시작하거나 사유를 남기세요.";
      return { title: `⚠ 시작 안 함 (${late} 지남) · ${t.title}`, body: `${range} · ${tone}` };
    }
    case "end":
      return { title: `🏁 끝날 시간: ${t.title}`, body: `${range} · 완료했나요?` };
    case "focus":
      return { title: "집중 세션 종료", body: t.title };
  }
}

const FIRED_KEY = "must:fired";
const SNOOZE_KEY = "must:snoozes";

export function readFired(): Record<string, number> {
  try {
    return { ...firedMem, ...JSON.parse(localStorage.getItem(FIRED_KEY) ?? "{}") };
  } catch {
    return { ...firedMem };
  }
}

// 저장소가 막힌 환경에서도 같은 탭 안에서는 중복으로 울리지 않게 메모리에도 둔다
const firedMem: Record<string, number> = {};

export function markFired(key: string) {
  firedMem[key] = Date.now();
  try {
    const all = readFired();
    const cutoff = Date.now() - 3 * 24 * 60 * MIN;
    for (const k of Object.keys(all)) if (all[k] < cutoff) delete all[k];
    all[key] = Date.now();
    localStorage.setItem(FIRED_KEY, JSON.stringify(all));
  } catch {
    /* 메모리 기록으로 대신 */
  }
}

export function readSnoozes(): Snooze[] {
  try {
    return (JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? "[]") as Snooze[]).filter(
      (s) => s.fireAt > Date.now() - STALE_AFTER,
    );
  } catch {
    return [];
  }
}

export function addSnooze(taskId: string, minutes = 5) {
  const list = readSnoozes().filter((s) => s.taskId !== taskId);
  list.push({ taskId, fireAt: Date.now() + minutes * MIN });
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(list));
  } catch {
    /* 저장 불가 환경 */
  }
}

export function soundForKind(kind: AlarmKind, task: Task | null, s: Settings): string {
  if (task?.sound_id && kind !== "overdue") return task.sound_id;
  if (kind === "before") return s.sounds.before;
  if (kind === "overdue") return s.sounds.overdue;
  if (kind === "focus") return s.sounds.focus;
  return s.sounds.start;
}
