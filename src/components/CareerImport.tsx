"use client";

import { Check, ChevronDown, ChevronUp, Loader2, Plus, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { importCareer } from "@/lib/ai";
import { CAREER_IMPORT_MAX, CAREER_KINDS, careerPeriod, kindLabel, toDrafts, unusedLines, type ImportDraft } from "@/lib/career";
import { liveCareer, saveCareer } from "@/lib/planner";
import { getSupabase } from "@/lib/supabase";
import { dayKey, uuid } from "@/lib/time";
import { usePlanner } from "./PlannerProvider";
import { Button, cx, inputCls, Label } from "./ui";

const EXAMPLE = `예)
프로젝트
캠퍼스 중고거래 앱, 2025.03 ~ 2025.06
Spring Boot로 거래 API 구현, 사용자 120명
자격증·어학
2025.08  정보처리기사  합격
2026.01  TOEIC  880점
학생 활동
학과 학생회: 2024.03~`;

/** 초안 하나 고치기 — 제목·종류·기간·내용·기술 */
function DraftFields({ d, onChange }: { d: ImportDraft; onChange: (p: Partial<ImportDraft>) => void }) {
  const [skillText, setSkillText] = useState(d.skills.join(", "));
  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      <input value={d.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="제목" className={cx(inputCls, "font-semibold")} />
      <div className="flex flex-wrap gap-1.5">
        {CAREER_KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => onChange({ kind: k.value })}
            className={cx(
              "h-7 rounded-lg px-2.5 text-xs font-semibold transition",
              d.kind === k.value ? "bg-accent text-accent-fg" : "bg-surface-3 text-muted hover:text-fg",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>시작</Label>
          <input
            type="date"
            value={d.start_day}
            onChange={(e) => e.target.value && onChange({ start_day: e.target.value, date_guess: false })}
            className={inputCls}
          />
        </div>
        <div>
          <Label
            hint={
              <button
                type="button"
                onClick={() => onChange({ end_day: d.end_day ? null : d.start_day, date_guess: false })}
                className="font-semibold text-accent-text"
              >
                {d.end_day ? "진행 중으로" : "끝 날짜 넣기"}
              </button>
            }
          >
            끝
          </Label>
          {d.end_day ? (
            <input
              type="date"
              value={d.end_day}
              onChange={(e) => e.target.value && onChange({ end_day: e.target.value, date_guess: false })}
              className={inputCls}
            />
          ) : (
            <p className={cx(inputCls, "text-muted")}>진행 중</p>
          )}
        </div>
      </div>
      <textarea
        value={d.raw}
        onChange={(e) => onChange({ raw: e.target.value })}
        rows={Math.min(8, Math.max(3, d.raw.split("\n").length + 1))}
        className={cx(inputCls, "resize-y leading-relaxed")}
      />
      <input
        value={skillText}
        onChange={(e) => {
          setSkillText(e.target.value);
          onChange({ skills: [...new Set(e.target.value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 20) });
        }}
        placeholder="기술·역량 (쉼표로 구분)"
        className={inputCls}
      />
    </div>
  );
}

/** 커리어 '한 번에 넣기' — 붙여 넣기 → AI 가 나눔 → 미리보기에서 고르고 고쳐서 넣기 */
export function CareerImport({ onDone }: { onDone: () => void }) {
  const { store, session } = usePlanner();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ImportDraft[] | null>(null);
  const [unused, setUnused] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const split = async () => {
    const body = text.trim();
    if (!body) return setErr("정리해 둔 글을 붙여 넣어 주세요.");
    if (body.length > CAREER_IMPORT_MAX) return setErr(`글이 너무 길어요. ${CAREER_IMPORT_MAX.toLocaleString()}자씩 나눠서 넣어 주세요.`);
    const sb = getSupabase();
    if (!sb || !session.userId) return setErr("AI 나누기는 로그인한 상태에서만 쓸 수 있어요 (설정 → 계정).");
    setErr(null);
    setBusy(true);
    try {
      const list = await importCareer(sb, body, dayKey(new Date()));
      if (!list.length) return setErr("커리어로 넣을 항목을 찾지 못했어요. 글을 확인해 주세요.");
      setDrafts(toDrafts(list, liveCareer(store.db)));
      setUnused(unusedLines(body, list));
      setOpen(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!drafts) {
    return (
      <div className="space-y-4">
        <div>
          <Label hint={`${text.length.toLocaleString()} / ${CAREER_IMPORT_MAX.toLocaleString()}자`}>정리해 둔 커리어 글</Label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder={EXAMPLE}
            className={cx(inputCls, "resize-y font-mono text-[13px] leading-relaxed", text.length > CAREER_IMPORT_MAX && "border-danger")}
          />
        </div>
        <ul className="space-y-1 text-[13px] text-muted">
          <li>· 메모·한글·노션에 정리해 둔 그대로 붙여 넣으세요. 표·글머리표도 괜찮아요.</li>
          <li>· 항목마다 하나의 기록이 되고, 내용은 적은 글 그대로 들어가요. 날짜·종류만 AI 가 정리해요.</li>
          <li>· 넣기 전에 하나씩 확인하고 고칠 수 있어요. 나중에 기록마다 &lsquo;AI로 다듬기&rsquo;도 돼요.</li>
        </ul>
        {err && <ErrorLine text={err} />}
        <Button variant="primary" onClick={split} disabled={busy || !text.trim()} className="w-full">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {busy ? "항목별로 나누는 중… (20초쯤)" : "AI로 나누기"}
        </Button>
      </div>
    );
  }

  const picked = drafts.filter((d) => d.on);
  // 연 칸이 화면 밖이면 보이게(새로 넣은 줄·고칠 게 있는 칸)
  const reveal = (key: string) => {
    setOpen(key);
    requestAnimationFrame(() => document.getElementById(`draft-${key}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const patch = (key: string, p: Partial<ImportDraft>) => setDrafts((cur) => cur && cur.map((d) => (d.key === key ? { ...d, ...p } : d)));

  const addLine = (line: string) => {
    const today = dayKey(new Date());
    const key = `u-${uuid()}`;
    setDrafts([
      ...drafts,
      { key, title: line.slice(0, 60), kind: "etc", start_day: today, end_day: today, raw: line, skills: [], date_guess: true, on: true, dup: false },
    ]);
    setUnused(unused.filter((x) => x !== line));
    reveal(key);
  };

  const save = () => {
    const bad = picked.find((d) => !d.title.trim() || (d.end_day !== null && d.end_day < d.start_day));
    if (bad) {
      reveal(bad.key);
      return setErr(bad.title.trim() ? `'${bad.title}' 의 끝 날짜가 시작보다 앞서요.` : "제목이 빈 기록이 있어요.");
    }
    for (const d of picked) {
      saveCareer(store, {
        id: uuid(),
        title: d.title.trim().slice(0, 120),
        kind: d.kind,
        start_day: d.start_day,
        end_day: d.end_day,
        raw: d.raw.trim(),
        polished: "",
        skills: d.skills,
        task_ids: [],
      });
    }
    onDone();
  };

  const guesses = picked.filter((d) => d.date_guess).length;
  const dups = drafts.filter((d) => d.dup).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {drafts.length}개로 나눴어요 · <span className="text-accent-text">{picked.length}개 넣기</span>
        </p>
        <button
          type="button"
          onClick={() => setDrafts(drafts.map((d) => ({ ...d, on: picked.length !== drafts.length })))}
          className="text-[13px] font-semibold text-muted hover:text-fg"
        >
          {picked.length === drafts.length ? "모두 빼기" : "모두 고르기"}
        </button>
      </div>
      {(guesses > 0 || dups > 0) && (
        <p className="text-[13px] text-muted">
          {guesses > 0 && <>날짜가 글에 없던 {guesses}개는 <b className="text-warn">날짜 확인</b> 표시 — 눌러서 고쳐 주세요. </>}
          {dups > 0 && <>이미 있는 기록 {dups}개는 빼 두었어요.</>}
        </p>
      )}

      {unused.length > 0 && (
        <div className="rounded-2xl border border-warn/40 bg-warn/10 p-3">
          <p className="text-[13px] font-semibold">AI 가 넣지 않은 줄 {unused.length}개 — 필요하면 기록으로 넣으세요</p>
          <ul className="mt-2 space-y-1">
            {unused.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[13px]">
                <span className="min-w-0 flex-1 break-words text-muted">{line}</span>
                <button type="button" onClick={() => addLine(line)} className="flex shrink-0 items-center gap-0.5 font-semibold text-accent-text">
                  <Plus size={13} /> 기록으로
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-2">
        {drafts.map((d) => {
          const editing = open === d.key;
          return (
            <li key={d.key} id={`draft-${d.key}`} className={cx("rounded-2xl border p-3", d.on ? "border-line bg-surface-2/50" : "border-line/60 opacity-60")}>
              <div className="flex items-start gap-2.5">
                <button
                  type="button"
                  aria-label={d.on ? "빼기" : "넣기"}
                  onClick={() => patch(d.key, { on: !d.on })}
                  className={cx(
                    "mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg border-2 transition",
                    d.on ? "border-accent bg-accent text-accent-fg" : "border-line-strong",
                  )}
                >
                  {d.on && <Check size={14} strokeWidth={3} />}
                </button>
                <button type="button" onClick={() => setOpen(editing ? null : d.key)} className="min-w-0 flex-1 text-left">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-accent/15 px-1.5 py-px text-[11px] font-bold text-accent-text">{kindLabel(d.kind)}</span>
                    <span className="font-bold">{d.title || "(제목 없음)"}</span>
                    {d.dup && <span className="rounded-md bg-surface-3 px-1.5 py-px text-[11px] font-bold text-muted">이미 있음</span>}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted tabular-nums">
                    {careerPeriod(d)}
                    {d.date_guess && <span className="rounded bg-warn/15 px-1 font-sans text-[11px] font-bold text-warn">날짜 확인</span>}
                  </span>
                  {!editing && d.raw && <span className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed whitespace-pre-line text-fg/85">{d.raw}</span>}
                  {!editing && d.skills.length > 0 && (
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {d.skills.map((s) => (
                        <span key={s} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                          {s}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={editing ? "접기" : "고치기"}
                  onClick={() => setOpen(editing ? null : d.key)}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg"
                >
                  {editing ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>
              {editing && <DraftFields d={d} onChange={(p) => patch(d.key, p)} />}
            </li>
          );
        })}
      </ul>

      {err && <ErrorLine text={err} />}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setDrafts(null);
            setErr(null);
          }}
        >
          글 다시 고치기
        </Button>
        <Button variant="primary" onClick={save} disabled={picked.length === 0}>
          {picked.length}개 넣기
        </Button>
      </div>
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
      <TriangleAlert size={16} className="mt-0.5 shrink-0" />
      {text}
    </p>
  );
}
