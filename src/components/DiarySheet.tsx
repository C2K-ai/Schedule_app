"use client";

// DREAM 일기 — 화면 가득 크림색 줄 공책 한 장(여는 애니메이션이 끝나는 종이와 같은 모양).
// 글·기분은 이 기기에서 잠가 저장·동기화한다(lib/diary.ts) — 화면은 store.diary 만 부른다.
// 받아쓰기(VoiceAdd·lib/speech.ts)는 일부러 붙이지 않는다: 말소리가 구글 서버로 가서 '아무도 못 읽는 일기'가 깨진다.

import { ChevronLeft, ChevronRight, List, Search, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { diaryList, diaryLockedCount, diaryOn, type DiaryEntry, type DiaryState, type UnlockResult } from "@/lib/diary";
import { activitiesOnDay, isSomeday } from "@/lib/planner";
import { getSupabase } from "@/lib/supabase";
import { addDays, dayKey, fmtTime, parseDayKey, uuid, WEEKDAYS } from "@/lib/time";
import { useMedia } from "@/lib/useMedia";
import { useNow } from "@/lib/useNow";
import { friendly } from "./AuthForm";
import { MOODS } from "./CalendarTab";
import { DiaryIntro } from "./DiaryIntro";
import { usePlanner } from "./PlannerProvider";
import { cx, useLayer } from "./ui";

const LOCK_LINE = "🔒 이 기기에서 잠근 뒤 올려요. 서버·운영자는 내용을 볼 수 없고, 로그인 비밀번호로만 열려요.";
const DEVICE_LOCK_LINE = "🔒 이 기기에서 잠가 이 기기에만 저장해요.";
const NOTE_LINE = "캘린더의 ‘하루 노트’와 기분은 잠기지 않는 따로 된 메모예요.";
const RESET_WORD = "새로 시작";

const UNLOCK_ERR: Partial<Record<UnlockResult, string>> = {
  wrong_password: "비밀번호가 틀렸어요. 앱에 로그인할 때 쓰는 비밀번호예요.",
  old_wrong: "바꾸기 전 비밀번호가 맞지 않아요.",
  network: "인터넷에 연결된 뒤 다시 해 주세요.",
};

type LockWhy = Extract<DiaryState, { kind: "locked" }>["why"];

const LOCKED: Record<LockWhy, { title: string; desc: string; button: string }> = {
  first_time: {
    title: "일기를 처음 켜요",
    desc: "로그인 비밀번호를 한 번 넣으면 일기 열쇠를 만들어 잠가 둬요. 다른 기기에서도 같은 비밀번호로 로그인하면 바로 열려요.",
    button: "일기 켜기",
  },
  need_password: {
    title: "일기를 열려면 로그인 비밀번호를 한 번 넣어 주세요",
    desc: "이 기기에서 한 번만 넣으면 돼요. 일기는 이 비밀번호로 잠겨 있어서 서버·운영자는 못 읽어요.",
    button: "열기",
  },
  key_changed: {
    title: "다른 기기에서 일기 열쇠가 바뀌었어요",
    desc: "지금 로그인 비밀번호를 한 번 넣으면 새 열쇠를 받아 와요. 그 전에 쓴 글은 그대로 읽을 수 있어요.",
    button: "열기",
  },
  old_password: {
    title: "일기 열쇠가 예전 비밀번호로 잠겨 있어요",
    desc: "일기가 열리는 기기(폰·PC)에서 일기를 한 번 열면 여기서도 자동으로 열려요. 아니면 아래에 두 비밀번호를 넣어 주세요.",
    button: "열기",
  },
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown } | null)?.message ?? e));
const firstLine = (body: string) => body.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * 쓰는 사이 일기가 잠기면(다른 기기에서 열쇠가 바뀜) 저장 못 한 글을 메모리에만 잠깐 맡겨 둔다 —
 * 다시 열면 그 칸에 그대로 돌아온다. 기기 저장소엔 절대 평문으로 두지 않는다.
 */
const rescued = new Map<string, string>();

/** 오른쪽 위 초승달 — 여는 장면의 'DIARY' 머리글과 같은 모양 */
function Crescent() {
  return (
    <svg viewBox="0 0 40 40" width={13} height={13} aria-hidden>
      <defs>
        <mask id="diary-moon-cut">
          <rect width="40" height="40" fill="#fff" />
          <circle cx="24.6" cy="16.6" r="10.2" fill="#000" />
        </mask>
      </defs>
      <circle cx="20" cy="21" r="12" fill="#c4943f" mask="url(#diary-moon-cut)" />
    </svg>
  );
}

