"use client";

import { Bookmark, Trash } from "lucide-react";
import { useState } from "react";
import { deleteMark, saveMark, whenLabel } from "@/lib/marks";
import { dayKey, parseDayKey } from "@/lib/time";
import { COLOR_HEX, type ColorKey, type Mark } from "@/lib/types";
import { usePlanner, type MarkEditorState } from "./PlannerProvider";
import { Button, ColorPicker, cx, inputCls, Label, Modal, Switch } from "./ui";

const EMOJIS = ["🎂", "🎉", "💍", "🎁", "✈️", "📝", "🏥", "⭐", "❤️"];

interface Draft {
  title: string;
  day: string;
  multi: boolean;
  end: string;
  yearly: boolean;
  emoji: string | null;
  color: ColorKey;
  notes: string;
}

const initial = (m: Mark | null, day?: string): Draft =>
  m
    ? { title: m.title, day: m.day, multi: Boolean(m.end_day), end: m.end_day ?? m.day, yearly: m.yearly, emoji: m.emoji, color: m.color, notes: m.notes ?? "" }
    : { title: "", day: day ?? dayKey(new Date()), multi: false, end: day ?? dayKey(new Date()), yearly: false, emoji: null, color: "pink", notes: "" };

/** 표시 창 — 생일·기념일·시험·여행처럼 날짜만 있는 것. 체크·알림 없이 캘린더에 보이기만 */
export function MarkEditor() {
  const { markEditor } = usePlanner();
  if (!markEditor) return null;
  return <MarkEditorBody key={markEditor.markId ?? `new-${markEditor.day ?? ""}`} editor={markEditor} />;
}

function MarkEditorBody({ editor }: { editor: MarkEditorState }) {
  const { store, closeMark } = usePlanner();
  const current = editor.markId ? (store.db.marks[editor.markId] ?? null) : null;
  const [d, setD] = useState<Draft>(() => initial(current, editor.day));
  const [err, setErr] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });

  const save = () => {
    const title = d.title.trim();
    if (!title) return setErr("무슨 날인지 적어 주세요 (예: 내 생일)");
    if (d.multi && !d.yearly && d.end < d.day) return setErr("끝 날이 시작보다 앞이에요");
    saveMark(store, {
      id: current?.id,
      title: title.slice(0, 200),
      notes: d.notes.trim() ? d.notes.trim().slice(0, 5000) : null,
      day: d.day,
      end_day: d.multi && !d.yearly && d.end > d.day ? d.end : null,
      yearly: d.yearly,
      emoji: d.emoji,
      color: d.color,
    });
    closeMark();
  };
  const remove = () => {
    if (!current) return;
    if (!sure) return setSure(true);
    deleteMark(store, current.id);
    closeMark();
  };

  return (
    <Modal
      open
      onClose={closeMark}
      title={
        <span className="inline-flex items-center gap-2">
          <Bookmark size={19} className="text-[#f472b6]" /> {current ? "표시 고치기" : "표시 남기기"}
        </span>
      }
      subtitle="생일·기념일·시험·여행처럼 날짜만 표시해요. 할 일이 아니라 체크·알림은 없어요."
      footer={
        <div className="flex items-center gap-2">
          {current && (
            <Button variant={sure ? "danger" : "dangerSoft"} onClick={remove}>
              <Trash size={15} /> {sure ? "정말 삭제" : "삭제"}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={closeMark}>
              취소
            </Button>
            <Button variant="primary" onClick={save}>
              {current ? "저장" : "표시"}
            </Button>
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
          placeholder="무슨 날인가요? 예: 내 생일, 엄마 생신, 토익 시험, 제주 여행"
          className={cx(inputCls, "h-12 text-lg font-semibold")}
        />
        <div>
          <Label>그림</Label>
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => set({ emoji: d.emoji === e ? null : e })}
                className={cx("grid size-10 place-items-center rounded-xl border text-xl transition", d.emoji === e ? "border-accent bg-accent/15" : "border-line bg-surface-2")}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className={cx("grid gap-3", d.multi && !d.yearly && "grid-cols-2")}>
          <div>
            <Label>{d.multi && !d.yearly ? "시작 날" : "날짜"}</Label>
            <input type="date" value={d.day} onChange={(e) => e.target.value && set({ day: e.target.value, end: e.target.value > d.end ? e.target.value : d.end })} className={inputCls} />
          </div>
          {d.multi && !d.yearly && (
            <div>
              <Label>끝 날</Label>
              <input type="date" value={d.end} min={d.day} onChange={(e) => e.target.value && set({ end: e.target.value })} className={inputCls} />
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Switch checked={d.yearly} onChange={(yearly) => set({ yearly, multi: yearly ? false : d.multi })} label="매년 반복" desc="생일·기념일처럼 해마다 같은 날" />
          {!d.yearly && <Switch checked={d.multi} onChange={(multi) => set({ multi })} label="여러 날" desc="여행·시험 기간처럼 며칠 이어지는 날" />}
        </div>
        <div>
          <Label>색</Label>
          <ColorPicker value={d.color} onChange={(color) => set({ color })} />
        </div>
        <div>
          <Label>메모</Label>
          <textarea value={d.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} placeholder="선물, 준비물, 장소…" className={cx(inputCls, "resize-none")} />
        </div>
        {err && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{err}</p>}
      </div>
    </Modal>
  );
}

/** 표시 한 줄(캘린더 날짜 칸·목록) — 누르면 고치기 */
export function MarkChip({ m, when, onClick, className }: { m: Mark; when?: number; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("inline-flex max-w-full items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[13px] font-semibold", className)}
      style={{ borderColor: `${COLOR_HEX[m.color]}66`, background: `${COLOR_HEX[m.color]}1f` }}
    >
      {m.emoji ? <span>{m.emoji}</span> : <span className="size-2 shrink-0 rounded-full" style={{ background: COLOR_HEX[m.color] }} />}
      <span className="truncate">{m.title}</span>
      {when !== undefined && <span className="shrink-0 font-mono text-[11px] font-bold text-muted">{whenLabel(when)}</span>}
      {m.yearly && when === undefined && <span className="shrink-0 text-[11px] font-normal text-muted">매년</span>}
      {m.end_day && when === undefined && (
        <span className="shrink-0 text-[11px] font-normal text-muted">
          ~{parseDayKey(m.end_day).getMonth() + 1}/{parseDayKey(m.end_day).getDate()}
        </span>
      )}
    </button>
  );
}
