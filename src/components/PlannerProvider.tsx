"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { liveActivities, liveHabits, liveTasks, materializeHabits } from "@/lib/planner";
import { syncLockCard } from "@/lib/lockCard";
import { mergeSettings } from "@/lib/settings";
import { unsubscribePush } from "@/lib/push";
import { PlannerStore, type Snapshot } from "@/lib/store";
import { clearRecovery, inRecovery, linkErrorMessage, markRecovery, RECOVERY_EVENT } from "@/lib/authLinks";
import { getSupabase } from "@/lib/supabase";
import { addDays, startOfDay, uuid } from "@/lib/time";
import type { Activity, AlarmKind, Habit, ScheduleKind, Settings, Task } from "@/lib/types";

export interface Toast {
  id: string;
  text: string;
  tone?: "default" | "danger" | "ok";
  action?: { label: string; onClick: () => void };
  ttl?: number;
}

export interface Alarm {
  key: string;
  kind: AlarmKind;
  seq: number;
  taskId: string | null;
  title: string;
  body: string;
  soundId: string;
  at: number;
}

export type Sheet = null | "settings" | "habits" | "log" | "voice" | "completed" | "admin" | "drive";

export interface EditorState {
  taskId?: string;
  start?: Date;
  end?: Date;
  /** 새로 만들 때 미리 채울 값 */
  schedule?: ScheduleKind;
  day?: string;
  categoryId?: string;
  starred?: boolean;
  title?: string;
}

/** 한 일 기록 창 — id 가 있으면 고치기, 없으면 새로 */
export interface ActivityEditorState {
  activityId?: string;
  /** YYYY-MM-DD */
  day?: string;
  start?: Date;
  end?: Date;
}

interface Session {
  userId: string | null;
  email: string | null;
  ready: boolean;
}

interface Ctx {
  store: PlannerStore;
  snap: Snapshot;
  settings: Settings;
  tasks: Task[];
  habits: Habit[];
  activities: Activity[];
  session: Session;
  editor: EditorState | null;
  openEditor: (e: EditorState) => void;
  closeEditor: () => void;
  activityEditor: ActivityEditorState | null;
  openActivity: (e: ActivityEditorState) => void;
  closeActivity: () => void;
  /** 못 한 일정 '다시 잡기' 창 */
  reschedule: string | null;
  openReschedule: (taskId: string) => void;
  closeReschedule: () => void;
  /** 일정 누르기 — 못 한 일정이면 다시 잡기, 아니면 편집 */
  openTask: (t: Task) => void;
  /** 배경만 보기(사진 배경 테마) */
  wallpaper: boolean;
  setWallpaper: (b: boolean) => void;
  sheet: Sheet;
  sheetTab: string | null;
  openSheet: (s: Sheet, tab?: string) => void;
  focusScreen: boolean;
  setFocusScreen: (b: boolean) => void;
  alarm: Alarm | null;
  ring: (a: Alarm) => void;
  dismissAlarm: () => void;
  /** 미시작 경고음 — 화면을 덮지 않고 경고창이 울린다(사유를 쓰는 중에 끊기지 않게) */
  overdueRing: Alarm | null;
  ringOverdue: (a: Alarm) => void;
  stopOverdue: () => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dropToast: (id: string) => void;
  postpone: { taskId: string; start: Date } | null;
  askPostpone: (taskId: string, start: Date) => void;
  closePostpone: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  signOut: () => Promise<void>;
}

const PlannerContext = createContext<Ctx | null>(null);

export function usePlanner(): Ctx {
  const c = useContext(PlannerContext);
  if (!c) throw new Error("PlannerProvider 밖에서 usePlanner 사용");
  return c;
}

const noopSubscribe = () => () => {};
const nullSnapshot = () => null;

export function PlannerProvider({ children, splash }: { children: ReactNode; splash: ReactNode }) {
  const storeRef = useRef<PlannerStore | null>(null);
  const [store, setStore] = useState<PlannerStore | null>(null);
  const [session, setSession] = useState<Session>({ userId: null, email: null, ready: false });

  const boot = useCallback((userId: string | null, email: string | null) => {
    setSession({ userId, email, ready: true });
    const cur = storeRef.current;
    if (cur && cur.userId === userId) return;
    cur?.dispose();
    const s = new PlannerStore(userId ?? "local", userId, userId ? getSupabase() : null);
    s.start();
    storeRef.current = s;
    setStore(s);
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    let cancelled = false;
    let unsub: (() => void) | null = null;
    if (!sb) {
      // 외부 저장소(localStorage) 를 여는 초기화 — 마운트 때 한 번
      // eslint-disable-next-line react-hooks/set-state-in-effect
      boot(null, null);
    } else {
      void sb.auth.getSession().then(({ data }) => {
        if (!cancelled) boot(data.session?.user.id ?? null, data.session?.user.email ?? null);
      });
      const { data } = sb.auth.onAuthStateChange((e, s) => {
        // 비밀번호 재설정 메일 링크로 들어옴 → 새 비밀번호 칸을 연다(Inner 가 받는다)
        if (e === "PASSWORD_RECOVERY" && s?.user.id) markRecovery(s.user.id);
        if (e === "SIGNED_OUT") clearRecovery();
        if (!cancelled) boot(s?.user.id ?? null, s?.user.email ?? null);
      });
      unsub = () => data.subscription.unsubscribe();
    }
    return () => {
      cancelled = true;
      unsub?.();
      storeRef.current?.dispose();
      storeRef.current = null;
    };
  }, [boot]);

  const snap = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getSnapshot ?? nullSnapshot,
    nullSnapshot,
  );

  if (!store || !snap) return <>{splash}</>;
  return (
    <Inner store={store} snap={snap} session={session}>
      {children}
    </Inner>
  );
}

