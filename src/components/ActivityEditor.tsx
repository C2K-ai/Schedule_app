"use client";

import { Check, CircleCheck, Trash } from "lucide-react";
import { useMemo, useState } from "react";
import { activityMinutes, deleteActivity, liveCategories, saveActivity } from "@/lib/planner";
import { atTime, dayKey, fmtSpan, fmtTime, MIN, parseDayKey, toHHMM } from "@/lib/time";
import { COLOR_HEX, type Activity, type Category, type ColorKey } from "@/lib/types";
import { usePlanner, type ActivityEditorState } from "./PlannerProvider";
import { Button, ColorPicker, cx, inputCls, Label, Modal, Segmented } from "./ui";

interface Draft {
  title: string;
  date: string;
  timed: boolean;
  start: string;
  end: string;
  color: ColorKey;
  categoryId: string | null;
  notes: string;
}

/** 새로 쓸 때 시각 기본값 — 오늘이면 '방금 1시간', 다른 날이면 9–10시 */
function defaultWindow(day: string): { start: Date; end: Date } {
  const now = new Date();
  if (day === dayKey(now)) {
    const end = new Date(Math.floor(now.getTime() / (5 * MIN)) * 5 * MIN);
    return { start: new Date(end.getTime() - 60 * MIN), end };
  }
  const start = atTime(parseDayKey(day), "09:00");
  return { start, end: new Date(start.getTime() + 60 * MIN) };
}

function initialDraft(a: Activity | null, e: ActivityEditorState): Draft {
  if (a) {
    const w = a.starts_at && a.ends_at ? { start: new Date(a.starts_at), end: new Date(a.ends_at) } : defaultWindow(a.day);
    return {
      title: a.title,
      date: a.day,
      timed: Boolean(a.starts_at),
      start: toHHMM(w.start),
      end: toHHMM(w.end),
      color: a.color,
      categoryId: a.category_id,
      notes: a.notes ?? "",
    };
  }
  const day = e.day ?? (e.start ? dayKey(e.start) : dayKey(new Date()));
  const w = e.start ? { start: e.start, end: e.end ?? new Date(e.start.getTime() + 60 * MIN) } : defaultWindow(day);
  return {
    title: "",
    date: day,
    timed: Boolean(e.start),
    start: toHHMM(w.start),
    end: toHHMM(w.end),
    color: "cyan",
    categoryId: null,
    notes: "",
  };
}

/** 끝이 시작보다 이르거나 같으면 다음 날로 넘어간 것(밤 11시 → 새벽 1시) */
function windowOf(d: Draft): { start: Date; end: Date } {
  const start = atTime(parseDayKey(d.date), d.start);
  let end = atTime(parseDayKey(d.date), d.end);
  if (end <= start) end = new Date(end.getTime() + 24 * 60 * MIN);
  return { start, end };
}

export function ActivityEditor() {
  const { activityEditor } = usePlanner();
  if (!activityEditor) return null;
  return (
    <ActivityEditorBody
      key={activityEditor.activityId ?? `new-${activityEditor.day ?? ""}-${activityEditor.start?.getTime() ?? ""}`}
      editor={activityEditor}
    />
  );
}

