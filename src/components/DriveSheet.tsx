"use client";

import {
  Download,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  HardDrive,
  Lock,
  LogIn,
  NotebookPen,
  Pencil,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  driveError,
  driveUsage,
  fileKind,
  fileUrl,
  fmtBytes,
  isNoteFile,
  listFiles,
  MAX_FILE,
  openLocked,
  removeFile,
  STUDY_FOLDER,
  updateFile,
  uploadFile,
  type DriveFile,
  type DriveUsage,
  type FileKind,
} from "@/lib/drive";
import { getSupabase } from "@/lib/supabase";
import { uuid } from "@/lib/time";
import { MIN_PASSWORD, WrongPassword } from "@/lib/vault";
import { usePlanner } from "./PlannerProvider";
import { NoteEditor, useStudyNotes } from "./StudyNotes";
import { Button, Chip, cx, Empty, IconButton, inputCls, Modal, Switch } from "./ui";

const KIND_ICON: Record<FileKind, { icon: typeof FileIcon; tint: string }> = {
  image: { icon: FileImage, tint: "bg-[#8b5cf6]/15 text-[#a78bfa]" },
  pdf: { icon: FileText, tint: "bg-danger-soft text-danger" },
  video: { icon: FileVideo, tint: "bg-[#ec4899]/15 text-[#f472b6]" },
  audio: { icon: FileAudio, tint: "bg-[#06b6d4]/15 text-[#22d3ee]" },
  doc: { icon: FileText, tint: "bg-[#3b82f6]/15 text-[#60a5fa]" },
  sheet: { icon: FileSpreadsheet, tint: "bg-ok/15 text-ok" },
  archive: { icon: FileArchive, tint: "bg-warn/15 text-warn" },
  other: { icon: FileIcon, tint: "bg-surface-3 text-muted" },
};

type Filter = "all" | "study" | "starred" | "image" | "doc";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "study", label: "📒 Study" },
  { value: "starred", label: "★ 중요" },
  { value: "image", label: "사진" },
  { value: "doc", label: "문서" },
];
/** 공부 노트(Study 폴더의 글 파일) — 누르면 노트 쓰기 창으로 연다 */
const isNote = (f: DriveFile) => f.folder === STUDY_FOLDER && isNoteFile(f);