function Inner({
  store,
  snap,
  session,
  children,
}: {
  store: PlannerStore;
  snap: Snapshot;
  session: Session;
  children: ReactNode;
}) {
  const settings = useMemo(() => mergeSettings(snap.db.profile?.settings), [snap.db.profile]);
  const tasks = useMemo(() => liveTasks(snap.db), [snap.db]);
  const habits = useMemo(() => liveHabits(snap.db), [snap.db]);
  const activities = useMemo(() => liveActivities(snap.db), [snap.db]);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [activityEditor, setActivityEditor] = useState<ActivityEditorState | null>(null);
  const [reschedule, setReschedule] = useState<string | null>(null);
  const [wallpaper, setWallpaper] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sheetTab, setSheetTab] = useState<string | null>(null);
  const [focusScreen, setFocusScreen] = useState(false);
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const [overdueRing, setOverdueRing] = useState<Alarm | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [postpone, setPostpone] = useState<{ taskId: string; start: Date } | null>(null);

  // 테마
  useEffect(() => {
    const apply = () => {
      const dark =
        settings.theme === "dark" ||
        (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.dataset.palette = settings.palette;
      try {
        localStorage.setItem("must:theme", settings.theme);
        localStorage.setItem("must:palette", settings.palette);
      } catch {
        /* 무시 */
      }
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings.theme, settings.palette]);

  // 습관 → 오늘부터 7일치 회차 생성
  const habitsRef = snap.db.habits;
  useEffect(() => {
    const today = startOfDay(new Date());
    materializeHabits(
      store,
      Array.from({ length: 7 }, (_, i) => addDays(today, i)),
    );
  }, [store, habitsRef]);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = uuid();
    setToasts((list) => [...list.slice(-3), { ...t, id }]);
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.ttl ?? 4500);
  }, []);
  const dropToast = useCallback((id: string) => setToasts((l) => l.filter((x) => x.id !== id)), []);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      const cur = store.db.profile;
      store.saveProfile({
        settings: { ...(cur?.settings ?? {}), ...patch },
        ...(patch.graceMin !== undefined ? { grace_min: patch.graceMin } : {}),
      });
    },
    [store],
  );

  const signOut = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    // 이 기기의 푸시 구독을 먼저 지운다 — 안 그러면 로그아웃한 계정의 알림이 계속 이 기기로 온다
    await unsubscribePush(sb).catch(() => {});
    await syncLockCard(null).catch(() => {});
    await sb.auth.signOut();
  }, []);

  // 메일 링크로 들어온 경우 — 재설정 링크면 새 비밀번호 칸으로, 만료된 링크면 안내
  useEffect(() => {
    const openRecovery = () => {
      setSheet("settings");
      setSheetTab("account");
    };
    // 재설정 링크는 이 화면이 뜨기 전에 처리되기도 해서, 표시해 둔 것도 본다
    if (inRecovery(session.userId)) openRecovery();
    window.addEventListener(RECOVERY_EVENT, openRecovery);
    const msg = linkErrorMessage(window.location.hash);
    if (msg) {
      // 앱을 연 그 순간 한 번만 — 외부(주소창)에서 온 값을 알리는 것
      // eslint-disable-next-line react-hooks/set-state-in-effect
      toast({ text: msg, tone: "danger", ttl: 15_000 });
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    return () => window.removeEventListener(RECOVERY_EVENT, openRecovery);
  }, [toast, session.userId]);

  // 서버가 습관 회차·알림 문구를 이 기기 시간대로 만들도록 프로필에 시간대를 맞춰 둔다
  const profileTz = snap.db.profile?.timezone;
  useEffect(() => {
    if (!session.userId || !profileTz) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== profileTz) store.saveProfile({ timezone: tz });
  }, [session.userId, profileTz, store]);

  const value: Ctx = {
    store,
    snap,
    settings,
    tasks,
    habits,
    activities,
    session,
    editor,
    openEditor: setEditor,
    closeEditor: () => setEditor(null),
    activityEditor,
    openActivity: setActivityEditor,
    closeActivity: () => setActivityEditor(null),
    reschedule,
    openReschedule: setReschedule,
    closeReschedule: () => setReschedule(null),
    wallpaper,
    setWallpaper,
    openTask: (t) => (t.status === "missed" || t.status === "skipped" ? setReschedule(t.id) : setEditor({ taskId: t.id })),
    sheet,
    sheetTab,
    openSheet: (s, tab) => {
      setSheet(s);
      setSheetTab(tab ?? null);
    },
    focusScreen,
    setFocusScreen,
    alarm,
    ring: (a) => setAlarm((cur) => (cur && cur.kind === "overdue" && a.kind === "before" ? cur : a)),
    dismissAlarm: () => setAlarm(null),
    overdueRing,
    ringOverdue: setOverdueRing,
    stopOverdue: () => setOverdueRing(null),
    toasts,
    toast,
    dropToast,
    postpone,
    askPostpone: (taskId, start) => setPostpone({ taskId, start }),
    closePostpone: () => setPostpone(null),
    updateSettings,
    signOut,
  };

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}