function PaperCard({ title, desc, children }: { title?: string; desc?: ReactNode; children?: ReactNode }) {
  return (
    <section className="diary-card mt-6 px-5 py-5 md:px-7 md:py-6">
      {title && <h2 className="text-[17px] leading-snug font-bold md:text-[19px]">{title}</h2>}
      {desc && <p className={cx("text-[14px] leading-relaxed text-[var(--ink-mid)] md:text-[15px]", title && "mt-1.5")}>{desc}</p>}
      {children}
    </section>
  );
}

// ───────────── 비밀번호 칸 ─────────────

/** 로그인 비밀번호로 일기 열기 — 숨은 이메일 칸이 있어서 비밀번호 관리자가 한 번에 채워 준다 */
function UnlockForm({ button, two = false }: { button: string; two?: boolean }) {
  const { store, session } = usePlanner();
  const [pw, setPw] = useState("");
  const [old, setOld] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!pw || (two && !old)) return;
    setBusy(true);
    setErr(null);
    const r = await store.diary.unlock(pw, two ? { oldPassword: old } : undefined);
    setBusy(false);
    setErr(UNLOCK_ERR[r] ?? null);
  };
  return (
    <form
      className="mt-4 flex flex-col gap-2 sm:max-w-[420px]"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input type="email" name="email" autoComplete="username" value={session.email ?? ""} readOnly hidden />
      <input
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder={two ? "지금 로그인 비밀번호" : "로그인 비밀번호"}
        aria-label={two ? "지금 로그인 비밀번호" : "로그인 비밀번호"}
        className="diary-input"
      />
      {two && (
        <input
          type="password"
          name="old-password"
          autoComplete="off"
          required
          value={old}
          onChange={(e) => setOld(e.target.value)}
          placeholder="바꾸기 전 비밀번호"
          aria-label="바꾸기 전 비밀번호"
          className="diary-input"
        />
      )}
      {err && (
        <p role="alert" className="text-[13px] font-semibold text-[var(--rust)]">
          {err}
        </p>
      )}
      <div className="pt-1">
        <button className="diary-primary" disabled={busy}>
          {busy ? "일기 여는 중…" : button}
        </button>
      </div>
    </form>
  );
}

