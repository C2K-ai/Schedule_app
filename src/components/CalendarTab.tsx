"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { dayNoteFor, isSomeday, liveCategories, saveDayNote } from "@/lib/planner";
import { addDays, dayKey, fmtDate, sameDay, startOfDay, WEEKDAYS } from "@/lib/time";
import { useMedia } from "@/lib/useMedia";
import { Board, type View } from "./Board";
import { usePlanner } from "./PlannerProvider";
import { TaskRow } from "./TasksTab";
import { Button, Card, cx, IconButton, Segmented } from "./ui";

export const MOODS = [
  { v: 1, e: "😞", label: "별로" },
  { v: 2, e: "😕", label: "그저 그래" },
  { v: 3, e: "😐", label: "보통" },
  { v: 4, e: "🙂", label: "좋아" },
  { v: 5, e: "😄", label: "최고" },
];

/** 월요일 시작 6주 칸 */
function monthCells(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** 하루 노트 — 그날 할 것·생각·느낌. 칸을 벗어나거나 잠깐 멈추면 자동 저장 */
function DayNote({ day }: { day: Date }) {
  const { store, snap } = usePlanner();
  const key = dayKey(day);
  const note = dayNoteFor(snap.db, key);
  const [body, setBody] = useState(note?.body ?? "");
  const [saved, setSaved] = useState<"idle" | "typing" | "saved">("idle");
  const timer = useRef<number | null>(null);
  const latest = useRef(body);
  useEffect(() => {
    latest.current = body;
  });

  const flush = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const cur = dayNoteFor(store.db, key);
    if ((cur?.body ?? "") === latest.current) return;
    saveDayNote(store, key, { body: latest.current });
    setSaved("saved");
  };
  // 다른 날짜로 넘어가거나 화면을 닫을 때 남은 내용 저장
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        {MOODS.map((m) => (
          <button
            key={m.v}
            title={m.label}
            aria-label={`기분: ${m.label}`}
            aria-pressed={note?.mood === m.v}
            onClick={() => saveDayNote(store, key, { mood: note?.mood === m.v ? null : m.v, body: latest.current })}
            className={cx(
              "grid size-11 place-items-center rounded-xl text-2xl transition",
              note?.mood === m.v ? "scale-110 bg-accent/20" : "opacity-55 grayscale-[40%] hover:opacity-100",
            )}
          >
            {m.e}
          </button>
        ))}
        <span className="ml-auto text-xs text-faint">{saved === "typing" ? "입력 중…" : saved === "saved" ? "저장됨" : ""}</span>
      </div>
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setSaved("typing");
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(flush, 700);
        }}
        onBlur={flush}
        rows={6}
        placeholder="오늘 할 것, 떠오른 생각, 느낌… 자유롭게"
        className="w-full resize-y rounded-2xl border border-line bg-surface-2/60 px-4 py-3 text-[15px] leading-relaxed outline-none placeholder:text-faint focus:border-accent"
      />
    </div>
  );
}

function DayPanel({ day }: { day: Date }) {
  const { tasks, snap, openEditor } = usePlanner();
  const categories = useMemo(() => liveCategories(snap.db), [snap.db]);
  const key = dayKey(day);
  const list = tasks
    .filter((t) => !isSomeday(t) && dayKey(new Date(t.starts_at)) === key && t.status !== "skipped")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold">{fmtDate(day)}</h3>
        <Button size="sm" variant="soft" onClick={() => openEditor({ schedule: "day", day: key, start: new Date(startOfDay(day).getTime() + 9 * 3600_000) })}>
          <Plus size={14} /> 할 일
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="py-4 text-sm text-muted">이날 일정이 없어요.</p>
      ) : (
        <ul className="-mx-2 mt-2">
          {list.map((t) => (
            <TaskRow key={t.id} t={t} categories={categories} />
          ))}
        </ul>
      )}
      <div className="mt-4 border-t border-line pt-4">
        <p className="mb-2 text-[13px] font-bold text-muted">하루 노트</p>
        <DayNote key={key} day={day} />
      </div>
    </Card>
  );
}

