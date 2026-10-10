"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Cloud, CloudOff, FolderOpen, Loader2, NotebookPen, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  DriveConflict,
  driveError,
  isNoteFile,
  readText,
  removeFile,
  replaceFile,
  STUDY_FOLDER,
  uploadFile,
  type DriveFile,
} from "@/lib/drive";
import {
  isUntouched,
  localNotesStorage,
  NoteConflict,
  NotesStore,
  type NoteBackend,
  type NotesSnapshot,
  type RemoteNote,
  type StudyNote,
} from "@/lib/studyNotes";
import { getSupabase } from "@/lib/supabase";
import { uuid } from "@/lib/time";
import { useOnline } from "./DictionarySheet";
import { usePlanner } from "./PlannerProvider";
import { Button, Card, cx, IconButton, Modal } from "./ui";

const NOTE_MIME = "text/plain;charset=utf-8";

/* ─────────── 드라이브(Study 폴더) 연결 ─────────── */
function driveBackend(sb: SupabaseClient): NoteBackend {
  const rows = new Map<string, DriveFile>();
  const remember = (f: DriveFile): RemoteNote => {
    rows.set(f.id, f);
    return { id: f.id, name: f.filename, at: f.updated_at };
  };
  const row = async (id: string): Promise<DriveFile> => {
    const have = rows.get(id);
    if (have) return have;
    const { data, error } = await sb.from("drive_files").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(driveError(error));
    if (!data) throw new Error("드라이브에서 지워진 파일이에요.");
    rows.set(id, data as DriveFile);
    return data as DriveFile;
  };
  /** 노트(글 파일)만 — 사진·PDF 를 메모장으로 열거나 덮어쓰지 않게 */
  const noteRow = async (id: string): Promise<DriveFile> => {
    const f = await row(id);
    if (!isNoteFile(f)) throw new Error("글 파일이 아니라 노트로 열 수 없어요.");
    return f;
  };
  return {
    async list() {
      // Study 폴더 전체를 1000개씩 끝까지(잘린 목록으로 '서버에서 지워짐'을 잘못 판단하지 않게) — 노트(글 파일)만
      const out: DriveFile[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb
          .from("drive_files")
          .select("*")
          .eq("folder", STUDY_FOLDER)
          .eq("ready", true)
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, from + 999);
        if (error) throw new Error(driveError(error));
        out.push(...((data ?? []) as DriveFile[]));
        if ((data ?? []).length < 1000) break;
      }
      return out.filter(isNoteFile).map(remember);
    },
    async read(id) {
      return readText(sb, await noteRow(id));
    },
    async create(name, text) {
      return remember(await uploadFile(sb, new File([text], name, { type: NOTE_MIME }), undefined, undefined, undefined, STUDY_FOLDER));
    },
    async update(id, name, text, base) {
      try {
        return remember(await replaceFile(sb, await noteRow(id), new Blob([text], { type: NOTE_MIME }), name, base));
      } catch (e) {
        if (e instanceof DriveConflict) {
          rows.delete(id); // 다음 목록에서 새 판을 받는다
          throw new NoteConflict();
        }
        throw e;
      }
    },
    async remove(id) {
      let f: DriveFile;
      try {
        f = await row(id);
      } catch {
        return; // 이미 없음
      }
      await removeFile(sb, f);
      rows.delete(id);
    },
  };
}

/* 계정마다 노트 저장소 하나(타이머 화면·드라이브 화면이 같이 쓴다) */
const stores = new Map<string, NotesStore>();
const backends = new Map<string, NoteBackend>();
function storeFor(scope: string): NotesStore {
  let s = stores.get(scope);
  if (!s) {
    const key = `must:study-notes:${scope}`;
    const locks = typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : undefined;
    s = new NotesStore(localNotesStorage(key), {
      isOnline: () => navigator.onLine,
      uuid,
      explain: driveError,
      // 탭 여러 개가 같은 노트를 동시에 올리지 않게(지원 안 하는 브라우저는 그냥)
      lock: locks ? async (fn) => void (await locks.request(key, fn)) : undefined,
    });
    stores.set(scope, s);
  }
  return s;
}

const EMPTY: NotesSnapshot = { notes: [], status: "local", message: null, pending: 0, saveFailed: false };
const noop = () => () => {};