/** '비밀번호가 기억 안 나요' — 새 비밀번호 정하기 + (열쇠가 서버에 있으면) 새로 시작 */
function ForgotPanel({ hasKeyRow, lockedN }: { hasKeyRow: boolean; lockedN: number }) {
  const { store, session } = usePlanner();
  const sb = getSupabase();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rpw, setRpw] = useState("");
  const [word, setWord] = useState("");
  const [rBusy, setRBusy] = useState(false);
  const [rErr, setRErr] = useState<string | null>(null);

  const setNew = async () => {
    if (!sb) return;
    if (pw.length < 8) return setErr("비밀번호는 8자 이상이어야 해요.");
    if (pw !== pw2) return setErr("두 칸의 비밀번호가 달라요.");
    setBusy(true);
    setErr(null);
    const { error } = await store.diary.changePassword(pw, () => sb.auth.updateUser({ password: pw }));
    if (error) {
      setBusy(false);
      return setErr(friendly(errText(error)));
    }
    // 바꾼 비밀번호로 바로 열어 본다 — 열쇠가 예전 비밀번호로 잠겨 있으면 위 카드가 그에 맞는 안내로 바뀐다
    const r = await store.diary.unlock(pw);
    setBusy(false);
    setErr(UNLOCK_ERR[r] ?? null);
  };
  const restart = async () => {
    if (word.trim() !== RESET_WORD) return setRErr("확인하려면 ‘새로 시작’이라고 적어 주세요.");
    setRBusy(true);
    setRErr(null);
    const r = await store.diary.reset(rpw);
    setRBusy(false);
    setRErr(UNLOCK_ERR[r] ?? null);
  };

  return (
    <div className="mt-5 space-y-6 border-t border-[var(--rule)] pt-5">
      {hasKeyRow && (
        <p className="text-[13.5px] leading-relaxed text-[var(--ink-mid)]">
          일기가 열리는 기기(폰·PC)에서 설정 → 동기화 → 비밀번호 바꾸기로 새 비밀번호를 정한 뒤, 여기에 그 비밀번호를 넣으세요.
        </p>
      )}
      {sb && (
        <div>
          <h3 className="text-[15px] font-bold">새 비밀번호 정하기</h3>
          <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--ink-mid)]">
            일기는 로그인 비밀번호로 잠가요. 기억이 안 나면 여기서 새로 정하세요 — 다음부터 로그인도 이 비밀번호로 해요.
          </p>
          <form
            className="mt-3 flex flex-col gap-2 sm:max-w-[420px]"
            onSubmit={(e) => {
              e.preventDefault();
              void setNew();
            }}
          >
            <input type="email" name="email" autoComplete="username" value={session.email ?? ""} readOnly hidden />
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="새 비밀번호 (8자 이상)"
              aria-label="새 비밀번호"
              className="diary-input"
            />
            <input
              type="password"
              autoComplete="new-password"
              required
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              placeholder="한 번 더"
              aria-label="새 비밀번호 한 번 더"
              className="diary-input"
            />
            {err && (
              <p role="alert" className="text-[13px] font-semibold text-[var(--rust)]">
                {err}
              </p>
            )}
            <div className="pt-1">
              <button className="diary-primary" disabled={busy}>
                {busy ? "바꾸는 중…" : "새 비밀번호로 바꾸기"}
              </button>
            </div>
          </form>
        </div>
      )}
      {hasKeyRow && (
        <div className="border-t border-[var(--rule)] pt-5">
          <h3 className="text-[15px] font-bold">새로 시작</h3>
          <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--ink-mid)]">
            {lockedN > 0
              ? `지금 열 수 없는 글 ${lockedN}개는 이 기기에서 계속 잠겨 있어요. 나중에 그 글을 열 수 있는 기기에서 일기를 한 번 열면 다시 열려요.`
              : "새 열쇠로 처음부터 써요. 예전 글이 있다면, 그 글을 열 수 있는 기기에서 일기를 한 번 열면 다시 열려요."}
          </p>
          <form
            className="mt-3 flex flex-col gap-2 sm:max-w-[420px]"
            onSubmit={(e) => {
              e.preventDefault();
              void restart();
            }}
          >
            <input type="email" name="email" autoComplete="username" value={session.email ?? ""} readOnly hidden />
            <input
              type="password"
              autoComplete="current-password"
              required
              value={rpw}
              onChange={(e) => setRpw(e.target.value)}
              placeholder="지금 로그인 비밀번호"
              aria-label="지금 로그인 비밀번호"
              className="diary-input"
            />
            <input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder={RESET_WORD}
              aria-label="확인하려면 ‘새로 시작’이라고 적어 주세요"
              autoComplete="off"
              className="diary-input"
            />
            <p className="text-[12.5px] text-[var(--ink-mid)]">확인하려면 ‘새로 시작’이라고 적어 주세요</p>
            {rErr && (
              <p role="alert" className="text-[13px] font-semibold text-[var(--rust)]">
                {rErr}
              </p>
            )}
            <div className="pt-1">
              <button className="diary-primary is-danger" disabled={rBusy || !rpw || word.trim() !== RESET_WORD}>
                {rBusy ? "잠시만요…" : "새로 시작"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function LockedCard({ why, lockedN }: { why: LockWhy; lockedN: number }) {
  const [forgot, setForgot] = useState(false);
  const c = LOCKED[why];
  return (
    <PaperCard title={c.title} desc={c.desc}>
      <UnlockForm key={why} button={c.button} two={why === "old_password"} />
      <button
        type="button"
        aria-expanded={forgot}
        onClick={() => setForgot((v) => !v)}
        className="mt-4 text-[13px] font-semibold text-[var(--ink-mid)] underline decoration-[var(--skin-line)] underline-offset-4 hover:text-[var(--ink)]"
      >
        비밀번호가 기억 안 나요
      </button>
      {forgot && <ForgotPanel hasKeyRow={why !== "first_time"} lockedN={lockedN} />}
    </PaperCard>
  );
}

/** 이 기기 열쇠가 서버에 아직 없음 — 비밀번호를 한 번 넣으면 다른 기기에서도 열린다 */
function PublishLine() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-2xl border border-[var(--skin-line)] bg-[var(--skin)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-[var(--ink-mid)]">
          다른 기기에서도 열리게 하려면 로그인 비밀번호를 한 번 넣어 주세요.
        </p>
        {!open && (
          <button type="button" className="diary-btn is-small" onClick={() => setOpen(true)}>
            비밀번호 넣기
          </button>
        )}
      </div>
      {open && <UnlockForm button="비밀번호 넣기" />}
    </div>
  );
}

// ───────────── 글 한 편 ─────────────

