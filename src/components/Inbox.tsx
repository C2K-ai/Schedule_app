"use client";

import { Inbox as InboxIcon, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { createTask, inboxTasks } from "@/lib/planner";
import { COLOR_HEX } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";
import { TASK_DRAG_TYPE } from "./Timeline";
import { cx, inputCls } from "./ui";

/** PC 시간표 옆 인박스 — 시각을 안 정한 할 일을 모아 두고, 끌어서 시간표의 빈 시간에 놓는다(폰은 없음) */
export function InboxPanel({ className }: { className?: string }) {
  const { tasks, store, settings, openTask } = usePlanner();
  const now = useNow(60_000);
  const list = useMemo(() => inboxTasks(tasks, now), [tasks, now]);
  const [title, setTitle] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);

  const add = () => {
    const t = title.trim();
    if (!t) return;
    createTask(store, { title: t, schedule: "someday" }, settings);
    setTitle("");
  };

  return (
    <aside aria-label="인박스" className={cx("relative w-60 shrink-0 border-l border-line", className)}>
      <div className="absolute inset-0 flex flex-col">
        <div className="flex items-center gap-1.5 px-3 pt-3 pb-2 text-sm font-bold">
          <InboxIcon size={15} /> 인박스 <span className="font-mono text-xs font-semibold text-muted">{list.length}</span>
        </div>
        <form
          className="flex gap-1.5 px-3 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="할 일 적어 두기" aria-label="인박스에 적기" maxLength={120} className={cx(inputCls, "h-9 text-sm")} />
          <button type="submit" aria-label="인박스에 넣기" disabled={!title.trim()} className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg disabled:opacity-40">
            <Plus size={16} />
          </button>
        </form>
        <p className="px-3 pb-2 text-[11px] leading-snug text-faint">끌어서 왼쪽 시간표에 놓으면 그 시간 일정이 돼요(1시간).</p>
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
          {list.length === 0 && <li className="py-6 text-center text-xs text-muted">시간을 안 정한 할 일이 없어요.</li>}
          {list.map((t) => (
            <li
              key={t.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TASK_DRAG_TYPE, t.id);
                e.dataTransfer.setData("text/plain", t.title);
                e.dataTransfer.effectAllowed = "move";
                setDragging(t.id);
              }}
              onDragEnd={() => setDragging(null)}
              onClick={() => openTask(t)}
              title="끌어서 시간표에 놓기 · 눌러서 고치기"
              className={cx(
                "flex cursor-grab items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-2 text-sm active:cursor-grabbing hover:border-accent",
                dragging === t.id && "opacity-40",
              )}
            >
              <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: COLOR_HEX[t.color] }} />
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
                {t.schedule === "day" ? `${new Date(t.starts_at).getMonth() + 1}/${new Date(t.starts_at).getDate()}` : "날짜 없음"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