interface Upload {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
/** 목록용 짧은 날짜 — 올해면 '10월 8일', 아니면 '25.3.1' */
const fmtShort = (iso: string) => {
  const d = new Date(iso);
  return d.getFullYear() === new Date().getFullYear()
    ? `${d.getMonth() + 1}월 ${d.getDate()}일`
    : `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
};

/** 드라이브 — 나만 볼 수 있는 파일 보관함(☰ 메뉴 → 드라이브) */
export function DriveSheet() {
  const { sheet } = usePlanner();
  if (sheet !== "drive") return null;
  return <DriveBody />;
}

function DriveBody() {
  const { openSheet, session, toast, sheetTab } = usePlanner();
  const notes = useStudyNotes();
  const [noteId, setNoteId] = useState<string | null>(null);
  const sb = getSupabase();
  const close = () => openSheet(null);
  const signedIn = Boolean(sb && session.userId);

  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [usage, setUsage] = useState<DriveUsage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>(sheetTab === "study" ? "study" : "all");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<{ f: DriveFile; url: string; local?: boolean } | null>(null);
  const [renaming, setRenaming] = useState<DriveFile | null>(null);
  const [deleting, setDeleting] = useState<DriveFile | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // 비밀번호 잠금 — 비밀번호는 어디에도 저장하지 않는다(이 창을 연 동안 메모리에만, 다시 열 때 또 묻지 않게)
  const [lockOn, setLockOn] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const sessionPw = useRef<string | null>(null);
  const [unlocking, setUnlocking] = useState<{ f: DriveFile; mode: "open" | "download" } | null>(null);
  const lockReady = !lockOn || (pw.length >= MIN_PASSWORD && pw === pw2);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!sb || !signedIn) return;
    let alive = true;
    Promise.all([listFiles(sb), driveUsage(sb)])
      .then(([f, u]) => {
        if (!alive) return;
        setFiles(f);
        setUsage(u);
      })
      .catch((e) => alive && setErr(driveError(e)));
    return () => {
      alive = false;
    };
  }, [sb, signedIn, reload]);

  const refreshUsage = () => sb && void driveUsage(sb).then(setUsage, () => {});

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (files ?? []).filter((f) => {
      if (s && !f.filename.toLowerCase().includes(s)) return false;
      if (filter === "study") return f.folder === STUDY_FOLDER;
      if (filter === "starred") return f.starred;
      if (filter === "image") return fileKind(f) === "image";
      if (filter === "doc") return ["pdf", "doc", "sheet"].includes(fileKind(f));
      return true;
    });
  }, [files, q, filter]);

  const upload = async (picked: FileList | File[]) => {
    if (!sb) return;
    if (!lockReady) {
      toast({ text: `잠글 비밀번호를 ${MIN_PASSWORD}자 이상, 두 칸 똑같이 적어 주세요.`, tone: "danger" });
      return;
    }
    const password = lockOn ? pw : undefined;
    const arr = Array.from(picked);
    for (const file of arr) {
      const key = uuid();
      const set = (patch: Partial<Upload>) => setUploads((l) => l.map((u) => (u.key === key ? { ...u, ...patch } : u)));
      setUploads((l) => [...l, { key, name: file.name, progress: 0 }]);
      if (file.size > MAX_FILE) {
        set({ error: `${fmtBytes(file.size)} — 파일 하나는 50MB 까지예요` });
        continue;
      }
      try {
        const f = await uploadFile(sb, file, (p) => set({ progress: p }), undefined, password, filter === "study" ? STUDY_FOLDER : undefined);
        if (password) sessionPw.current = password;
        setFiles((l) => [f, ...(l ?? [])]);
        setUploads((l) => l.filter((u) => u.key !== key));
      } catch (e) {
        set({ error: (e as Error).message });
      }
    }
    refreshUsage();
  };

  const viewable = (f: DriveFile) => ["pdf", "video", "audio"].includes(fileKind(f));

  /** 푼 파일 보여 주기 — 사진은 앱 안에서, PDF·영상은 새 창, 나머지는 내려받기 */
  const show = (f: DriveFile, blob: Blob, mode: "open" | "download", w: Window | null) => {
    const url = URL.createObjectURL(blob);
    if (mode === "open" && fileKind(f) === "image") {
      w?.close();
      setPreview({ f, url, local: true });
      return;
    }
    if (mode === "open" && w) w.location.href = url;
    else {
      const a = document.createElement("a");
      a.href = url;
      a.download = f.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const unlockAndShow = async (f: DriveFile, mode: "open" | "download", password: string, w: Window | null) => {
    if (!sb) return;
    const blob = await openLocked(sb, f, password);
    sessionPw.current = password;
    show(f, blob, mode, w);
  };

  /** 잠긴 파일 — 이번에 쓴 비밀번호로 먼저 풀어 보고, 안 되면 묻는다 */
  const openLockedFile = async (f: DriveFile, mode: "open" | "download") => {
    const w = mode === "open" && viewable(f) ? window.open("", "_blank") : null;
    if (sessionPw.current) {
      try {
        await unlockAndShow(f, mode, sessionPw.current, w);
        return;
      } catch (e) {
        if (!(e instanceof WrongPassword)) {
          w?.close();
          toast({ text: (e as Error).message, tone: "danger" });
          return;
        }
      }
    }
    w?.close();
    setUnlocking({ f, mode });
  };

  const closePreview = () => {
    if (preview?.local) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  const openNote = (f: DriveFile) => {
    if (!notes.store) return;
    setNoteId(notes.store.adopt({ id: f.id, name: f.filename, at: f.updated_at }).id);
  };
  const newNote = () => notes.store && setNoteId(notes.store.create().id);
  const closeNote = () => {
    setNoteId(null);
    const st = notes.store;
    if (!st) return;
    // 노트를 올린 뒤 목록·사용량을 새로 — 못 올렸으면 알려 준다(노트는 이 기기에 남아 있음)
    void st.flush().then(() => {
      const s = st.getSnapshot();
      // 못 올렸을 때만 알린다(오류). 인터넷이 없을 땐 메모장 위쪽에 이미 '이 기기에 저장됨'이 보인다
      if (s.status === "error") toast({ text: `${s.message ?? "노트를 올리지 못했어요"} — 이 기기엔 저장돼 있어요`, tone: "danger" });
      setReload((r) => r + 1);
    });
  };

  const open = async (f: DriveFile) => {
    if (!sb) return;
    if (isNote(f)) return openNote(f);
    if (f.locked) return openLockedFile(f, "open");
    if (fileKind(f) === "image") {
      try {
        setPreview({ f, url: await fileUrl(sb, f) });
      } catch (e) {
        toast({ text: (e as Error).message, tone: "danger" });
      }
      return;
    }
    // PDF·영상 등은 새 창으로(팝업 차단을 피하려고 창을 먼저 연다)
    const w = window.open("", "_blank");
    try {
      const url = await fileUrl(sb, f, !["pdf", "video", "audio"].includes(fileKind(f)));
      if (w) w.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      w?.close();
      toast({ text: (e as Error).message, tone: "danger" });
    }
  };

  const download = async (f: DriveFile) => {
    if (!sb) return;
    if (f.locked) return openLockedFile(f, "download");
    try {
      const a = document.createElement("a");
      a.href = await fileUrl(sb, f, true);
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast({ text: (e as Error).message, tone: "danger" });
    }
  };

  const toggleStar = async (f: DriveFile) => {
    if (!sb) return;
    setFiles((l) => l?.map((x) => (x.id === f.id ? { ...x, starred: !f.starred } : x)) ?? l);
    try {
      await updateFile(sb, f, { starred: !f.starred });
    } catch (e) {
      setFiles((l) => l?.map((x) => (x.id === f.id ? f : x)) ?? l);
      toast({ text: (e as Error).message, tone: "danger" });
    }
  };

  const pct = usage && usage.quota > 0 ? Math.min(100, (usage.used / usage.quota) * 100) : 0;

  return (
    <>
      <Modal
        open
        onClose={close}
        size="lg"
        title={
          <span className="inline-flex items-center gap-2">
            <HardDrive size={20} className="text-accent-text" /> 드라이브
          </span>
        }
        subtitle="나만 볼 수 있는 파일 보관함 — 신분증 사본·계약서·사진 같은 중요한 파일을 넣어 두세요."
      >
        {!signedIn ? (
          <Empty
            icon={<LogIn size={22} />}
            title="로그인하면 쓸 수 있어요"
            desc="파일은 내 계정의 서버 보관함에 저장돼서, 폰·노트북 어디서든 열 수 있어요."
            action={
              <Button variant="primary" onClick={() => openSheet("settings", "account")}>
                <LogIn size={16} /> 로그인하러 가기
              </Button>
            }
          />
        ) : (
          <div
            className={cx("relative space-y-4", drag && "rounded-2xl ring-2 ring-accent ring-offset-4 ring-offset-surface")}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
            }}
          >
            {/* 사용량 */}
            <div className="rounded-2xl bg-surface-2 p-3.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold">
                  {usage ? fmtBytes(usage.used) : "…"} <span className="font-normal text-muted">/ {usage ? fmtBytes(usage.quota) : "…"}</span>
                </span>
                <span className="text-xs text-muted">파일 {usage?.files ?? 0}개 · 하나에 최대 50MB</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
                <div className={cx("h-full rounded-full transition-all", pct > 90 ? "bg-danger" : "bg-accent")} style={{ width: `${pct}%` }} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {filter === "study" && (
                <Button variant="primary" onClick={newNote} disabled={!notes.store}>
                  <NotebookPen size={16} /> 새 노트
                </Button>
              )}
              <Button variant={filter === "study" ? "soft" : "primary"} disabled={!lockReady} onClick={() => input.current?.click()}>
                {lockOn ? <Lock size={16} /> : <Upload size={16} />} {lockOn ? "잠가서 올리기" : filter === "study" ? "Study 에 파일 올리기" : "파일 올리기"}
              </Button>
              <input
                ref={input}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void upload(e.target.files);
                  e.target.value = "";
                }}
              />
              {filter !== "study" && (
                <Button variant="soft" onClick={newNote} disabled={!notes.store} title="Study 폴더에 공부 노트 쓰기">
                  <NotebookPen size={16} /> 새 노트
                </Button>
              )}
              <span className="hidden text-xs text-faint md:inline">또는 여기로 끌어다 놓기</span>
              {(files?.length ?? 0) > 5 && (
                <label className="relative ml-auto block w-full sm:w-56">
                  <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름으로 찾기" className={cx(inputCls, "h-10 pl-9 text-sm")} />
                </label>
              )}
            </div>

            <div className="rounded-2xl border border-line px-3.5 py-1.5">
              <Switch
                checked={lockOn}
                onChange={setLockOn}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <Lock size={14} /> 비밀번호 걸어서 올리기
                  </span>
                }
                desc="이 기기에서 잠근 뒤 올려서 서버에는 알아볼 수 없는 암호문만 남아요 — 운영자도 내용을 못 봐요. 열 때 비밀번호가 필요해요."
              />
              {lockOn && (
                <div className="space-y-2 pb-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                      placeholder={`비밀번호 (${MIN_PASSWORD}자 이상)`}
                      aria-label="잠글 비밀번호"
                      className={inputCls}
                    />
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={pw2}
                      onChange={(e) => setPw2(e.target.value)}
                      placeholder="비밀번호 한 번 더"
                      aria-label="비밀번호 확인"
                      className={inputCls}
                    />
                  </div>
                  {pw.length > 0 && pw.length < MIN_PASSWORD && (
                    <p className="text-xs font-semibold text-danger">{MIN_PASSWORD}자 이상으로 해 주세요.</p>
                  )}
                  {pw2.length > 0 && pw !== pw2 && <p className="text-xs font-semibold text-danger">두 비밀번호가 달라요.</p>}
                  <p className="rounded-xl bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn">
                    비밀번호를 잊으면 <b>누구도(운영자도) 열 수 없어요</b> — 되찾는 방법이 없으니 꼭 기억할 수 있는 걸로 하세요. 파일 이름·크기는
                    잠기지 않아요.
                  </p>
                </div>
              )}
            </div>

            {files !== null && (
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <Chip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>
                    {f.label}
                  </Chip>
                ))}
              </div>
            )}

            {uploads.length > 0 && (
              <ul className="space-y-2">
                {uploads.map((u) => (
                  <li key={u.key} className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-sm">
                      <Upload size={15} className={u.error ? "text-danger" : "text-accent-text"} />
                      <span className="min-w-0 flex-1 truncate font-semibold">{u.name}</span>
                      {u.error ? (
                        <IconButton label="닫기" className="size-7" onClick={() => setUploads((l) => l.filter((x) => x.key !== u.key))}>
                          <X size={15} />
                        </IconButton>
                      ) : (
                        <span className="font-mono text-xs text-muted tabular-nums">{Math.round(u.progress * 100)}%</span>
                      )}
                    </div>
                    {u.error ? (
                      <p className="mt-1 text-xs font-semibold text-danger">{u.error}</p>
                    ) : (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(3, u.progress * 100)}%` }} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {err && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{err}</p>}

            {!files ? (
              !err && <p className="py-10 text-center text-sm text-muted">불러오는 중…</p>
            ) : filter === "study" && list.length === 0 && !q.trim() ? (
              <Empty
                icon={<NotebookPen size={22} />}
                title="Study 폴더가 비어 있어요"
                desc="‘새 노트’로 오늘 공부한 내용을 적으면 여기 저장돼요. 타이머 화면의 공부 노트 + 버튼도 같은 곳에 저장해요."
              />
            ) : files.length === 0 ? (
              <Empty
                icon={<HardDrive size={22} />}
                title="아직 파일이 없어요"
                desc="‘파일 올리기’로 중요한 파일을 넣어 두면 폰·노트북 어디서든 열 수 있어요. 나만 볼 수 있어요."
              />
            ) : list.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">맞는 파일이 없어요.</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
                {list.map((f) => (
                  <FileRow
                    key={f.id}
                    f={f}
                    onOpen={() => void open(f)}
                    onStar={() => void toggleStar(f)}
                    onDownload={() => void download(f)}
                    onRename={() => setRenaming(f)}
                    onDelete={() => setDeleting(f)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>

      {preview && (
        <Modal open onClose={closePreview} size="xl" title={<span className="break-all">{preview.f.filename}</span>} subtitle={`${fmtBytes(preview.f.size)} · ${fmtDay(preview.f.created_at)}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 서명된 임시 주소라 next/image 를 못 쓴다 */}
          <img src={preview.url} alt={preview.f.filename} className="mx-auto max-h-[65dvh] w-auto rounded-xl object-contain" />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => {
                if (!preview.local) return void download(preview.f);
                const a = document.createElement("a");
                a.href = preview.url;
                a.download = preview.f.filename;
                a.click();
              }}
            >
              <Download size={16} /> 내려받기
            </Button>
          </div>
        </Modal>
      )}

      {noteId && notes.store && <NoteEditor store={notes.store} id={noteId} signedIn={notes.signedIn} onClose={closeNote} />}

      {unlocking && (
        <UnlockDialog
          f={unlocking.f}
          needWindow={unlocking.mode === "open" && viewable(unlocking.f)}
          onClose={() => setUnlocking(null)}
          onUnlock={async (password, w) => {
            await unlockAndShow(unlocking.f, unlocking.mode, password, w);
            setUnlocking(null);
          }}
        />
      )}

      {renaming && sb && (
        <RenameDialog
          f={renaming}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            const f = await updateFile(sb, renaming, { filename: name });
            setFiles((l) => l?.map((x) => (x.id === f.id ? f : x)) ?? l);
            setRenaming(null);
          }}
        />
      )}

      {deleting && sb && (
        <ConfirmDelete
          f={deleting}
          onClose={() => setDeleting(null)}
          onDelete={async () => {
            await removeFile(sb, deleting);
            setFiles((l) => l?.filter((x) => x.id !== deleting.id) ?? l);
            setDeleting(null);
            setPreview(null);
            refreshUsage();
          }}
        />
      )}
    </>
  );
}

function FileRow({
  f,
  onOpen,
  onStar,
  onDownload,
  onRename,
  onDelete,
}: {
  f: DriveFile;
  onOpen: () => void;
  onStar: () => void;
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const k = KIND_ICON[fileKind(f)];
  const Icon = k.icon;
  return (
    <li className="flex items-center gap-1 bg-surface-2/40 pr-1.5 transition hover:bg-surface-2">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left">
        <span className={cx("relative grid size-10 shrink-0 place-items-center rounded-xl", k.tint)}>
          <Icon size={19} />
          {f.locked && (
            <span className="absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full bg-surface text-warn ring-1 ring-line">
              <Lock size={10} strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{f.filename}</span>
          <span className="block truncate text-xs text-muted">
            {f.folder && `${f.folder} · `}
            {f.locked && "잠김 · "}
            {fmtBytes(f.size)} · {fmtShort(f.folder === STUDY_FOLDER ? f.updated_at : f.created_at)}
          </span>
        </span>
      </button>
      <IconButton label={f.starred ? "중요 표시 빼기" : "중요 표시"} className="size-8 sm:size-9" onClick={onStar}>
        <Star size={17} className={f.starred ? "fill-warn text-warn" : undefined} />
      </IconButton>
      <IconButton label="내려받기" className="size-8 sm:size-9" onClick={onDownload}>
        <Download size={17} />
      </IconButton>
      <IconButton label="이름 바꾸기" className="size-8 sm:size-9" onClick={onRename}>
        <Pencil size={16} />
      </IconButton>
      <IconButton label="지우기" className="size-8 hover:text-danger sm:size-9" onClick={onDelete}>
        <Trash2 size={16} />
      </IconButton>
    </li>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="sm" title={title}>
      {children}
    </Modal>
  );
}

function RenameDialog({ f, onClose, onSave }: { f: DriveFile; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(f.filename);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog title="이름 바꾸기" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          setErr(null);
          onSave(name)
            .catch((x: Error) => setErr(x.message))
            .finally(() => setBusy(false));
        }}
      >
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={255} className={inputCls} />
        {err && <p className="text-sm font-semibold text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" disabled={busy || !name.trim()}>
            저장
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ConfirmDelete({ f, onClose, onDelete }: { f: DriveFile; onClose: () => void; onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog title="파일 지우기" onClose={onClose}>
      <p className="text-sm leading-relaxed text-muted">
        <b className="break-all text-fg">{f.filename}</b> 을(를) 지워요. 되돌릴 수 없어요.
      </p>
      {err && <p className="mt-2 text-sm font-semibold text-danger">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          취소
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setErr(null);
            onDelete()
              .catch((x: Error) => setErr(x.message))
              .finally(() => setBusy(false));
          }}
        >
          <Trash2 size={16} /> 지우기
        </Button>
      </div>
    </Dialog>
  );
}

function UnlockDialog({
  f,
  needWindow,
  onClose,
  onUnlock,
}: {
  f: DriveFile;
  needWindow: boolean;
  onClose: () => void;
  onUnlock: (password: string, w: Window | null) => Promise<void>;
}) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog title="잠긴 파일 열기" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pw) return;
          // 팝업 차단을 피하려고 창은 누른 순간에 먼저 연다
          const w = needWindow ? window.open("", "_blank") : null;
          setBusy(true);
          setErr(null);
          onUnlock(pw, w)
            .catch((x: Error) => {
              w?.close();
              setErr(x instanceof WrongPassword ? "비밀번호가 틀렸어요." : x.message);
            })
            .finally(() => setBusy(false));
        }}
      >
        <p className="flex items-start gap-2 text-sm leading-relaxed text-muted">
          <Lock size={16} className="mt-0.5 shrink-0 text-warn" />
          <span>
            <b className="break-all text-fg">{f.filename}</b> 은(는) 비밀번호로 잠겨 있어요. 올릴 때 정한 비밀번호를 넣어 주세요.
          </span>
        </p>
        <input
          autoFocus
          type="password"
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="비밀번호"
          aria-label="파일 비밀번호"
          className={inputCls}
        />
        {err && <p className="text-sm font-semibold text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" disabled={busy || !pw}>
            {busy ? "푸는 중…" : "열기"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
