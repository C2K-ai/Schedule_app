"use client";

import { CalendarClock, Play, SkipForward, TriangleAlert, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  enforcementQueue,
  isExpired,
  markMissed,
  postponeTask,
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
      <p className={cx("mt-1.5 text-right font-mono text-xs tabular-nums", ok ? "text-ok" : "text-muted")}>
        {len}/{minLength}자 {ok ? "✓" : "이상"}
      </p>
    </div>
  );
}

function TimeChoices({ base, value, now, onChange }: { base: Task; value: Date; now: number; onChange: (d: Date) => void }) {
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
  const { store, settings, toast, overdueRing, stopOverdue } = usePlanner();
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
                toast({ text: "▶ 좋아요. 지금 시작합니다", tone: "ok" });
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
                  toast({ text: `${fmtTime(newStart)}로 미뤘습니다 — 사유 기록됨` });
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
                  toast({ text: expired ? "놓침으로 기록했습니다" : "건너뛰기 — 사유 기록됨", tone: "danger" });
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
                  toast({ text: `${expiredOnes.length}개를 놓침으로 기록했습니다`, tone: "danger" });
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

/** 이미 시작 시각이 지난 일정을 끌어서 뒤로 옮길 때 — 이것도 ‘미루기’라 사유가 필요하다 */
export function PostponeDialog() {
  const { store, postpone } = usePlanner();
  const task = postpone ? store.db.tasks[postpone.taskId] : null;
  if (!postpone || !task) return null;
  return <PostponeCard key={`${task.id}:${postpone.start.getTime()}`} task={task} proposed={postpone.start} />;
}

function PostponeCard({ task, proposed }: { task: Task; proposed: Date }) {
  const { store, closePostpone, settings, toast } = usePlanner();
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
              toast({ text: `${fmtTime(start)}로 미뤘습니다 — 사유 기록됨` });
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