function EntryEditor({
  entry,
  id,
  day,
  cloud,
  big,
  autoFocus,
  placeholder,
  onMoved,
  onDeleted,
}: {
  entry: DiaryEntry | undefined;
  /** 이 칸이 쓰는 글 id — 새 칸이면 미리 만든 id */
  id: string;
  day: string;
  cloud: boolean;
  big: boolean;
  autoFocus: boolean;
  placeholder: string;
  /** 쓰는 사이 다른 곳에서 바뀌어 내 글이 새 글(사본)로 갔을 때 */
  onMoved: (id: string) => void;
  onDeleted: () => void;
}) {
  const { store } = usePlanner();
  const rescueKey = `${day}:${entry ? id : "new"}`;
  // 고치는 중일 때만 내 글(draft)을 보여 주고, 아니면 늘 저장된 글 — 다른 기기에서 고친 글이 그대로 보인다
  const [draft, setDraft] = useState<string | null>(() => rescued.get(rescueKey) ?? null);
  const [typing, setTyping] = useState(false);
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<null | "too_long" | "locked">(null);
  const [asking, setAsking] = useState(false);
  const draftRef = useRef<string | null>(draft);
  /** 처음 고치기 시작할 때(또는 마지막 저장 때) 본 글 — 그새 다른 곳에서 바뀌었는지 엔진이 가른다 */
  const baseRef = useRef<{ body: string } | null>(null);
  const timer = useRef<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const entryRef = useRef(entry);
  useEffect(() => {
    entryRef.current = entry;
  });

  /** 칸의 글 저장 — 못 하면(너무 긺·잠김) 글은 칸에 그대로 둔다 */
  const commit = (): boolean => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setTyping(false);
    const d = draftRef.current;
    if (d === null) return true;
    const r = store.diary.save({ id, day, body: d, base: baseRef.current ?? { body: entryRef.current?.body ?? "" } });
    if (!r.ok) {
      setProblem(r.error);
      if (r.error === "locked") rescued.set(rescueKey, d);
      return false;
    }
    rescued.delete(rescueKey);
    setProblem(null);
    if (r.id !== id) {
      // 쓰는 사이 다른 기기에서 이 글을 고치거나 지웠다 — 내 글은 새 글로 남았고 이어 쓰기도 그쪽에서
      draftRef.current = null;
      baseRef.current = null;
      setDraft(null);
      onMoved(r.id);
      return true;
    }
    baseRef.current = { body: d };
    return true;
  };
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  // 다른 날로 넘기거나 일기를 닫을 때 쓰던 글 저장
  useEffect(() => {
    const latest = commitRef;
    return () => {
      latest.current();
      store.diary.flushSoon();
    };
  }, [store]);

  const value = draft ?? entry?.body ?? "";

  // 글 길이만큼 칸이 늘어난다(칸 안 스크롤 없이 종이째 내려감) — 쓴 줄 아래 빈 줄 하나는 늘 남긴다
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    const fit = () => {
      const sc = el.closest<HTMLElement>("[data-diary-scroll]");
      const top = sc?.scrollTop ?? 0;
      const gap = parseFloat(getComputedStyle(el).lineHeight) || 32;
      el.style.minHeight = "0px";
      el.style.height = "0px";
      const content = el.scrollHeight;
      el.style.minHeight = "";
      el.style.height = `${content + gap}px`;
      if (sc) sc.scrollTop = top;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value]);

  // PC 에서만 바로 쓸 수 있게 — 폰은 자판이 화면을 가려서 누를 때 연다
  useEffect(() => {
    if (!autoFocus) return;
    const el = taRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  useLayer(asking, () => setAsking(false));

  const pickMood = (v: number) => {
    commit();
    const cur = entryRef.current?.mood ?? null;
    const r = store.diary.save({ id, day, mood: cur === v ? null : v });
    if (!r.ok) return setProblem(r.error);
    setTouched(true);
    if (r.id !== id) onMoved(r.id);
  };

  const remove = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    draftRef.current = null;
    baseRef.current = null;
    setDraft(null);
    rescued.delete(rescueKey);
    setAsking(false);
    if (store.diary.remove(id)) onDeleted();
  };

  const status = typing
    ? "입력 중…"
    : problem === "too_long"
      ? ""
      : entry?.err
        ? `못 올림 — ${entry.err}`
        : entry?.dirty
          ? cloud
            ? "올리는 중"
            : "저장 중…"
          : touched && entry
            ? "저장됨"
            : "";

  return (
    <div className="mt-0.5">
      <div className="diary-line flex items-center gap-1">
        <div role="group" aria-label="기분" className="-ml-1.5 flex items-center">
          {MOODS.map((m) => {
            const on = entry?.mood === m.v;
            return (
              <button
                key={m.v}
                type="button"
                title={m.label}
                aria-label={`기분: ${m.label}`}
                aria-pressed={on}
                onClick={() => pickMood(m.v)}
                className={cx(
                  "grid size-8 place-items-center rounded-full text-[19px] leading-none transition md:size-9 md:text-[21px]",
                  on ? "scale-110 bg-[rgba(196,148,63,0.2)]" : "opacity-40 grayscale-[60%] hover:opacity-100 hover:grayscale-0",
                )}
              >
                {m.e}
              </button>
            );
          })}
        </div>
        <span
          aria-live="polite"
          className={cx("ml-auto min-w-0 truncate text-[12px]", entry?.err ? "text-[var(--rust)]" : "text-[var(--ink-soft)]")}
        >
          {status}
        </span>
        {entry && (
          <button type="button" aria-label="이 글 지우기" title="이 글 지우기" onClick={() => setAsking(true)} className="diary-nav shrink-0">
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {asking && (
        <div role="alertdialog" aria-label="일기를 지울까요?" className="diary-card mt-3 mb-1 px-4 py-4">
          <p className="font-bold">일기를 지울까요?</p>
          <p className="mt-1 text-[13.5px] text-[var(--ink-mid)]">모든 기기에서 사라지고 되돌릴 수 없어요.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="diary-primary is-danger is-small" onClick={remove}>
              지우기
            </button>
            <button type="button" className="diary-btn" onClick={() => setAsking(false)}>
              취소
            </button>
          </div>
        </div>
      )}

      <textarea
        ref={taRef}
        value={value}
        maxLength={20000}
        rows={1}
        aria-label="일기 내용"
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          if (draftRef.current === null) baseRef.current = { body: entryRef.current?.body ?? "" };
          draftRef.current = v;
          setDraft(v);
          setTyping(true);
          setTouched(true);
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => commitRef.current(), 700);
        }}
        onBlur={() => {
          if (commit()) {
            draftRef.current = null;
            baseRef.current = null;
            setDraft(null);
          }
          store.diary.flushSoon();
        }}
        className={cx("diary-lines", big ? "min-h-[max(calc(var(--gap)*8),calc(100dvh-330px))]" : "min-h-[calc(var(--gap)*3)]")}
      />
      {problem === "too_long" && (
        <p role="alert" className="mt-1 text-[13px] font-semibold text-[var(--rust)]">
          너무 길어요 — 2만 자까지 쓸 수 있어요.
        </p>
      )}
      {problem === "locked" && (
        <p role="alert" className="mt-1 text-[13px] font-semibold text-[var(--rust)]">
          일기가 잠겨서 지금은 저장하지 못했어요 — 다시 열면 이 글이 그대로 돌아와요.
        </p>
      )}
    </div>
  );
}