function ActivityEditorBody({ editor }: { editor: ActivityEditorState }) {
  const { store, snap, closeActivity } = usePlanner();
  const categories = useMemo(() => liveCategories(snap.db), [snap.db]);
  const current = editor.activityId ? (store.db.activities[editor.activityId] ?? null) : null;
  const [d, setD] = useState<Draft>(() => initialDraft(current, editor));
  const [err, setErr] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const win = d.timed ? windowOf(d) : null;
  const span = win ? win.end.getTime() - win.start.getTime() : 0;

  const save = () => {
    const title = d.title.trim();
    if (!title) return setErr("무엇을 했는지 적어 주세요");
    if (win && span > 24 * 60 * MIN) return setErr("한 번에 24시간까지 기록할 수 있어요");
    saveActivity(store, {
      id: current?.id,
      title: title.slice(0, 200),
      notes: d.notes.trim() ? d.notes.trim().slice(0, 5000) : null,
      day: d.date,
      starts_at: win ? win.start.toISOString() : null,
      ends_at: win ? win.end.toISOString() : null,
      color: d.color,
      category_id: d.categoryId,
    });
    closeActivity();
  };

  const remove = () => {
    if (!current) return;
    if (!sure) return setSure(true);
    deleteActivity(store, current.id);
    closeActivity();
  };

  return (
    <Modal
      open
      onClose={closeActivity}
      title={
        <span className="inline-flex items-center gap-2">
          <CircleCheck size={20} className="text-did" /> {current ? "한 일 고치기" : "한 일 기록"}
        </span>
      }
      subtitle="이미 한 일을 남겨요. 알림이나 사유서 없이 기록만 돼요."
      footer={
        <div className="flex items-center gap-2">
          {current && (
            <Button variant={sure ? "danger" : "dangerSoft"} onClick={remove}>
              <Trash size={15} /> {sure ? "정말 삭제" : "삭제"}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={closeActivity}>
              취소
            </Button>
            <button
              onClick={save}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-did px-4 text-sm font-semibold text-[#04201d] transition hover:brightness-110"
            >
              <Check size={16} strokeWidth={2.75} /> {current ? "저장" : "기록"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <input
          autoFocus={!current}
          value={d.title}
          onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && save()}
          placeholder="무엇을 했나요? 예: 헬스 1시간, 보고서 초안"
          className={cx(inputCls, "h-12 text-lg font-semibold focus:border-did")}
        />

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
          <div>
            <Label>날짜</Label>
            <input type="date" value={d.date} onChange={(e) => e.target.value && set({ date: e.target.value })} className={inputCls} />
          </div>
          <Segmented
            value={d.timed ? "timed" : "day"}
            onChange={(v) => set({ timed: v === "timed" })}
            options={[
              { value: "day", label: "시간 없이" },
              { value: "timed", label: "시간 넣기" },
            ]}
            className="mb-0.5"
          />
        </div>

        {d.timed && (
          <div>
            <Label hint={span > 0 ? `${fmtSpan(span)}${win && dayKey(win.end) !== d.date ? " · 다음 날까지" : ""}` : undefined}>시간</Label>
            <div className="flex items-center gap-2">
              <input type="time" value={d.start} step={300} onChange={(e) => e.target.value && set({ start: e.target.value })} className={inputCls} aria-label="시작" />
              <span className="text-muted">–</span>
              <input type="time" value={d.end} step={300} onChange={(e) => e.target.value && set({ end: e.target.value })} className={inputCls} aria-label="끝" />
            </div>
          </div>
        )}

        {categories.length > 0 && (
          <div>
            <Label>카테고리</Label>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => set(d.categoryId === c.id ? { categoryId: null } : { categoryId: c.id, ...(current ? {} : { color: c.color }) })}
                  className={cx(
                    "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition",
                    d.categoryId === c.id ? "border-transparent bg-fg text-bg" : "border-line bg-surface-2 text-muted hover:text-fg",
                  )}
                >
                  <span className="size-2 rounded-full" style={{ background: COLOR_HEX[c.color] }} />
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <Label>색</Label>
          <ColorPicker value={d.color} onChange={(color) => set({ color })} />
        </div>

        <div>
          <Label>메모</Label>
          <textarea
            value={d.notes}
            onChange={(e) => set({ notes: e.target.value })}
            rows={2}
            placeholder="어땠는지, 결과, 느낀 점…"
            className={cx(inputCls, "resize-none")}
          />
        </div>

        {err && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{err}</p>}
      </div>
    </Modal>
  );
}

/** '한 일 기록' 버튼 — 일정 추가와 다른 색(청록)·체크 모양 */
export function DidButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-xl bg-did-soft px-3 text-[13px] font-semibold whitespace-nowrap text-did transition hover:brightness-110",
        className,
      )}
    >
      <Check size={14} strokeWidth={3} /> 한 일
    </button>
  );
}

/** 한 일 한 줄 — 일정(빈 동그라미)과 달리 처음부터 채워진 체크 + 점선 테두리 */
export function ActivityRow({ a, categories }: { a: Activity; categories: Category[] }) {
  const { openActivity } = usePlanner();
  const cat = categories.find((c) => c.id === a.category_id);
  const color = COLOR_HEX[a.color];
  const mins = activityMinutes(a);
  return (
    <li>
      <button
        onClick={() => openActivity({ activityId: a.id })}
        className="flex w-full items-center gap-3 rounded-2xl border border-dashed px-3 py-2.5 text-left transition hover:brightness-105"
        style={{ borderColor: `color-mix(in oklab, ${color} 55%, transparent)`, background: `color-mix(in oklab, ${color} 9%, transparent)` }}
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-full" style={{ background: color }}>
          <Check size={14} strokeWidth={3} className="text-[#0b0c10]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{a.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            {a.starts_at && a.ends_at ? (
              <span className="font-mono tabular-nums">
                {fmtTime(a.starts_at)}–{fmtTime(a.ends_at)}
                {mins > 0 && <span className="ml-1 font-sans">({fmtSpan(mins * MIN)})</span>}
              </span>
            ) : (
              <span>시간 없음</span>
            )}
            {cat && (
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full" style={{ background: COLOR_HEX[cat.color] }} />
                {cat.name}
              </span>
            )}
            {a.notes && <span className="truncate">· {a.notes}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}
