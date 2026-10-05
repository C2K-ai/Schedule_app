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
import { liveHabits, liveTasks, materializeHabits } from "@/lib/planner";
import { mergeSettings } from "@/lib/settings";
import { PlannerStore, type Snapshot } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";
import { addDays, startOfDay, uuid } from "@/lib/time";
import type { AlarmKind, Habit, Settings, Task } from "@/lib/types";

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

export type Sheet = null | "settings" | "habits" | "log";

export interface EditorState {
  taskId?: string;
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
  session: Session;
  editor: EditorState | null;
  openEditor: (e: EditorState) => void;
  closeEditor: () => void;
  sheet: Sheet;
  sheetTab: string | null;
  openSheet: (s: Sheet, tab?: string) => void;
  focusScreen: boolean;
  setFocusScreen: (b: boolean) => void;
  alarm: Alarm | null;
  ring: (a: Alarm) => void;
  dismissAlarm: () => void;
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
      boot(null, null);
    } else {
      void sb.auth.getSession().then(({ data }) => {
        if (!cancelled) boot(data.session?.user.id ?? null, data.session?.user.email ?? null);
      });
      const { data } = sb.auth.onAuthStateChange((_e, s) => {
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

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sheetTab, setSheetTab] = useState<string | null>(null);
  const [focusScreen, setFocusScreen] = useState(false);
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [postpone, setPostpone] = useState<{ taskId: string; start: Date } | null>(null);

  // 테마
  useEffect(() => {
    const apply = () => {
      const dark =
        settings.theme === "dark" ||
        (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      try {
        localStorage.setItem("must:theme", settings.theme);
      } catch {
        /* 무시 */
      }
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings.theme]);

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
    await getSupabase()?.auth.signOut();
  }, []);

  const value: Ctx = {
    store,
    snap,
    settings,
    tasks,
    habits,
    session,
    editor,
    openEditor: setEditor,
    closeEditor: () => setEditor(null),
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
