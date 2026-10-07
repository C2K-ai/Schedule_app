"use client";

import { ArrowDown, ArrowUp, Plus, Trash } from "lucide-react";
import { useState } from "react";
import { COLOR_HEX, COLOR_KEYS, type ColorKey } from "@/lib/types";
import { Button, cx, inputCls, Modal } from "./ui";

export interface NamedItem {
  id: string;
  name: string;
  color: ColorKey;
  sort: number;
}

/** 이름 + 색 목록 편집기 — 카테고리·과목 둘 다 쓴다. 이름은 칸을 벗어나면 저장. */
export function ListManager({
  open,
  onClose,
  title,
  subtitle,
  items,
  counts,
  placeholder,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  items: NamedItem[];
  counts?: Map<string, number>;
  placeholder: string;
  onCreate: (name: string, color: ColorKey) => void;
  onUpdate: (id: string, patch: Partial<Pick<NamedItem, "name" | "color" | "sort">>) => void;
  onDelete: (item: NamedItem) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<ColorKey>("violet");
  const [palette, setPalette] = useState<string | null>(null);

  const add = () => {
    const n = name.trim();
    if (!n) return;
    onCreate(n.slice(0, 40), color);
    setName("");
    setColor(COLOR_KEYS[(COLOR_KEYS.indexOf(color) + 1) % COLOR_KEYS.length]);
  };

  const move = (i: number, dir: -1 | 1) => {
    const a = items[i];
    const b = items[i + dir];
    if (!a || !b) return;
    onUpdate(a.id, { sort: b.sort });
    onUpdate(b.id, { sort: a.sort === b.sort ? a.sort + dir : a.sort });
  };

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={it.id} className="rounded-2xl border border-line bg-surface-2/50 p-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="색 바꾸기"
                onClick={() => setPalette(palette === it.id ? null : it.id)}
                className="size-7 shrink-0 rounded-full border-2 border-transparent hover:border-fg"
                style={{ background: COLOR_HEX[it.color] }}
              />
              <input
                key={`${it.id}:${it.name}`}
                defaultValue={it.name}
                maxLength={40}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== it.name) onUpdate(it.id, { name: v });
                  else e.target.value = it.name;
                }}
                onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
                className="min-w-0 flex-1 bg-transparent px-1 py-1.5 font-semibold outline-none focus:bg-surface"
                aria-label="이름"
              />
              {counts && <span className="font-mono text-xs text-faint tabular-nums">{counts.get(it.id) ?? 0}</span>}
              <button type="button" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-3 disabled:opacity-25">
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                aria-label="아래로"
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
                className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-3 disabled:opacity-25"
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                aria-label="삭제"
                onClick={() => onDelete(it)}
                className="grid size-8 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"
              >
                <Trash size={15} />
              </button>
            </div>
            {palette === it.id && (
              <div className="mt-2 flex flex-wrap gap-2 pl-9">
                {COLOR_KEYS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => {
                      onUpdate(it.id, { color: c });
                      setPalette(null);
                    }}
                    className={cx("size-7 rounded-full border-2", it.color === c ? "border-fg" : "border-transparent")}
                    style={{ background: COLOR_HEX[c] }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            aria-label="새 항목 색"
            onClick={() => setColor(COLOR_KEYS[(COLOR_KEYS.indexOf(color) + 1) % COLOR_KEYS.length])}
            className="size-9 shrink-0 rounded-full"
            style={{ background: COLOR_HEX[color] }}
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()}
            placeholder={placeholder}
            maxLength={40}
            className={cx(inputCls, "h-10 py-1")}
          />
          <Button variant="primary" onClick={add} disabled={!name.trim()}>
            <Plus size={16} /> 추가
          </Button>
        </div>
      </div>
    </Modal>
  );
}