/**
 * 공부 노트 저장소 — 로그인했으면 드라이브 Study 폴더와 맞춘다.
 * passive = 늘 떠 있는 뒤쪽 맞추기(StudyNotesSync) — 노트를 한 번도 안 쓴 사람은 서버에 묻지 않는다
 */
export function useStudyNotes(passive = false): { store: NotesStore | null; snap: NotesSnapshot; signedIn: boolean } {
  const { session } = usePlanner();
  const sb = getSupabase();
  const uid = session.ready ? session.userId : null;
  const store = session.ready ? storeFor(uid ?? "local") : null;
  const snap = useSyncExternalStore(store?.subscribe ?? noop, store?.getSnapshot ?? (() => EMPTY), () => EMPTY);
  const signedIn = Boolean(sb && uid);

  useEffect(() => {
    if (!store) return;
    if (!sb || !uid) {
      store.setBackend(null);
      return;
    }
    const local = storeFor("local");
    if (passive && store.getSnapshot().notes.length === 0 && !local.hasImportable()) return;
    let b = backends.get(uid);
    if (!b) {
      b = driveBackend(sb);
      backends.set(uid, b);
    }
    // 로그인 전에 이 기기에서 쓴 노트는 이 계정으로 옮겨 드라이브에 올린다
    store.importFrom(local);
    store.setBackend(b);
  }, [store, sb, uid, passive]);

  // 인터넷이 돌아오거나 앱으로 돌아오면 맞추고, 앱을 내리면 남은 걸 바로 올린다. 다른 탭이 저장하면 합친다
  const key = `must:study-notes:${uid ?? "local"}`;
  useEffect(() => {
    if (!store) return;
    const on = () => store.schedule(0);
    const vis = () => (document.visibilityState === "hidden" ? void store.flush() : store.schedule(0));
    const other = (e: StorageEvent) => {
      if (e.key !== key || e.newValue === null) return;
      try {
        store.absorb(JSON.parse(e.newValue));
      } catch {
        /* 망가진 값은 무시 */
      }
    };
    window.addEventListener("online", on);
    window.addEventListener("focus", on);
    window.addEventListener("storage", other);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("focus", on);
      window.removeEventListener("storage", other);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [store, key]);

  return { store, snap, signedIn };
}

/** 어느 화면에 있든 — 인터넷이 돌아오거나 로그인하면 못 올린 노트를 올린다(화면엔 아무것도 안 그림) */
export function StudyNotesSync() {
  useStudyNotes(true);
  return null;
}

/* ─────────── 표시 도우미 ─────────── */
const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  return d.getFullYear() === now.getFullYear()
    ? `${d.getMonth() + 1}월 ${d.getDate()}일`
    : `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
};
const preview = (n: StudyNote) =>
  n.body === null
    ? "다른 기기에서 쓴 노트 — 누르면 불러와요"
    : n.body.trim().split("\n").find((l) => l.trim())?.trim().slice(0, 80) || "빈 노트";

/** 저장 상태 한 줄 */
function statusText(snap: NotesSnapshot, signedIn: boolean, note?: StudyNote): { text: string; tone: "ok" | "muted" | "warn" | "danger" } {
  // 아무것도 안 쓴 새 노트는 올리지 않으니 '올리는 중'으로 안 본다
  const dirty = note ? note.dirty && note.body !== null && !(isUntouched(note) && !note.remote) : snap.pending > 0;
  if (snap.saveFailed)
    return {
      text: signedIn && snap.status !== "offline" ? "이 기기 저장 공간이 꽉 찼어요 — 드라이브에 올라가면 안전해요" : "저장 공간이 꽉 차서 이 기기에 저장하지 못했어요",
      tone: "danger",
    };
  if (!signedIn) return { text: "이 기기에 저장됨 · 로그인하면 드라이브 Study 폴더에 올라가요", tone: "muted" };
  if (snap.status === "offline") return { text: "이 기기에 저장됨 · 인터넷이 연결되면 올라가요", tone: "warn" };
  if (snap.status === "error") return { text: snap.message ?? "올리지 못했어요", tone: "danger" };
  if (snap.status === "syncing" || dirty) return { text: "드라이브에 올리는 중…", tone: "muted" };
  if (!note && snap.notes.length === 0) return { text: "드라이브 › Study 폴더에 저장돼요", tone: "ok" };
  return { text: "드라이브 › Study 폴더에 저장됨", tone: "ok" };
}

/* ─────────── 타이머 화면의 '공부 노트' 칸 ─────────── */
export function StudyNotesCard({ onOpenDrive }: { onOpenDrive?: () => void }) {
  const { store, snap, signedIn } = useStudyNotes();
  const [openId, setOpenId] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  // 화면에 들어오면 다른 기기에서 쓴 노트를 받아 온다
  useEffect(() => {
    if (store && signedIn) store.schedule(0);
  }, [store, signedIn]);

  const add = () => {
    if (!store) return;
    setOpenId(store.create().id);
  };
  const shown = all ? snap.notes : snap.notes.slice(0, 4);
  const st = statusText(snap, signedIn);

  return (
    <Card className="p-2">
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <NotebookPen size={16} className="text-accent-text" />
        <h3 className="flex-1 text-[13px] font-bold text-muted">공부 노트</h3>
        {signedIn && snap.status === "error" && (
          <IconButton label="다시 올리기" className="size-8" onClick={() => void store?.sync()}>
            <RefreshCw size={15} />
          </IconButton>
        )}
        {onOpenDrive && signedIn && (
          <IconButton label="드라이브 Study 폴더 열기" className="size-8" onClick={onOpenDrive}>
            <FolderOpen size={16} />
          </IconButton>
        )}
        <button
          onClick={add}
          aria-label="새 노트"
          title="새 노트"
          disabled={!store}
          className="grid size-9 place-items-center rounded-xl bg-accent text-accent-fg shadow-sm transition hover:brightness-110 disabled:opacity-40"
        >
          <Plus size={19} strokeWidth={2.6} />
        </button>
      </div>
      <p
        className={cx(
          "flex items-center gap-1.5 px-3 pb-2 text-xs",
          st.tone === "ok" ? "text-muted" : st.tone === "warn" ? "text-warn" : st.tone === "danger" ? "text-danger" : "text-faint",
        )}
      >
        {st.tone === "warn" ? <CloudOff size={13} /> : st.tone === "ok" ? <Cloud size={13} /> : null}
        {st.text}
      </p>
      {snap.notes.length === 0 ? (
        <button
          onClick={add}
          className="mx-1 mb-1 flex w-[calc(100%-0.5rem)] flex-col items-center gap-1 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted transition hover:border-accent hover:text-fg"
        >
          <Plus size={20} />
          오늘 공부한 내용을 적어 보세요
          <span className="text-xs text-faint">노트북에서 쓰면 폰에서도 보여요</span>
        </button>
      ) : (
        <ul className="space-y-0.5">
          {shown.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => setOpenId(n.id)}
                className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{n.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted">{preview(n)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs text-faint">
                  {n.dirty && signedIn && <CloudOff size={12} aria-label="아직 안 올라감" />}
                  {fmtWhen(n.updated_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {snap.notes.length > 4 && (
        <button onClick={() => setAll(!all)} className="w-full rounded-xl py-2 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-fg">
          {all ? "접기" : `모두 보기 (${snap.notes.length})`}
        </button>
      )}
      {openId && store && <NoteEditor store={store} id={openId} signedIn={signedIn} onClose={() => setOpenId(null)} />}
    </Card>
  );
}

/* ─────────── 노트 쓰기(메모장) ─────────── */
export function NoteEditor({ store, id, signedIn, onClose }: { store: NotesStore; id: string; signedIn: boolean; onClose: () => void }) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const note = snap.notes.find((n) => n.id === id) ?? null;
  const online = useOnline();
  const [loadErr, setLoadErr] = useState<{ msg: string; retry: number } | null>(null);
  const [retry, setRetry] = useState(0);
  const [asking, setAsking] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const isNew = useRef(note ? note.body === "" && !note.remote : false);
  const needsLoad = note !== null && note.body === null;
  // 이번 시도에서 난 오류만 보인다(다시 불러오기를 누르면 사라짐)
  const err = loadErr && loadErr.retry === retry ? loadErr.msg : null;
  const loading = needsLoad && !err;

  // 다른 기기에서 쓴 노트(또는 저쪽에서 고친 판)는 내용을 받아 온다 — 인터넷이 돌아오면 다시
  useEffect(() => {
    if (!needsLoad) return;
    let alive = true;
    store.load(id).catch((e) => alive && setLoadErr({ msg: (e as Error).message, retry }));
    return () => {
      alive = false;
    };
  }, [id, needsLoad, store, online, retry]);

  // 새 노트는 바로 쓰기 시작
  useEffect(() => {
    if (!isNew.current) return;
    const t = window.setTimeout(() => area.current?.focus(), 120);
    return () => window.clearTimeout(t);
  }, []);

  const close = () => {
    store.discardIfEmpty(id);
    void store.flush();
    onClose();
  };

  // 지워졌으면(다른 기기에서) 닫는다
  useEffect(() => {
    if (!note) onClose();
  }, [note, onClose]);

  const st = statusText(snap, signedIn, note ?? undefined);
  const count = useMemo(() => (note?.body ?? "").replace(/\s/g, "").length, [note?.body]);
  if (!note) return null;

  return (
    <>
      <Modal
        open
        onClose={close}
        size="xl"
        className="md:h-[88dvh]"
        title={
          <input
            value={note.title}
            onChange={(e) => store.edit(id, { title: e.target.value })}
            disabled={needsLoad}
            aria-label="노트 제목"
            maxLength={120}
            placeholder="제목"
            className="w-full min-w-0 bg-transparent text-lg font-bold tracking-tight outline-none! placeholder:text-faint"
          />
        }
        subtitle={
          <span
            className={cx(
              "inline-flex items-center gap-1.5",
              st.tone === "warn" ? "text-warn" : st.tone === "danger" ? "text-danger" : undefined,
            )}
          >
            {st.tone === "warn" ? <CloudOff size={13} /> : st.tone === "ok" ? <Cloud size={13} /> : null}
            {st.text}
          </span>
        }
        footer={
          <div className="flex items-center gap-2">
            <IconButton label="노트 지우기" onClick={() => setAsking(true)} className="-ml-2 text-muted hover:text-danger">
              <Trash2 size={18} />
            </IconButton>
            <span className="text-xs text-faint tabular-nums">{count.toLocaleString()}자</span>
            {snap.status === "error" && signedIn && (
              <Button size="sm" onClick={() => void store.sync()} className="ml-2">
                <RefreshCw size={14} /> 다시 올리기
              </Button>
            )}
            <Button variant="primary" onClick={close} className="ml-auto">
              완료
            </Button>
          </div>
        }
      >
        {loading ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" /> 노트를 불러오는 중…
          </p>
        ) : err ? (
          <div className="py-12 text-center">
            <p className="font-semibold">{err}</p>
            <p className="mt-1 text-sm text-muted">다른 기기에서 쓴 노트라 내용을 받아 와야 해요.</p>
            <Button className="mt-4" onClick={() => setRetry((r) => r + 1)} disabled={!online}>
              <RefreshCw size={15} /> 다시 불러오기
            </Button>
          </div>
        ) : (
          <textarea
            ref={area}
            value={note.body ?? ""}
            onChange={(e) => store.edit(id, { body: e.target.value })}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                void store.flush();
              }
            }}
            aria-label="노트 내용"
            placeholder={"오늘 공부한 내용을 자유롭게 적어 보세요.\n예) 영어 — 관계대명사 what 정리, 틀린 문제 3개"}
            className="block h-full min-h-[55dvh] w-full resize-none bg-transparent text-base leading-7 outline-none! placeholder:text-faint md:min-h-[60dvh] md:text-[17px]"
          />
        )}
      </Modal>
      {asking && (
        <Modal
          open
          size="sm"
          tone="danger"
          onClose={() => setAsking(false)}
          title="노트를 지울까요?"
          subtitle={note.remote ? "드라이브 Study 폴더에서도 지워져요." : "이 기기에서 지워져요."}
        >
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setAsking(false)}>그대로 두기</Button>
            <Button
              variant="danger"
              onClick={() => {
                setAsking(false);
                store.remove(id);
                onClose();
              }}
            >
              <Trash2 size={15} /> 지우기
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
