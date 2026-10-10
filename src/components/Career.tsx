"use client";

import { BriefcaseBusiness, Check, ClipboardCopy, ClipboardPaste, Loader2, Pencil, Plus, Sparkles, Trash, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { polishCareer } from "@/lib/ai";
import { CAREER_KINDS, careerPeriod as period, kindLabel } from "@/lib/career";
import { careerMaterial, deleteCareer, liveCareer, saveCareer } from "@/lib/planner";
import { getSupabase } from "@/lib/supabase";
import { addDays, dayKey, fmtTime, uuid } from "@/lib/time";
import type { CareerEntry } from "@/lib/types";
import { CareerImport } from "./CareerImport";
import { usePlanner } from "./PlannerProvider";
import { Button, cx, Empty, inputCls, Label, Modal } from "./ui";

/** 이력서에 붙여 넣기 좋은 마크다운 */
export function careerMarkdown(list: CareerEntry[]): string {
  return list
    .map((e) => {
      const body = e.polished.trim() || e.raw.trim();
      const skills = e.skills.length ? `\n- 기술·역량: ${e.skills.join(", ")}` : "";
      return `### ${e.title} (${kindLabel(e.kind)} · ${period(e)})\n${body}${skills}`;
    })
    .join("\n\n");
}

type Draft = Omit<CareerEntry, "created_at" | "updated_at" | "deleted_at">;

function Editor({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const { store, snap, session } = usePlanner();
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [skillText, setSkillText] = useState(initial.skills.join(", "));
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const end = d.end_day ?? dayKey(new Date());
  const material = useMemo(() => careerMaterial(snap.db, d.start_day, end), [snap.db, d.start_day, end]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial.task_ids));
  const [useNotes, setUseNotes] = useState(true);

  const polish = async () => {
    const sb = getSupabase();
    if (!sb || !session.userId) return setErr("AI 다듬기는 로그인한 상태에서만 쓸 수 있어요 (설정 → 계정).");
    setErr(null);
    setBusy(true);
    const skillsAtStart = skillText;
    try {
      const events = material.items
        .filter((t) => picked.has(t.id))
        .map((t) => ({ date: t.day, title: t.title, notes: t.notes }));
      const r = await polishCareer(sb, {
        title: d.title,
        kind: d.kind,
        start_day: d.start_day,
        end_day: d.end_day,
        raw: d.raw,
        events,
        notes: useNotes ? material.notes.map((n) => ({ day: n.day, body: n.body })) : [],
      });
      const text = [r.summary, ...r.bullets.map((b) => `- ${b}`)].filter(Boolean).join("\n");
      // 기다리는 동안 고친 내용은 살린다 — 최신 초안에 결과만 얹는다
      setD((cur) => ({ ...cur, title: cur.title.trim() || r.title, polished: text, skills: r.skills }));
      setSkillText((cur) => (cur === skillsAtStart ? r.skills.join(", ") : cur));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const title = d.title.trim();
    if (!title) return setErr("제목을 적어 주세요");
    if (d.end_day && d.end_day < d.start_day) return setErr("끝 날짜가 시작보다 앞서요");
    const skills = [...new Set(skillText.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 20);
    saveCareer(store, { ...d, title: title.slice(0, 120), skills, task_ids: [...picked] });
    onDone();
  };

  return (
    <div className="space-y-5">
      <input
        value={d.title}
        onChange={(e) => set({ title: e.target.value })}
        placeholder="제목 (비워 두면 AI 가 지어 줘요)"
        className={cx(inputCls, "h-12 text-lg font-semibold")}
      />
      <div className="flex flex-wrap gap-1.5">
        {CAREER_KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => set({ kind: k.value })}
            className={cx(
              "h-8 rounded-lg px-3 text-[13px] font-semibold transition",
              d.kind === k.value ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted hover:text-fg",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>시작</Label>
          <input type="date" value={d.start_day} onChange={(e) => e.target.value && set({ start_day: e.target.value })} className={inputCls} />
        </div>
        <div>
          <Label hint={<button onClick={() => set({ end_day: d.end_day ? null : dayKey(new Date()) })} className="font-semibold text-accent-text">{d.end_day ? "진행 중으로" : "끝 날짜 넣기"}</button>}>
            끝
          </Label>
          {d.end_day ? (
            <input type="date" value={d.end_day} onChange={(e) => e.target.value && set({ end_day: e.target.value })} className={inputCls} />
          ) : (
            <p className={cx(inputCls, "text-muted")}>진행 중</p>
          )}
        </div>
      </div>
      <div>
        <Label hint="대충 적어도 돼요">무엇을 했나요</Label>
        <textarea
          value={d.raw}
          onChange={(e) => set({ raw: e.target.value })}
          rows={4}
          placeholder="예: 혼자 일정 앱 만듦. 알림 서버도 붙이고 폰이랑 노트북 동기화되게 함. 매일 씀."
          className={cx(inputCls, "resize-y leading-relaxed")}
        />
      </div>

      <div>
        <Label hint={`${picked.size}개 선택`}>이 기간에 끝낸 일정·한 일 — AI 가 참고할 것만 고르세요</Label>
        {material.items.length === 0 ? (
          <p className="text-sm text-faint">이 기간에 완료한 일정이나 한 일이 없어요.</p>
        ) : (
          <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-xl border border-line p-1">
            {material.items.map((t) => {
              const on = picked.has(t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = new Set(picked);
                      if (on) next.delete(t.id);
                      else next.add(t.id);
                      setPicked(next);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                  >
                    <span className={cx("grid size-5 shrink-0 place-items-center rounded-md border-2", on ? "border-accent bg-accent text-accent-fg" : "border-line-strong")}>
                      {on && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className="font-mono text-xs text-muted tabular-nums">{t.day.slice(5).replace("-", "/")}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    {t.activity && <span className="shrink-0 rounded bg-did-soft px-1 text-[10px] font-bold text-did">한 일</span>}
                    {t.at && <span className="font-mono text-[11px] text-faint">{fmtTime(t.at)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {material.notes.length > 0 && (
          <label className="mt-2 flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={useNotes} onChange={(e) => setUseNotes(e.target.checked)} className="accent-[var(--accent)]" />이 기간 하루 노트 {material.notes.length}개도 참고
          </label>
        )}
      </div>

      <Button variant="primary" onClick={polish} disabled={busy} className="w-full">
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {busy ? "다듬는 중…" : "AI로 다듬기"}
      </Button>

      <div>
        <Label hint="직접 고쳐도 돼요">다듬은 내용</Label>
        <textarea
          value={d.polished}
          onChange={(e) => set({ polished: e.target.value })}
          rows={6}
          placeholder="AI로 다듬으면 여기에 이력서용 문장이 들어가요"
          className={cx(inputCls, "resize-y leading-relaxed")}
        />
      </div>
      <div>
        <Label hint="쉼표로 구분">기술·역량</Label>
        <input value={skillText} onChange={(e) => setSkillText(e.target.value)} placeholder="예: Next.js, Supabase, 독일어 B1" className={inputCls} />
      </div>
      {err && (
        <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          {err}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          취소
        </Button>
        <Button variant="primary" onClick={save}>
          저장
        </Button>
      </div>
    </div>
  );
}

export function CareerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snap, store, toast } = usePlanner();
  const list = useMemo(() => liveCareer(snap.db), [snap.db]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);
  if (!open) return null;

  const blank = (): Draft => ({
    id: uuid(),
    title: "",
    kind: "project",
    start_day: dayKey(addDays(new Date(), -30)),
    end_day: dayKey(new Date()),
    raw: "",
    polished: "",
    skills: [],
    task_ids: [],
  });
  const byYear = new Map<string, CareerEntry[]>();
  for (const e of list) byYear.set(e.start_day.slice(0, 4), [...(byYear.get(e.start_day.slice(0, 4)) ?? []), e]);

  return (
    <Modal
      open
      onClose={() => {
        setEditing(null);
        setImporting(false);
        onClose();
      }}
      title={editing ? (list.some((x) => x.id === editing.id) ? "커리어 기록 고치기" : "새 커리어 기록") : importing ? "한 번에 넣기" : "커리어 기록"}
      subtitle={
        editing
          ? undefined
          : importing
            ? "정리해 둔 커리어 글을 그대로 붙여 넣으면 AI 가 항목별 기록으로 나눠요. 글은 고치지 않아요."
            : "했던 일을 그때그때 남겨 두면, 나중에 이력서·포트폴리오를 쓸 때 그대로 꺼내 쓸 수 있어요."
      }
      size="lg"
    >
      {editing ? (
        <Editor key={editing.id} initial={editing} onDone={() => setEditing(null)} />
      ) : importing ? (
        <CareerImport onDone={() => setImporting(false)} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setEditing(blank())}>
              <Plus size={16} /> 새 기록
            </Button>
            <Button onClick={() => setImporting(true)}>
              <ClipboardPaste size={16} /> 한 번에 넣기
            </Button>
            {list.length > 0 && (
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText(careerMarkdown(list));
                  toast({ text: "전체 기록을 복사했어요 — 이력서에 붙여 넣으세요", tone: "ok" });
                }}
              >
                <ClipboardCopy size={16} /> 전체 복사
              </Button>
            )}
          </div>
          {list.length === 0 ? (
            <Empty
              icon={<BriefcaseBusiness size={22} />}
              title="아직 기록이 없어요"
              desc="프로젝트·업무·자격증·공부한 것 무엇이든. 대충 적으면 AI 가 그 기간 일정과 노트를 참고해 이력서 문장으로 다듬어요. 정리해 둔 글이 있으면 '한 번에 넣기'로 통째로 붙여 넣어도 돼요."
            />
          ) : (
            [...byYear.entries()].map(([year, items]) => (
              <section key={year}>
                <p className="mb-2 text-[13px] font-bold text-muted">{year}</p>
                <ul className="space-y-2">
                  {items.map((e) => (
                    <li key={e.id} className="rounded-2xl border border-line bg-surface-2/50 p-4">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-accent/15 px-1.5 py-px text-[11px] font-bold text-accent-text">{kindLabel(e.kind)}</span>
                            <span className="font-bold">{e.title}</span>
                          </p>
                          <p className="mt-0.5 font-mono text-xs text-muted tabular-nums">{period(e)}</p>
                        </div>
                        <button aria-label="고치기" onClick={() => setEditing(e)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg">
                          <Pencil size={15} />
                        </button>
                        <button
                          aria-label="삭제"
                          onClick={() => {
                            deleteCareer(store, e.id);
                          }}
                          className="grid size-8 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"
                        >
                          <Trash size={15} />
                        </button>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{e.polished.trim() || e.raw.trim() || "(내용 없음)"}</p>
                      {e.skills.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {e.skills.map((s) => (
                            <span key={s} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </Modal>
  );
}
