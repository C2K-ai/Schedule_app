"use client";

// 폰 잠금화면 일정 카드 — 소리 없는 알림 한 장(tag "lock-card")에 '지금/다음 일정 + 오늘 남은 것'을 띄워 둔다.
//   웹앱은 잠금화면에 위젯을 둘 수 없어서 알림으로 대신한다. 카드가 바뀌는 시점(일정 시작·끝, 자정)마다의 내용을
//   앱이 미리 계산해 서비스 워커에 넘기면, 서비스 워커는 앱이 꺼져 있어도 푸시가 올 때·주기 동기화 때 지금 시각에 맞게 바꿔 단다.
import { isIOS, notificationPermission, registerServiceWorker } from "./notify";
import { isTimed } from "./planner";
import { addDays, dayKey, DAY, fmtTime, startOfDay } from "./time";
import type { Task } from "./types";

export const LOCK_TAG = "lock-card";
/** 미리 계산해 두는 기간 — 이 뒤로는 앱을 다시 열 때까지 카드를 내린다(오래된 내용을 띄우지 않게) */
const HORIZON = 3 * DAY;

export interface LockFace {
  title: string;
  body: string;
}
/** at 부터 다음 단계 전까지 보여 줄 내용. face 가 null 이면 카드를 내린다 */
export interface LockStep {
  at: number;
  face: LockFace | null;
}

const active = (t: Task) => !t.deleted_at && (t.status === "planned" || t.status === "in_progress") && t.schedule !== "someday";
const star = (t: Task) => (t.starred ? "★ " : "");
const startDay = (t: Task) => dayKey(new Date(t.starts_at));

function list(names: string[], max: number) {
  return names.length > max ? `${names.slice(0, max).join(" · ")} 외 ${names.length - max}개` : names.join(" · ");
}

/** at 시각에 잠금화면 카드에 보일 내용 — 오늘·내일 할 게 없으면 null */
export function lockFace(tasks: Task[], at: number): LockFace | null {
  const today = dayKey(new Date(at));
  const tomorrow = dayKey(addDays(new Date(at), 1));
  const live = tasks.filter(active);
  // 아직 안 끝난 시각 일정(진행 중이거나 시작 시각이 지난 것 포함) — 오늘 것만
  const timed = live
    .filter((t) => isTimed(t) && Date.parse(t.ends_at) > at && (startDay(t) === today || Date.parse(t.starts_at) <= at))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const todos = live.filter((t) => !isTimed(t) && startDay(t) === today).map((t) => `${star(t)}${t.title}`);
  const tomorrowTimed = live
    .filter((t) => isTimed(t) && startDay(t) === tomorrow)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const tomorrowCount = live.filter((t) => startDay(t) === tomorrow).length;
  const tomorrowLine = tomorrowTimed[0]
    ? `내일 ${fmtTime(tomorrowTimed[0].starts_at)} ${tomorrowTimed[0].title}${tomorrowCount > 1 ? ` 외 ${tomorrowCount - 1}개` : ""}`
    : tomorrowCount
      ? `내일 할 일 ${tomorrowCount}개`
      : "";

  const [head, ...rest] = timed;
  const lines: string[] = [];
  let title: string;
  if (head) {
    const now = Date.parse(head.starts_at) <= at;
    title = now
      ? `▶ 지금 ${star(head)}${head.title} (~${fmtTime(head.ends_at)})`
      : `다음 ${fmtTime(head.starts_at)} ${star(head)}${head.title}`;
    if (rest.length) lines.push(`이어서 ${list(rest.map((t) => `${fmtTime(t.starts_at)} ${t.title}`), 3)}`);
    if (todos.length) lines.push(`오늘 할 일 ${list(todos, 3)}`);
    if (!rest.length && !todos.length) lines.push(tomorrowLine ? `오늘 마지막 일정 · ${tomorrowLine}` : "오늘 마지막 일정이에요");
  } else if (todos.length) {
    title = `오늘 할 일 ${todos.length}개`;
    lines.push(list(todos, 4));
    if (tomorrowLine) lines.push(tomorrowLine);
  } else if (tomorrowLine) {
    title = "오늘 일정 끝 🎉";
    lines.push(tomorrowLine);
  } else {
    return null;
  }
  return { title, body: lines.join("\n") };
}

/** 지금부터 HORIZON 동안 카드 내용이 바뀌는 시점들 — 같은 내용이 이어지면 하나로 */
export function lockSteps(tasks: Task[], now: number): LockStep[] {
  const end = now + HORIZON;
  const near = tasks.filter((t) => active(t) && Date.parse(t.ends_at) > now && Date.parse(t.starts_at) < end + DAY);
  const times = new Set<number>([now]);
  for (const t of near) {
    for (const x of [Date.parse(t.starts_at), Date.parse(t.ends_at)]) if (x > now && x < end) times.add(x);
  }
  for (let d = startOfDay(addDays(new Date(now), 1)); d.getTime() < end; d = addDays(d, 1)) times.add(d.getTime());
  const steps: LockStep[] = [];
  let prev = "";
  for (const at of [...times].sort((a, b) => a - b)) {
    const face = lockFace(near, at);
    const key = JSON.stringify(face);
    if (key !== prev) steps.push({ at, face });
    prev = key;
  }
  if (prev !== "null") steps.push({ at: end, face: null });
  return steps;
}

/** 잠금화면 카드를 쓸 수 있는 기기 — 안드로이드 폰·태블릿(아이폰은 알림을 고칠 때마다 소리가 나서 뺀다) */
export function lockCardSupported() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("Notification" in window)) return false;
  return window.matchMedia("(pointer: coarse)").matches && !isIOS();
}

let periodicOn: boolean | null = null;

/** 카드 내용을 서비스 워커에 넘긴다. tasks 가 null 이면(꺼짐·로그아웃) 카드를 내린다 */
export async function syncLockCard(tasks: Task[] | null) {
  if (!lockCardSupported()) return;
  const reg = await registerServiceWorker();
  const sw = reg?.active;
  if (!sw) return;
  const steps = tasks && notificationPermission() === "granted" ? lockSteps(tasks, Date.now()) : [];
  sw.postMessage({ type: "must:lock-card", steps });
  // 앱이 꺼져 있어도 가끔 새로 그리게(크롬이 설치한 앱에만 허용, 간격은 크롬이 정한다) — 켜고 끌 때만 한 번
  const on = steps.length > 0;
  if (periodicOn === on) return;
  periodicOn = on;
  const ps = (reg as ServiceWorkerRegistration & {
    periodicSync?: { register: (tag: string, o: { minInterval: number }) => Promise<void>; unregister: (tag: string) => Promise<void> };
  }).periodicSync;
  try {
    if (!ps) return;
    if (!on) await ps.unregister(LOCK_TAG);
    else if ((await navigator.permissions.query({ name: "periodic-background-sync" as PermissionName })).state === "granted") {
      await ps.register(LOCK_TAG, { minInterval: 60 * 60 * 1000 });
    }
  } catch {
    /* 지원 안 함 */
  }
}
