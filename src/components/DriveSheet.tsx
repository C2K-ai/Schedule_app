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
  LogIn,
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
  listFiles,
  MAX_FILE,
  removeFile,
  updateFile,
  uploadFile,
  type DriveFile,
  type DriveUsage,
  type FileKind,
} from "@/lib/drive";
import { getSupabase } from "@/lib/supabase";
import { usePlanner } from "./PlannerProvider";
import { Button, Chip, cx, Empty, IconButton, inputCls, Modal } from "./ui";

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

type Filter = "all" | "starred" | "image" | "doc";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "starred", label: "★ 중요" },
  { value: "image", label: "사진" },
  { value: "doc", label: "문서" },
];

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
  const { openSheet, session, toast } = usePlanner();
  const sb = getSupabase();
  const close = () => openSheet(null);
  const signedIn = Boolean(sb && session.userId);

  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [usage, setUsage] = useState<DriveUsage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<{ f: DriveFile; url: string } | null>(null);
  const [renaming, setRenaming] = useState<DriveFile | null>(null);
  const [deleting, setDeleting] = useState<DriveFile | null>(null);
  const input = useRef<HTMLInputElement>(null);

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
  }, [sb, signedIn]);

  const refreshUsage = () => sb && void driveUsage(sb).then(setUsage, () => {});

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (files ?? []).filter((f) => {
      if (s && !f.filename.toLowerCase().includes(s)) return false;
      if (filter === "starred") return f.starred;
      if (filter === "image") return fileKind(f) === "image";
      if (filter === "doc") return ["pdf", "doc", "sheet"].includes(fileKind(f));
      return true;
    });
  }, [files, q, filter]);

  const upload = async (picked: FileList | File[]) => {
    if (!sb) return;
    const arr = Array.from(picked);
    for (const file of arr) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      const set = (patch: Partial<Upload>) => setUploads((l) => l.map((u) => (u.key === key ? { ...u, ...patch } : u)));
      setUploads((l) => [...l, { key, name: file.name, progress: 0 }]);
      if (file.size > MAX_FILE) {
        set({ error: `${fmtBytes(file.size)} — 파일 하나는 50MB 까지예요` });
        continue;
      }
      try {
        const f = await uploadFile(sb, file, (p) => set({ progress: p }));
        setFiles((l) => [f, ...(l ?? [])]);
        setUploads((l) => l.filter((u) => u.key !== key));
      } catch (e) {
        set({ error: (e as Error).message });
      }
    }
    refreshUsage();
  };

  const open = async (f: DriveFile) => {
    if (!sb) return;
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
              <Button variant="primary" onClick={() => input.current?.click()}>
                <Upload size={16} /> 파일 올리기
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
              <span className="hidden text-xs text-faint md:inline">또는 여기로 끌어다 놓기</span>
              {(files?.length ?? 0) > 5 && (
                <label className="relative ml-auto block w-full sm:w-56">
                  <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름으로 찾기" className={cx(inputCls, "h-10 pl-9 text-sm")} />
                </label>
              )}
            </div>

            {(files?.length ?? 0) > 0 && (
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
        <Modal open onClose={() => setPreview(null)} size="xl" title={<span className="break-all">{preview.f.filename}</span>} subtitle={`${fmtBytes(preview.f.size)} · ${fmtDay(preview.f.created_at)}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 서명된 임시 주소라 next/image 를 못 쓴다 */}
          <img src={preview.url} alt={preview.f.filename} className="mx-auto max-h-[65dvh] w-auto rounded-xl object-contain" />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button onClick={() => void download(preview.f)}>
              <Download size={16} /> 내려받기
            </Button>
          </div>
        </Modal>
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
            toast({ text: "지웠어요", tone: "ok" });
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
        <span className={cx("grid size-10 shrink-0 place-items-center rounded-xl", k.tint)}>
          <Icon size={19} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{f.filename}</span>
          <span className="block truncate text-xs text-muted">
            {fmtBytes(f.size)} · {fmtShort(f.created_at)}
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
