"use client";

import { ImagePlus, Loader2, Mic, PenLine, Repeat, Sparkles, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { existingForAi, isPastItem, parseSchedule, REMOVE_RE, saveParsed, type ParsedItem } from "@/lib/ai";
import { deleteHabit, deleteTask, liveCategories } from "@/lib/planner";
import { shrinkPhoto, type Photo } from "@/lib/photo";
import { SHARED_KEY } from "@/lib/share";
import { getSupabase } from "@/lib/supabase";
import { dayKey, fmtTime, parseDayKey, WEEKDAYS } from "@/lib/time";
import type { Habit, Task } from "@/lib/types";
import { applyRemovals, RemovalList, toRemovalDrafts, type RemovalDraft } from "./AiRemovals";
import { usePlanner } from "./PlannerProvider";
import { Button, cx, inputCls, Modal } from "./ui";

/** 넣은 것 한 줄 — 일정이면 task, 반복이면 habit */
type Added = { key: string; task?: Task; habit?: Habit };
/** 지난 시각이라 바로 넣지 않고 물어보는 것 */
type Held = { key: string; item: ParsedItem };

const dayLabel = (key: string) => {
  const d = parseDayKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
};

const habitDays = (days: number[]) =>
  days.length === 7 ? "매일" : `매주 ${[...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS[d]).join("·")}`;

function whenOf(a: Added): string {
  if (a.habit)
    return `${habitDays(a.habit.days)} ${a.habit.start_time}${a.habit.end_day ? ` · ~${dayLabel(a.habit.end_day)}까지` : ""}`;
  const t = a.task!;
  if (t.schedule === "someday") return "날짜 없음";
  const day = dayLabel(dayKey(new Date(t.starts_at)));
  return t.schedule === "day" ? day : `${day} ${fmtTime(t.starts_at)}–${fmtTime(t.ends_at)}`;
}

/** 쓰기 — 대충 적으면(예: "29일 1시부터 2시 치과") AI 가 날짜·시간을 알아서 정리해 바로 일정에 넣는다. 확인 단계 없이, 넣은 건 아래에서 고치거나 뺀다 */
export function WriteAdd() {
  const { sheet } = usePlanner();
  if (sheet !== "write") return null;
  return <WriteBody />;
}

function WriteBody() {
  const { openSheet, openEditor, store, settings, snap, session } = usePlanner();
  const categories = useMemo(() => liveCategories(snap.db), [snap.db]);
  // 카톡 등에서 공유받은 글이 있으면 채워서 연다(ReminderEngine 이 넘겨줌)
  const [shared] = useState(() => {
    try {
      return sessionStorage.getItem(SHARED_KEY) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    if (!shared) return;
    try {
      sessionStorage.removeItem(SHARED_KEY);
    } catch {
      /* 무시 */
    }
  }, [shared]);
  const [text, setText] = useState(shared);
  // 사진으로 일정 넣기 — 시간표·공지·초대장 사진을 AI 가 읽는다
  const [photo, setPhoto] = useState<Photo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    try {
      setPhoto(await shrinkPhoto(f));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [added, setAdded] = useState<Added[]>([]);
  const [held, setHeld] = useState<Held[]>([]);
  // AI 가 지우자고 고른 기존 일정 — 바로 지우지 않고 확인받는다
  const [removals, setRemovals] = useState<RemovalDraft[]>([]);
  const close = () => openSheet(null);

  const keep = (r: { tasks: Task[]; habits: Habit[] }) =>
    setAdded((list) => [...r.tasks.map((t) => ({ key: t.id, task: t })), ...r.habits.map((h) => ({ key: h.id, habit: h })), ...list]);

  const submit = async () => {
    const t = text.trim();
    if (busy || (!t && !photo)) return;
    const sb = getSupabase();
    if (!sb || !session.userId) return setErr("AI 정리는 로그인한 상태에서만 쓸 수 있어요 (설정 → 계정).");
    setErr(null);
    setNote(null);
    setBusy(true);
    try {
      // 지우기·옮기기 말이 있을 때만 기존 일정 목록을 같이 보낸다(사진은 넣기만)
      const ex = !photo && REMOVE_RE.test(t) ? existingForAi(snap.db) : undefined;
      const r = await parseSchedule(sb, t, categories, photo ?? undefined, ex);
      const rm = toRemovalDrafts(r.remove, store.db, Date.now(), settings.graceMin);
      setRemovals(rm);
      if (rm.length) setNote(r.reply || null);
      if (!r.items.length) {
        if (!rm.length) setNote(r.reply || "일정으로 넣을 만한 걸 찾지 못했어요. 날짜나 시간을 같이 적어 보세요.");
        else setText("");
        return;
      }
      const now = Date.now();
      const future = r.items.filter((it) => !isPastItem(it, now));
      const past = r.items.filter((it) => isPastItem(it, now));
      if (future.length) keep(saveParsed(store, future, settings, categories));
      if (past.length) setHeld((list) => [...past.map((item, i) => ({ key: `${now}-${i}`, item })), ...list]);
      setText("");
      setPhoto(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = (a: Added) => {
    if (a.task) deleteTask(store, a.task.id);
    if (a.habit) deleteHabit(store, a.habit.id);
    setAdded((list) => list.filter((x) => x.key !== a.key));
  };

  return (
    <Modal
      open
      onClose={close}
      title={
        <span className="inline-flex items-center gap-2">
          <PenLine size={19} /> Write
        </span>
      }
      subtitle="날짜·시간을 섞어 적으면 AI 가 알아서 일정에 넣어요."
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => openSheet("voice")}>
            <Mic size={16} /> 말로 하기
          </Button>
          <Button variant="soft" className="ml-auto" onClick={close}>
            닫기
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {shared && <p className="mb-2 text-sm text-muted">다른 앱에서 공유받은 글이에요. 날짜·시간이 들어 있는지 보고 넣으세요.</p>}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
          <Button type="button" variant="soft" className="h-12 shrink-0 px-3" aria-label="사진으로 넣기" title="사진으로 넣기(시간표·공지·초대장)" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={18} />
          </Button>
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={photo ? "덧붙일 말(없어도 돼요)" : "예: 29일 1시부터 2시 치과"}
            aria-label="일정 적기"
            maxLength={2000}
            enterKeyHint="send"
            className={cx(inputCls, "h-12 text-base")}
          />
          <Button variant="primary" className="h-12 shrink-0" disabled={busy || (!text.trim() && !photo)}>
            {busy ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}
            <span className="hidden sm:inline">{busy ? "정리 중…" : "넣기"}</span>
          </Button>
        </form>

        {photo && (
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- 기기 안 미리보기(data URL) */}
            <img src={photo.preview} alt="넣을 사진" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
            <p className="min-w-0 flex-1 text-sm text-muted">사진 속 일정을 찾아 넣어요. 시간표는 매주 반복 일정으로 들어가요.</p>
            <button type="button" aria-label="사진 빼기" onClick={() => setPhoto(null)} className="rounded-lg p-1.5 text-muted hover:bg-surface-3">
              <X size={16} />
            </button>
          </div>
        )}
        {err && (
          <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            {err}
          </p>
        )}
        {note && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">{note}</p>}

        {removals.length > 0 && (
          <div className="rounded-2xl border border-danger/40 p-3">
            <p className="mb-2 text-sm font-bold">이 일정을 지울까요?</p>
            <RemovalList items={removals} onToggle={(i) => setRemovals((l) => l.map((r, j) => (j === i ? { ...r, on: !r.on } : r)))} />
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRemovals([])}>
                그대로 두기
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={!removals.some((r) => r.on && !r.locked)}
                onClick={() => {
                  applyRemovals(store, removals);
                  setRemovals([]);
                }}
              >
                {removals.filter((r) => r.on && !r.locked).length}개 지우기
              </Button>
            </div>
          </div>
        )}

        {held.length > 0 && (
          <ul className="space-y-1.5">
            {held.map((h) => (
              <li key={h.key} className="rounded-2xl border border-warn/40 bg-warn/10 px-3 py-2.5 text-sm">
                <p className="font-semibold">
                  <span className="mr-1.5 font-mono text-xs text-warn tabular-nums">
                    {dayLabel(h.item.date!)} {h.item.start}
                  </span>
                  {h.item.title}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-xs text-warn">이미 지난 시간이에요.</span>
                  <button
                    type="button"
                    onClick={() => {
                      // 지난 시각을 일부러 넣는 거라 강제 모드는 끈다 — 넣자마자 '미시작' 경고가 뜨지 않게
                      keep(saveParsed(store, [h.item], settings, categories, { strict: false }));
                      setHeld((list) => list.filter((x) => x.key !== h.key));
                    }}
                    className="ml-auto text-xs font-bold text-fg underline-offset-2 hover:underline"
                  >
                    그래도 넣기
                  </button>
                  <button
                    type="button"
                    onClick={() => setHeld((list) => list.filter((x) => x.key !== h.key))}
                    className="text-xs font-semibold text-muted hover:text-fg"
                  >
                    빼기
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {added.length > 0 && (
          <div>
            <p className="mb-1.5 text-[13px] font-bold text-muted">넣은 일정</p>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {added.map((a) => (
                <li key={a.key} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">
                      {a.habit && <Repeat size={12} className="mr-1 inline text-muted" />}
                      {a.task?.title ?? a.habit?.title}
                    </span>
                    <span className="mt-0.5 block font-mono text-xs text-muted tabular-nums">{whenOf(a)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => (a.task ? openEditor({ taskId: a.task.id }) : openSheet("habits"))}
                    className="shrink-0 text-xs font-bold text-accent-text hover:underline"
                  >
                    고치기
                  </button>
                  <button type="button" onClick={() => remove(a)} className="shrink-0 text-xs font-semibold text-muted hover:text-danger">
                    빼기
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!added.length && !held.length && !note && !err && (
          <p className="text-xs leading-relaxed text-faint">
            여러 개를 한 번에 적어도 돼요 — “내일 3시 치과, 금요일까지 보고서, 매일 아침 7시 운동”. 이름 없이 시간만 적으면 ‘일정’으로 넣어요.
          </p>
        )}
      </div>
    </Modal>
  );
}