function LockedEntry() {
  return (
    <div className="diary-card mt-3 px-4 py-3.5 text-[14px] leading-relaxed text-[var(--ink-mid)]">
      🔒 이 기기에서 아직 못 여는 글이에요. 이 글을 쓴 기기에서 일기를 한 번 열면 여기서도 열려요.
    </div>
  );
}

/** 그날 글들 — 날짜마다 새로 그린다(새 칸 id 도 날짜마다 새로) */
function DayEntries({ day, isToday, focusFirst }: { day: string; isToday: boolean; focusFirst: boolean }) {
  const { snap } = usePlanner();
  const [newId, setNewId] = useState(() => uuid());
  const [focusId, setFocusId] = useState<string | null>(null);
  const entries = diaryOn(snap.diary, day);
  const cloud = snap.diary.mode === "cloud";
  // 글이 없으면 빈 새 칸 하나 — 첫 저장 때 같은 id 로 글이 생겨서 칸이 그대로 이어진다(같은 key)
  const items: { id: string; entry: DiaryEntry | undefined }[] = entries.length
    ? entries.map((e) => ({ id: e.id, entry: e }))
    : [{ id: newId, entry: undefined }];
  const firstOpen = items.find((it) => !it.entry?.locked)?.id ?? null;
  const want = focusId ?? (focusFirst ? firstOpen : null);
  return (
    <>
      {entries.length >= 2 && (
        <p className="mt-3 rounded-2xl border border-[var(--skin-line)] bg-[var(--skin)] px-4 py-2.5 text-[13px] leading-relaxed text-[var(--ink-mid)]">
          이 날 글이 {entries.length}개예요 — 두 기기에서 따로 써서 둘 다 남겼어요. 필요하면 합치고 하나를 지우세요.
        </p>
      )}
      {items.map((it) =>
        it.entry?.locked ? (
          <LockedEntry key={it.id} />
        ) : (
          <EntryEditor
            key={it.id}
            id={it.id}
            entry={it.entry}
            day={day}
            cloud={cloud}
            big={items.length === 1}
            autoFocus={want === it.id}
            placeholder={isToday ? "오늘 하루를 적어 보세요" : "이날 하루를 적어 보세요"}
            onMoved={setFocusId}
            onDeleted={() => setNewId(uuid())}
          />
        ),
      )}
    </>
  );
}

// ───────────── 그날 기록(읽기 전용) ─────────────

function RecordRow({ mark, tone, title, meta }: { mark: string; tone: string; title: string; meta?: string }) {
  return (
    <li className="diary-line flex items-end gap-2.5 pb-[5px] text-[14px] md:text-[15px]">
      <span className={cx("w-4 shrink-0 text-center font-bold", tone)} aria-hidden>
        {mark}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {meta && <span className="shrink-0 text-[12px] text-[var(--ink-soft)] tabular-nums">{meta}</span>}
    </li>
  );
}