function MonthGrid({ month, selected, onSelect }: { month: Date; selected: Date; onSelect: (d: Date) => void }) {
  const { tasks, snap } = usePlanner();
  const cells = useMemo(() => monthCells(month), [month]);
  const marks = useMemo(() => {
    const m = new Map<string, { open: number; done: number }>();
    for (const t of tasks) {
      if (isSomeday(t) || t.status === "skipped") continue;
      const k = dayKey(new Date(t.starts_at));
      const cur = m.get(k) ?? { open: 0, done: 0 };
      if (t.status === "done") cur.done++;
      else cur.open++;
      m.set(k, cur);
    }
    return m;
  }, [tasks]);
  const notes = useMemo(() => {
    const m = new Map<string, { mood: number | null; hasBody: boolean }>();
    for (const n of Object.values(snap.db.day_notes)) {
      if (n.deleted_at) continue;
      if (n.body.trim() || n.mood) m.set(n.day, { mood: n.mood, hasBody: Boolean(n.body.trim()) });
    }
    return m;
  }, [snap.db.day_notes]);
  const today = new Date();
  return (
    <div>
      <div className="grid grid-cols-7 pb-1 text-center text-xs font-semibold text-muted">
        {ORDER.map((d) => (
          <span key={d} className={cx(d === 0 && "text-danger", d === 6 && "text-[#7dd3fc]")}>
            {WEEKDAYS[d]}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const k = dayKey(d);
          const inMonth = d.getMonth() === month.getMonth();
          const sel = sameDay(d, selected);
          const isToday = sameDay(d, today);
          const mk = marks.get(k);
          const nt = notes.get(k);
          return (
            <button
              key={k}
              onClick={() => onSelect(d)}
              className={cx(
                "relative flex aspect-[4/5] flex-col items-center justify-start rounded-xl pt-1 transition md:aspect-[1.15] md:pt-1.5",
                sel ? "bg-accent text-accent-fg" : "hover:bg-surface-2",
                !inMonth && !sel && "opacity-35",
              )}
            >
              <span
                className={cx(
                  "grid size-7 place-items-center rounded-full font-mono text-sm font-bold tabular-nums",
                  isToday && !sel && "ring-2 ring-accent",
                  !sel && d.getDay() === 0 && "text-danger",
                )}
              >
                {d.getDate()}
              </span>
              {nt?.mood && <span className="text-[12px] leading-none md:text-base">{MOODS[nt.mood - 1].e}</span>}
              <span className="absolute bottom-1 flex gap-1 md:bottom-1.5">
                {mk && mk.open > 0 && <span className={cx("size-1.5 rounded-full", sel ? "bg-accent-fg" : "bg-accent")} />}
                {mk && mk.open === 0 && mk.done > 0 && <span className={cx("size-1.5 rounded-full", sel ? "bg-accent-fg/70" : "bg-ok")} />}
                {nt?.hasBody && <span className={cx("size-1.5 rounded-full", sel ? "bg-accent-fg/60" : "bg-[#a78bfa]")} />}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-accent" /> 남은 일정</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-ok" /> 다 끝낸 날</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#a78bfa]" /> 노트</span>
      </p>
    </div>
  );
}

export function CalendarTab() {
  const [mode, setMode] = useState<"month" | View>("month");
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const wide = useMedia("(min-width: 1024px)");
  const pick = (d: Date) => {
    setSelected(startOfDay(d));
    if (d.getMonth() !== month.getMonth()) setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "month", label: "월" },
            { value: "week", label: "주" },
            { value: "day", label: "일" },
          ]}
        />
        {mode === "month" && (
          <div className="ml-auto flex items-center">
            <IconButton label="이전 달" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
              <ChevronLeft size={20} />
            </IconButton>
            <p className="min-w-[96px] text-center font-bold">
              {month.getFullYear()}년 {month.getMonth() + 1}월
            </p>
            <IconButton label="다음 달" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              <ChevronRight size={20} />
            </IconButton>
            <Button size="sm" variant="outline" onClick={() => pick(new Date())}>
              오늘
            </Button>
          </div>
        )}
      </div>

      {mode === "month" ? (
        <div className={cx("grid items-start gap-4", wide && "grid-cols-[minmax(0,1fr)_400px]")}>
          <Card className="p-3 md:p-4">
            <MonthGrid month={month} selected={selected} onSelect={pick} />
          </Card>
          <DayPanel day={selected} />
        </div>
      ) : (
        <Board selected={selected} setSelected={pick} view={mode} setView={setMode} />
      )}
    </div>
  );
}
