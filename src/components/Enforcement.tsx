"use client";

import { CalendarClock, Check, CircleHelp, Play, SkipForward, Trash, TriangleAlert, VolumeX, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  checkinQueue,
  confirmDone,
  deleteTask,
  enforcementQueue,
  isExpired,
  markMissed,
  postponeTask,
  rescheduleTask,
  skipTask,
  startTask,
} from "@/lib/planner";
import { findSound, playSound, stopAllSounds } from "@/lib/sound";
import { addDays, addMinutes, atTime, fmtSpan, fmtTime, MIN, toHHMM } from "@/lib/time";
import { COLOR_HEX, type Task } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";
import { Button, Chip, cx, inputCls, Modal } from "./ui";

const PRESETS = ["다른 일이 길어졌다", "컨디션이 안 좋다", "깜빡했다", "계획을 너무 빡빡하게 잡았다", "갑자기 약속이 생겼다"];

/** 사유 입력 — 글자 수가 모자란데 확정을 누르면 흔들리고 포커스가 돌아온다 */
export function ReasonForm({
  value,
  onChange,
  minLength,
  placeholder = "왜 지금 못 하나요? 솔직하게 적어 두면 나중에 패턴이 보입니다.",
  shake,
}: {
  value: string;
  onChange: (v: string) => void;
  minLength: number;
  placeholder?: string;
  shake?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!shake || !el) return;
    el.classList.remove("shake");
    void el.offsetWidth; // 애니메이션 다시 시작
    el.classList.add("shake");
    ref.current?.focus();
  }, [shake]);
  const len = value.trim().length;
  const ok = len >= minLength;
  return (
    <div ref={wrap}>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(value ? `${value.trim()} ${p}` : p)}
            className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs text-muted hover:text-fg"
          >
            {p}
          </button>
        ))}
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className={cx(inputCls, "resize-none", !ok && len > 0 && "border-warn")}
      />
      {minLength > 0 && (
        <p className={cx("mt-1.5 text-right font-mono text-xs tabular-nums", ok ? "text-ok" : "text-muted")}>
          {len}/{minLength}자 {ok ? "✓" : "이상"}
        </p>
      )}
    </div>
  );
}