function DayRecord({ day }: { day: string }) {
  const { tasks, activities } = usePlanner();
  const done = tasks
    .filter((t) => t.status === "done" && t.completed_at && dayKey(new Date(t.completed_at)) === day)
    .sort((a, b) => (a.completed_at ?? "").localeCompare(b.completed_at ?? ""));
  const did = activitiesOnDay(activities, day);
  const missed = tasks
    .filter((t) => (t.status === "missed" || t.status === "skipped") && !isSomeday(t) && dayKey(new Date(t.starts_at)) === day)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (!done.length && !did.length && !missed.length) return null;
  return (
    <section className="mt-12" aria-label="그날 기록">
      <p className="text-[12px] font-bold tracking-[0.18em] text-[var(--gold-text)]">그날 기록</p>
      <ul className="mt-1 text-[var(--ink-mid)]">
        {done.map((t) => (
          <RecordRow key={t.id} mark="✓" tone="text-[#4f7a3a]" title={t.title} meta={`끝냄 ${fmtTime(t.completed_at!)}`} />
        ))}
        {did.map((a) => (
          <RecordRow
            key={a.id}
            mark="●"
            tone="text-[9px] leading-[22px] text-[#2c7a72]"
            title={a.title}
            meta={a.starts_at ? `한 일 ${fmtTime(a.starts_at)}${a.ends_at ? `–${fmtTime(a.ends_at)}` : ""}` : "한 일"}
          />
        ))}
        {missed.map((t) => (
          <RecordRow key={t.id} mark="–" tone="text-[var(--rust)]" title={t.title} meta={t.status === "skipped" ? "건너뜀" : "못 함"} />
        ))}
      </ul>
    </section>
  );
}

// ───────────── 지난 일기 ─────────────