export function TimeChoices({ base, value, now, onChange }: { base: Task; value: Date; now: number; onChange: (d: Date) => void }) {
  const today = new Date(now);
  const origStart = new Date(base.starts_at);
  const roundNow = new Date(Math.ceil(now / (5 * MIN)) * 5 * MIN);
  const evening = atTime(today, "20:00");
  const tomorrowSame = atTime(addDays(today, 1), toHHMM(origStart));
  const opts: { label: string; d: Date }[] = [
    { label: "+15분", d: addMinutes(roundNow, 15) },
    { label: "+30분", d: addMinutes(roundNow, 30) },
    { label: "+1시간", d: addMinutes(roundNow, 60) },
    ...(evening.getTime() > now ? [{ label: "오늘 20:00", d: evening }] : []),
    { label: `내일 ${toHHMM(origStart)}`, d: tomorrowSame },
  ];
  const localValue = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}T${toHHMM(value)}`;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {opts.map((o) => (
          <Chip key={o.label} active={Math.abs(o.d.getTime() - value.getTime()) < MIN} onClick={() => onChange(o.d)}>
            {o.label}
          </Chip>
        ))}
      </div>
      <input
        type="datetime-local"
        value={localValue}
        onChange={(e) => e.target.value && onChange(new Date(e.target.value))}
        className={inputCls}
      />
    </div>
  );
}

const nextSlot = (now: number) => new Date(Math.ceil(now / (5 * MIN)) * 5 * MIN + 15 * MIN);

/** 미시작 경고음 — 화면 없이 소리만. 경고창의 '경고음 끄기'나 어떤 처리를 하면 멈춘다(최대 45초). */
export function OverdueSiren() {
  const { overdueRing, stopOverdue, settings } = usePlanner();
  const key = overdueRing?.key;
  useEffect(() => {
    if (!overdueRing) return;
    let replaced = false;
    const h = playSound(findSound(overdueRing.soundId, settings.customSounds), {
      loop: true,
      escalate: true,
      volume: settings.volume,
      maxSeconds: 45,
      // 다 울리고 끝났을 때만 상태를 비운다(다음 경고로 바뀌어 멈춘 경우는 그대로 둔다)
      onEnd: () => !replaced && stopOverdue(),
    });
    return () => {
      replaced = true;
      h.stop();
    };
    // 같은 경고가 이어지는 동안 설정 변경으로 다시 울리지 않게 key 기준
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

type Step = "choose" | "postpone" | "skip" | "bulk";

/** 미시작 일정 강제 처리 — 닫기 버튼이 없다. 시작하거나 사유를 써야 넘어간다. */
export function EnforcementModal({ suppressed }: { suppressed: boolean }) {
  const { tasks, settings } = usePlanner();
  const now = useNow(5000);
  const queue = useMemo(() => enforcementQueue(tasks, now, settings.graceMin), [tasks, now, settings.graceMin]);
  if (!queue.length || suppressed) return null;
  // 일정이 바뀌면 key 가 바뀌어 단계·사유 입력이 처음부터 시작된다
  return <EnforcementCard key={queue[0].id} task={queue[0]} queue={queue} now={now} />;
}

function EnforcementCard({ task, queue, now }: { task: Task; queue: Task[]; now: number }) {
  const { store, settings, overdueRing, stopOverdue } = usePlanner();
  const [step, setStep] = useState<Step>("choose");
  const [reason, setReason] = useState("");
  const [shake, setShake] = useState(0);
  const [newStart, setNewStart] = useState<Date>(() => nextSlot(now));

  const expired = isExpired(task, now);
  const late = now - Date.parse(task.starts_at);
  const expiredOnes = queue.filter((t) => isExpired(t, now));
  const pc = task.postpone_count;
  const pressure =
    pc >= settings.postponeWarnAt + 1
      ? `${pc + 1}번째 미루기입니다. 이 일정, 정말 할 생각이 있나요? 아니면 계획을 바꾸세요.`
      : pc >= settings.postponeWarnAt
        ? `벌써 ${pc}번 미뤘어요. 이번엔 진짜로 지키세요.`
        : pc === 1
          ? "한 번 미룬 일정이에요."
          : null;

  const need = settings.reasonMinLength;
  const valid = reason.trim().length >= need;
  const guard = (fn: () => void) => {
    if (!valid) return setShake((n) => n + 1);
    fn();
    stopOverdue();
    stopAllSounds();
  };

  return (
    <Modal open size="md" tone="danger" className="border-danger/70!">
      <div className="tape -mx-5 mb-5 h-2.5 md:-mx-6" />
      {overdueRing && (
        <button
          onClick={() => {
            stopOverdue();
            stopAllSounds();
          }}
          className="absolute top-5 right-4 inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-muted hover:text-fg"
        >
          <VolumeX size={14} /> 경고음 끄기
        </button>
      )}
      <div className="flex items-start gap-3">
        <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-danger-soft text-danger">
          <TriangleAlert size={26} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-widest text-danger uppercase">
            {expired ? "놓친 일정" : "시작하지 않은 일정"} {queue.length > 1 && `· 1 / ${queue.length}`}
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight md:text-2xl">{task.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="size-2 rounded-full" style={{ background: COLOR_HEX[task.color] }} />
            <span className="font-mono tabular-nums">
              {fmtTime(task.starts_at)} – {fmtTime(task.ends_at)}
            </span>
            <span className="font-semibold text-danger">· {fmtSpan(late)} 지남</span>
          </p>
        </div>
      </div>
      {pressure && (
        <p className="mt-4 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm font-semibold text-warn">
          {pressure}
        </p>
      )}

      {step === "choose" && (
        <div className="mt-5 grid gap-2">
          {!expired && (
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => {
                startTask(store, task.id);
                stopOverdue();
                stopAllSounds();
              }}
            >
              <Play size={18} /> 지금 바로 시작
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setStep("postpone")}>
              <CalendarClock size={18} /> {expired ? "다시 잡기" : "미루기"}
            </Button>
            <Button variant="dangerSoft" size="lg" onClick={() => setStep("skip")}>
              <SkipForward size={18} /> {expired ? "놓침 기록" : "건너뛰기"}
            </Button>
          </div>
          <p className="mt-1 text-center text-xs text-muted">미루기·건너뛰기는 사유 {need}자 이상이 필요하고, 기록에 남습니다.</p>
          {expiredOnes.length >= 2 && (
            <button onClick={() => setStep("bulk")} className="mt-1 text-center text-xs font-semibold text-muted underline">
              놓친 일정 {expiredOnes.length}개를 한 번에 기록하기
            </button>
          )}
        </div>
      )}

      {step === "postpone" && (
        <div className="mt-5 space-y-4">
          <div>
            <p className="mb-2 text-sm font-semibold">언제로 미룰까요?</p>
            <TimeChoices base={task} value={newStart} now={now} onChange={setNewStart} />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">미루는 사유</p>
            <ReasonForm value={reason} onChange={setReason} minLength={need} shake={shake} />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep("choose")}>
              뒤로
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={newStart.getTime() <= now}
              onClick={() =>
                guard(() => {
                  postponeTask(store, task.id, newStart, reason.trim());
                })
              }
            >
              미루기 확정 ({fmtTime(newStart)})
            </Button>
          </div>
        </div>
      )}

      {step === "skip" && (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-muted">
            {expired
              ? "이 일정을 ‘놓침’으로 기록합니다. 달성률에서 빠지지 않습니다."
              : "오늘은 이 일정을 하지 않습니다. 건너뛴 것도 달성률에서 빠지지 않습니다."}
          </p>
          <ReasonForm value={reason} onChange={setReason} minLength={need} shake={shake} />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep("choose")}>
              뒤로
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() =>
                guard(() => {
                  if (expired) markMissed(store, task.id, reason.trim());
                  else skipTask(store, task.id, reason.trim());
                })
              }
            >
              {expired ? "놓침으로 기록" : "건너뛰기 확정"}
            </Button>
          </div>
        </div>
      )}

      {step === "bulk" && (
        <div className="mt-5 space-y-4">
          <ul className="space-y-1 rounded-xl bg-surface-2 p-3 text-sm">
            {expiredOnes.map((t) => (
              <li key={t.id} className="flex gap-2">
                <span className="font-mono text-muted tabular-nums">{fmtTime(t.starts_at)}</span>
                <span className="truncate">{t.title}</span>
              </li>
            ))}
          </ul>
          <ReasonForm value={reason} onChange={setReason} minLength={need} shake={shake} />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep("choose")}>
              뒤로
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() =>
                guard(() => {
                  expiredOnes.forEach((t) => markMissed(store, t.id, reason.trim()));
                })
              }
            >
              {expiredOnes.length}개 모두 놓침으로 기록
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * 끝났는데 체크를 안 한 일정 — 실패로 치지 않고 '했나요?' 하나씩 묻는다.
 * 했어요 → 그 시간에 한 것으로 완료. 못 했어요 → 다시 잡기 또는 놓침 기록(강제 모드 일정만 사유 필요).
 * 강제 모드가 아닌 일정은 '나중에'로 이번엔 넘길 수 있다(앱을 다시 열면 또 묻는다).
 */
export function CheckinModal({ suppressed }: { suppressed: boolean }) {
  const { tasks, settings } = usePlanner();
  const now = useNow(15_000);
  const [later, setLater] = useState<string[]>([]);
  const blocking = useMemo(() => enforcementQueue(tasks, now, settings.graceMin).length > 0, [tasks, now, settings.graceMin]);
  const queue = useMemo(() => checkinQueue(tasks, now).filter((t) => !later.includes(t.id)), [tasks, now, later]);
  if (!queue.length || suppressed || blocking) return null;
  return (
    <CheckinCard
      key={queue[0].id}
      task={queue[0]}
      queue={queue}
      now={now}
      onLater={queue[0].strict ? null : () => setLater((l) => [...l, queue[0].id])}
    />
  );
}

type CheckStep = "ask" | "not" | "postpone" | "missed" | "allDone" | "allMissed";

function CheckinCard({ task, queue, now, onLater }: { task: Task; queue: Task[]; now: number; onLater: (() => void) | null }) {
  const { store, settings, stopOverdue } = usePlanner();
  const [step, setStep] = useState<CheckStep>("ask");
  const [reason, setReason] = useState("");
  const [shake, setShake] = useState(0);
  const [newStart, setNewStart] = useState<Date>(() => nextSlot(now));
  // 강제 모드 일정만 사유가 꼭 필요(설정 글자 수), 아니면 적어도 되고 안 적어도 된다
  const need = task.strict ? settings.reasonMinLength : 0;
  const needAll = queue.some((t) => t.strict) ? settings.reasonMinLength : 0;
  const ago = now - Date.parse(task.ends_at);
  const d = new Date(task.starts_at);
  const sameDay = d.toDateString() === new Date(now).toDateString();
  const yesterday = d.toDateString() === addDays(new Date(now), -1).toDateString();
  const dayLabel = sameDay ? "오늘" : yesterday ? "어제" : `${d.getMonth() + 1}/${d.getDate()}`;
  const quiet = () => {
    stopOverdue();
    stopAllSounds();
  };
  const guard = (min: number, fn: () => void) => {
    if (reason.trim().length < min) return setShake((n) => n + 1);
    fn();
    quiet();
  };

  return (
    <Modal open size="md">
      <div className="flex items-start gap-3 pt-1">
        <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent/15 text-accent-text">
          <CircleHelp size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold tracking-widest text-accent-text">
            이 일정 했나요? {queue.length > 1 && `· 1 / ${queue.length}`}
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight break-words md:text-2xl">{task.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="size-2 rounded-full" style={{ background: COLOR_HEX[task.color] }} />
            <span className="font-mono tabular-nums">
              {dayLabel} {fmtTime(task.starts_at)} – {fmtTime(task.ends_at)}
            </span>
            <span>· 끝난 지 {fmtSpan(ago)}</span>
          </p>
        </div>
        {onLater && step === "ask" && (
          <button
            onClick={onLater}
            aria-label="나중에"
            className="-mt-1 -mr-2 grid size-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {step === "ask" && (
        <div className="mt-5 grid gap-2">
          <p className="text-sm text-muted">체크를 안 해서 물어봐요. 했다면 그 시간에 한 걸로 기록할게요.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                confirmDone(store, task.id);
                quiet();
              }}
            >
              <Check size={18} strokeWidth={3} /> 했어요
            </Button>
            <Button variant="outline" size="lg" onClick={() => setStep("not")}>
              <X size={18} /> 못 했어요
            </Button>
          </div>
          {onLater && (
            <button onClick={onLater} className="mt-1 text-center text-xs font-semibold text-muted hover:text-fg">
              나중에 대답할게요
            </button>
          )}
          {queue.length >= 2 && (
            <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-line pt-3 text-xs font-semibold text-muted">
              <button onClick={() => setStep("allDone")} className="underline hover:text-fg">
                {queue.length}개 모두 했어요
              </button>
              <button onClick={() => setStep("allMissed")} className="underline hover:text-fg">
                {queue.length}개 모두 못 했어요
              </button>
            </div>
          )}
        </div>
      )}

      {step === "not" && (
        <div className="mt-5 grid gap-2">
          <p className="text-sm text-muted">괜찮아요. 다시 할 시간을 잡을까요, 이번엔 못 한 걸로 남길까요?</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" size="lg" onClick={() => setStep("postpone")}>
              <CalendarClock size={18} /> 다시 잡기
            </Button>
            <Button variant="dangerSoft" size="lg" onClick={() => setStep("missed")}>
              <SkipForward size={18} /> 못 한 걸로
            </Button>
          </div>
          <Button variant="ghost" onClick={() => setStep("ask")}>
            뒤로
          </Button>
        </div>
      )}

      {step === "postpone" && (
        <div className="mt-5 space-y-4">
          <div>
            <p className="mb-2 text-sm font-semibold">언제 다시 할까요?</p>
            <TimeChoices base={task} value={newStart} now={now} onChange={setNewStart} />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">못 한 이유 {need === 0 && <span className="font-normal text-muted">(적어도 되고 안 적어도 돼요)</span>}</p>
            <ReasonForm value={reason} onChange={setReason} minLength={need} shake={shake} placeholder="왜 못 했나요? 적어 두면 나중에 패턴이 보여요." />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep("not")}>
              뒤로
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={newStart.getTime() <= now}
              onClick={() => guard(need, () => postponeTask(store, task.id, newStart, reason.trim() || "못 했어요"))}
            >
              {fmtTime(newStart)}로 다시 잡기
            </Button>
          </div>
        </div>
      )}

      {step === "missed" && (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-muted">이 일정을 ‘놓침’으로 기록해요. 나중에 목록에서 눌러 다시 잡을 수도 있어요.</p>
          <ReasonForm value={reason} onChange={setReason} minLength={need} shake={shake} placeholder="왜 못 했나요? 적어 두면 나중에 패턴이 보여요." />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep("not")}>
              뒤로
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => guard(need, () => markMissed(store, task.id, reason.trim() || "못 했어요"))}>
              못 한 걸로 기록
            </Button>
          </div>
        </div>
      )}

      {(step === "allDone" || step === "allMissed") && (
        <div className="mt-5 space-y-4">
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-surface-2 p-3 text-sm">
            {queue.map((t) => (
              <li key={t.id} className="flex gap-2">
                <span className="shrink-0 font-mono text-muted tabular-nums">
                  {new Date(t.starts_at).getMonth() + 1}/{new Date(t.starts_at).getDate()} {fmtTime(t.starts_at)}
                </span>
                <span className="truncate">{t.title}</span>
              </li>
            ))}
          </ul>
          {step === "allMissed" && (
            <ReasonForm value={reason} onChange={setReason} minLength={needAll} shake={shake} placeholder="왜 못 했나요? 적어 두면 나중에 패턴이 보여요." />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep("ask")}>
              뒤로
            </Button>
            {step === "allDone" ? (
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => {
                  queue.forEach((t) => confirmDone(store, t.id));
                  quiet();
                }}
              >
                <Check size={16} strokeWidth={3} /> {queue.length}개 모두 했어요
              </Button>
            ) : (
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => guard(needAll, () => queue.forEach((t) => markMissed(store, t.id, reason.trim() || "못 했어요")))}
              >
                {queue.length}개 모두 못 한 걸로 기록
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** 이미 시작 시각이 지난 일정을 끌어서 뒤로 옮길 때 — 이것도 ‘미루기’라 사유가 필요하다 */
export function PostponeDialog() {
  const { store, postpone } = usePlanner();
  const task = postpone ? store.db.tasks[postpone.taskId] : null;
  if (!postpone || !task) return null;
  return <PostponeCard key={`${task.id}:${postpone.start.getTime()}`} task={task} proposed={postpone.start} />;
}

function PostponeCard({ task, proposed }: { task: Task; proposed: Date }) {
  const { store, closePostpone, settings } = usePlanner();
  const now = useNow(5000);
  const [reason, setReason] = useState("");
  const [shake, setShake] = useState(0);
  const [start, setStart] = useState<Date>(proposed);
  const need = settings.reasonMinLength;
  return (
    <Modal
      open
      onClose={closePostpone}
      title="미루려면 사유가 필요해요"
      subtitle={`‘${task.title}’은(는) 이미 ${fmtTime(task.starts_at)}에 시작했어야 합니다.`}
    >
      <div className="space-y-4">
        <TimeChoices base={task} value={start} now={now} onChange={setStart} />
        <ReasonForm value={reason} onChange={setReason} minLength={need} shake={shake} />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={closePostpone}>
            취소
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={start.getTime() <= now}
            onClick={() => {
              if (reason.trim().length < need) return setShake((n) => n + 1);
              postponeTask(store, task.id, start, reason.trim());
              closePostpone();
            }}
          >
            {fmtTime(start)}로 미루기
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** 못 한 일정(놓침·건너뜀)을 눌렀을 때 — 언제 다시 할지 정하면 그날 목록에서 빠지고 새 시각으로 간다 */
export function RescheduleDialog() {
  const { store, reschedule } = usePlanner();
  const task = reschedule ? store.db.tasks[reschedule] : null;
  if (!reschedule || !task) return null;
  return <RescheduleCard key={task.id} task={task} />;
}

function RescheduleCard({ task }: { task: Task }) {
  const { store, closeReschedule } = usePlanner();
  const now = useNow(5000);
  const [start, setStart] = useState<Date>(() => nextSlot(now));
  const [sure, setSure] = useState(false);
  const what = task.status === "skipped" ? "건너뛴" : "못 한";
  return (
    <Modal
      open
      onClose={closeReschedule}
      title="언제 다시 할까요?"
      subtitle={`‘${task.title}’ — ${fmtTime(task.starts_at)}에 ${what} 일정이에요.`}
      footer={
        <div className="flex items-center gap-2">
          <Button
            variant={sure ? "danger" : "ghost"}
            onClick={() => {
              if (!sure) return setSure(true);
              deleteTask(store, task.id);
              closeReschedule();
            }}
          >
            <Trash size={15} /> {sure ? "정말 지우기" : "지우기"}
          </Button>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={closeReschedule}>
              그대로 두기
            </Button>
            <Button
              variant="primary"
              disabled={start.getTime() <= now}
              onClick={() => {
                rescheduleTask(store, task.id, start);
                closeReschedule();
              }}
            >
              {start.toDateString() === new Date(now).toDateString() ? fmtTime(start) : `${start.getMonth() + 1}/${start.getDate()} ${fmtTime(start)}`}로 다시 잡기
            </Button>
          </div>
        </div>
      }
    >
      <TimeChoices base={task} value={start} now={now} onChange={setStart} />
      <p className="mt-3 text-xs text-muted">다시 잡으면 이날 목록에서 빠져요. {what === "못 한" ? "놓친" : "건너뛴"} 기록은 변명 노트에 그대로 남아요.</p>
    </Modal>
  );
}