function PastList({
  day,
  month,
  setMonth,
  onPick,
}: {
  day: string;
  month: string;
  setMonth: (m: string) => void;
  onPick: (day: string) => void;
}) {
  const { snap } = usePlanner();
  const all = useMemo(() => diaryList(snap.diary), [snap.diary]);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const rows = query ? all.filter((e) => !e.locked && e.body.toLowerCase().includes(query)) : all.filter((e) => e.day.startsWith(month));
  const [yy, mm] = month.split("-").map(Number);
  const year = parseDayKey(day).getFullYear();
  const move = (n: number) => setMonth(monthKey(new Date(yy, mm - 1 + n, 1)));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cx("flex items-center", query && "opacity-40")}>
        <button type="button" className="diary-nav" aria-label="이전 달" disabled={!!query} onClick={() => move(-1)}>
          <ChevronLeft size={18} />
        </button>
        <p className="min-w-[108px] text-center text-[14px] font-bold tabular-nums">
          {yy}년 {mm}월
        </p>
        <button type="button" className="diary-nav" aria-label="다음 달" disabled={!!query} onClick={() => move(1)}>
          <ChevronRight size={18} />
        </button>
      </div>
      <label className="relative mt-3 block">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--ink-soft)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="일기에서 찾기"
          aria-label="일기에서 찾기"
          enterKeyHint="search"
          autoComplete="off"
          className="diary-input is-search"
        />
        {q && (
          <button
            type="button"
            aria-label="찾기 지우기"
            onClick={() => setQ("")}
            className="diary-nav absolute top-1/2 right-1.5 -translate-y-1/2"
          >
            <X size={14} />
          </button>
        )}
      </label>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-[var(--ink-mid)]">
          {all.length === 0 ? "아직 쓴 일기가 없어요." : query ? "찾는 글이 없어요." : "이 달엔 쓴 일기가 없어요."}
        </p>
      ) : (
        <ul className="-mx-1 mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-6">
          {rows.map((e) => {
            const d = parseDayKey(e.day);
            const mood = e.mood ? MOODS[e.mood - 1]?.e : null;
            const line = e.locked ? "🔒 아직 못 여는 글" : firstLine(e.body);
            return (
              <li key={e.id}>
                <button type="button" onClick={() => onPick(e.day)} className={cx("diary-row is-stack", e.day === day && "is-on")}>
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-bold tabular-nums">
                      {d.getFullYear() !== year && `${d.getFullYear()}년 `}
                      {d.getMonth() + 1}월 {d.getDate()}일 <span className="font-medium text-[var(--ink-soft)]">{WEEKDAYS[d.getDay()]}</span>
                    </span>
                    {mood && (
                      <span className="ml-auto text-[15px] leading-none" aria-hidden>
                        {mood}
                      </span>
                    )}
                  </span>
                  <span className={cx("truncate text-[13px]", line ? "text-[var(--ink-mid)]" : "text-[var(--ink-soft)]")}>
                    {line || "기분만 남긴 날"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ───────────── 본문(상태별) ─────────────

function DiaryBody({ day, isToday, focusFirst }: { day: string; isToday: boolean; focusFirst: boolean }) {
  const { snap, openSheet } = usePlanner();
  const d = snap.diary;
  const st = d.state;
  if (st.kind === "off")
    return (
      <PaperCard title="로그인하면 일기를 쓸 수 있어요" desc="일기는 폰·PC 어디서나 이어서 쓰도록 계정에 잠가서 저장해요.">
        <button type="button" className="diary-primary mt-4" onClick={() => openSheet("settings", "account")}>
          로그인하러 가기
        </button>
      </PaperCard>
    );
  if (st.kind === "unsupported")
    return <PaperCard desc="이 브라우저에선 일기를 잠글 수 없어요. 주소가 https:// 로 시작하는지, 시크릿 창이 아닌지 확인해 주세요." />;
  if (st.kind === "loading")
    return (
      <p className="diary-line flex items-end pb-[5px] text-[15px] text-[var(--ink-mid)]" aria-live="polite">
        일기 여는 중…
      </p>
    );
  if (st.kind === "locked") return <LockedCard key={st.why} why={st.why} lockedN={diaryLockedCount(d)} />;
  return (
    <>
      {st.repair === "rewrap" && (
        <PaperCard
          title="다른 기기에서 일기가 안 열려요"
          desc="다른 기기에서 비밀번호를 새로 정해서 그래요. 지금 로그인 비밀번호를 한 번 넣으면 폰·PC 모두 열려요."
        >
          <UnlockForm button="비밀번호 넣기" />
        </PaperCard>
      )}
      {st.repair === "publish" && <PublishLine />}
      <DayEntries key={day} day={day} isToday={isToday} focusFirst={focusFirst} />
    </>
  );
}

function DiaryFooter() {
  const { snap, openSheet } = usePlanner();
  const d = snap.diary;
  const weak = d.state.kind === "ready" && d.state.weak;
  return (
    <footer className="mt-12 space-y-1.5 text-[12px] leading-relaxed text-[var(--ink-mid)] md:text-[12.5px]">
      {weak && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[var(--skin-line)] bg-[var(--skin)] px-4 py-3 text-[13px]">
          <p className="min-w-0 flex-1">로그인 비밀번호가 짧으면 시간을 들여 풀어낼 수도 있어요. 10자 이상(글자+숫자)으로 바꾸면 더 안전해요.</p>
          <button type="button" className="diary-btn is-small" onClick={() => openSheet("settings", "account")}>
            비밀번호 바꾸기
          </button>
        </div>
      )}
      <p>{d.mode === "device" ? DEVICE_LOCK_LINE : LOCK_LINE}</p>
      <p>{NOTE_LINE}</p>
    </footer>
  );
}

// ───────────── 일기 화면 ─────────────

function DiaryPage() {
  const p = usePlanner();
  const { store, snap, settings } = p;
  const now = useNow(60_000);
  const [openedOn] = useState(() => dayKey(new Date()));
  const nowKey = dayKey(new Date(now));
  const today = nowKey > openedOn ? nowKey : openedOn;
  const [day, setDay] = useState(openedOn);
  const [listMonth, setListMonth] = useState(() => openedOn.slice(0, 7));
  const [phase, setPhase] = useState<"open" | "shown" | "close">("open");
  // 덮는 책이 화면을 다 가리면 이 화면은 숨긴다 — 책이 사라질 때 밑에 앱이 비쳐 보이게
  const [covered, setCovered] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const sideList = useMedia("(min-width: 1400px)");
  const desktop = useMedia("(min-width: 768px) and (pointer: fine)");

  // 처음 열 때만 바로 쓸 수 있게(PC) — 날짜를 넘긴 뒤엔 누른 단추에 초점을 둔다(키보드로 계속 넘길 수 있게)
  const [moved, setMoved] = useState(false);
  const goDay = (k: string) => {
    setDay(k);
    setListMonth(k.slice(0, 7));
    setMoved(true);
  };
  const shift = (n: number) => goDay(dayKey(addDays(parseDayKey(day), n)));
  const close = () => setPhase("close");

  // Esc — 위에 뜬 것(지울까요·목록)부터, 아니면 책을 덮으며 닫는다
  useLayer(true, close);
  useLayer(listOpen && !sideList, () => setListOpen(false));

  // 열 때 준비가 안 됐으면 열쇠·글을 다시 맞추고, 닫힐 때 쓴 글을 바로 올린다
  useEffect(() => {
    if (store.diary.snapshot().state.kind !== "ready") void store.diary.refresh();
    return () => store.diary.flushSoon();
  }, [store]);

  const date = parseDayKey(day);
  const pick = (k: string) => {
    goDay(k);
    setListOpen(false);
  };
  const showList = snap.diary.state.kind !== "off";
  // 날짜 넘기기는 일기가 열렸을 때만(잠겨 있으면 어느 날이든 같은 안내)
  const ready = snap.diary.state.kind === "ready";

  return (
    <div role="dialog" aria-modal="true" aria-label="일기" className={cx("diary-paper fixed inset-0 z-[60]", phase === "close" && covered && "invisible")}>
      <div data-diary-scroll className="absolute inset-0 overflow-y-auto overscroll-contain">
        {/* 오른쪽 위 — 목록·닫기(스크롤해도 그 자리). 효과음은 설정에서만(사용자 요청) */}
        <div className="pointer-events-none sticky top-0 z-10 flex h-0 items-start justify-end">
          <div className="pointer-events-auto flex items-center gap-2 pt-[max(14px,calc(env(safe-area-inset-top)+8px))] pr-[14px]">
            {showList && !sideList && (
              <button type="button" className="diary-btn is-bar" aria-expanded={listOpen} onClick={() => setListOpen(true)}>
                <List size={16} /> 목록
              </button>
            )}
            <button type="button" className="diary-icon" aria-label="닫기" title="닫기" onClick={close}>
              <X size={19} />
            </button>
          </div>
        </div>

        <div className="diary-grid min-h-full">
          <main className="diary-col pb-[max(36px,env(safe-area-inset-bottom))]">
            <header className="pt-[62px] md:pt-[78px]">
              <div className="flex items-center gap-2">
                <p className="diary-eyebrow flex items-center gap-2">
                  <Crescent /> Diary
                </p>
                <div className={cx("ml-auto flex items-center gap-0.5", !ready && "invisible")}>
                  <button type="button" className="diary-nav" aria-label="전날" onClick={() => shift(-1)}>
                    <ChevronLeft size={18} />
                  </button>
                  <button type="button" className="diary-btn is-small" disabled={day === today} onClick={() => goDay(today)}>
                    오늘
                  </button>
                  <button type="button" className="diary-nav" aria-label="다음 날" disabled={day >= today} onClick={() => shift(1)}>
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
              <h1 className="diary-date mt-1">
                {date.getFullYear()}년 {date.getMonth() + 1}월 {date.getDate()}일 <span>({WEEKDAYS[date.getDay()]})</span>
              </h1>
            </header>
            <div className="diary-hrule mt-3.5" />
            {snap.diary.error && <p className="mt-2 text-[13px] font-semibold text-[var(--rust)]">{snap.diary.error}</p>}

            <DiaryBody day={day} isToday={day === today} focusFirst={desktop && phase === "shown" && !moved} />
            <DayRecord day={day} />
            <DiaryFooter />
          </main>

          {showList && sideList && (
            <aside className="diary-margin" aria-label="지난 일기">
              <div className="sticky top-0 ml-8 flex h-dvh w-[min(300px,calc(100%-2rem))] flex-col border-l border-[rgba(184,138,62,0.28)] pt-[78px] pr-5 pl-6">
                <p className="mb-3 text-[12px] font-bold tracking-[0.18em] text-[var(--gold-text)]">지난 일기</p>
                <PastList day={day} month={listMonth} setMonth={setListMonth} onPick={pick} />
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* 폰·좁은 화면 — 오른쪽에서 밀려 나오는 지난 일기 */}
      {showList && listOpen && !sideList && (
        <div className="absolute inset-0 z-20">
          <div className="absolute inset-0 bg-[rgba(59,45,31,0.28)]" onClick={() => setListOpen(false)} />
          <aside
            aria-label="지난 일기"
            className="diary-paper diary-panel-in absolute inset-y-0 right-0 flex w-[88%] max-w-[380px] flex-col px-5 pt-[max(14px,calc(env(safe-area-inset-top)+8px))] shadow-[-24px_0_60px_-24px_rgba(60,40,15,0.55)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[12px] font-bold tracking-[0.18em] text-[var(--gold-text)]">지난 일기</p>
              <button type="button" className="diary-icon" aria-label="목록 닫기" onClick={() => setListOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <PastList day={day} month={listMonth} setMonth={setListMonth} onPick={pick} />
          </aside>
        </div>
      )}

      {phase !== "shown" && (
        <DiaryIntro
          key={phase}
          mode={phase}
          sound={settings.diarySound}
          onDone={phase === "open" ? () => setPhase("shown") : () => p.openSheet(null)}
          onCovered={() => setCovered(true)}
        />
      )}
    </div>
  );
}

/** ☰ 메뉴 → DREAM(일기) */
export function DiarySheet() {
  const { sheet } = usePlanner();
  if (sheet !== "diary") return null;
  return <DiaryPage />;
}
