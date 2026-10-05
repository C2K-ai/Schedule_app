"use client";

import { Bell, BellRing, Cloud, Download, KeyRound, LogOut, Mail, Monitor, Moon, RefreshCw, Smartphone, Sun, Upload, Vibrate, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  isIOS,
  isStandalone,
  notificationPermission,
  requestNotificationPermission,
  showSystemNotification,
  type PermissionState,
} from "@/lib/notify";
import { OFFSET_CHOICES } from "@/lib/settings";
import { currentPushSubscription, pushSupported, sendTestPush, subscribePush, unsubscribePush } from "@/lib/push";
import { BUILTIN_SOUNDS, findSound, playSound, unlockAudio, vibrate, VIBRATIONS } from "@/lib/sound";
import { hasLocalData, readLocalDb } from "@/lib/store";
import { cloudEnabled, getSupabase } from "@/lib/supabase";
import { fmtOffset, uuid } from "@/lib/time";
import type { AlarmTheme, Settings, VibrationKey } from "@/lib/types";
import { usePlanner } from "./PlannerProvider";
import { SoundStudio } from "./SoundStudio";
import { Button, Chip, cx, inputCls, Label, Modal, Segmented, Switch } from "./ui";

type Tab = "notify" | "sound" | "rules" | "focus" | "account" | "data";

const TABS: { value: Tab; label: string }[] = [
  { value: "notify", label: "알림" },
  { value: "sound", label: "소리" },
  { value: "rules", label: "강제 규칙" },
  { value: "focus", label: "집중" },
  { value: "account", label: "동기화" },
  { value: "data", label: "화면·데이터" },
];

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-5 first:pt-1 last:border-0">
      <h3 className="font-bold">{title}</h3>
      {desc && <p className="mt-1 text-sm leading-relaxed text-muted">{desc}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="py-1.5">
      <Label hint={<span className="font-mono text-sm font-bold text-fg tabular-nums">{value}{unit}</span>}>{label}</Label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </div>
  );
}

function NotifyTab() {
  const { settings, updateSettings, session, ring, toast } = usePlanner();
  const [perm, setPerm] = useState<PermissionState>(() => notificationPermission());
  const [pushOn, setPushOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Settings>) => updateSettings(p);

  useEffect(() => {
    void currentPushSubscription().then((s) => setPushOn(Boolean(s)));
  }, []);

  const ios = isIOS();
  const standalone = isStandalone();
  const sb = getSupabase();

  return (
    <>
      <Section
        title="1. 알림 권한"
        desc="브라우저가 알림을 띄울 수 있어야 합니다. 거부했다면 주소창 왼쪽 자물쇠 → 알림 → 허용으로 바꾸세요."
      >
        {ios && !standalone && (
          <p className="mb-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            iPhone/iPad는 <b>Safari 공유 버튼 → 홈 화면에 추가</b>로 설치한 뒤, 설치된 앱 안에서 권한을 켜야 알림이 옵니다.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cx(
              "rounded-lg px-2.5 py-1 text-sm font-bold",
              perm === "granted" ? "bg-ok/15 text-ok" : perm === "denied" ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted",
            )}
          >
            {perm === "granted" ? "허용됨" : perm === "denied" ? "차단됨" : perm === "unsupported" ? "지원 안 함" : "아직 안 물어봄"}
          </span>
          {perm !== "granted" && perm !== "unsupported" && (
            <Button
              variant="primary"
              onClick={async () => {
                unlockAudio();
                setPerm(await requestNotificationPermission());
              }}
            >
              <Bell size={16} /> 알림 켜기
            </Button>
          )}
          <Button
            onClick={async () => {
              unlockAudio();
              const ok = await showSystemNotification({
                title: "🔔 MUST 알림 테스트",
                body: "이게 보이면 시스템 알림이 정상입니다.",
                tag: `must-test-${uuid()}`,
                kind: "start",
                vibration: settings.vibration,
              });
              if (!ok) toast({ text: "알림을 띄우지 못했습니다 — 권한을 확인하세요", tone: "danger" });
            }}
          >
            시스템 알림 테스트
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              unlockAudio();
              ring({
                key: `preview-${uuid()}`,
                kind: "start",
                seq: 0,
                taskId: null,
                title: "알람 미리보기",
                body: "정각이 되면 이렇게 화면을 덮고 울립니다",
                soundId: settings.sounds.start,
                at: Date.now(),
              });
            }}
          >
            <BellRing size={16} /> 전체화면 알람 미리보기
          </Button>
        </div>
      </Section>

      <Section
        title="2. 앱이 꺼져 있어도 받기 (서버 푸시)"
        desc="앱을 닫아도 정각·미시작 경고가 오게 하려면 이 기기를 서버 푸시에 등록하세요. 기기마다 한 번씩."
      >
        {!cloudEnabled ? (
          <p className="text-sm text-muted">
            지금은 <b>로컬 모드</b>라 서버가 없습니다. 앱(탭)이 열려 있는 동안에만 알림이 옵니다. Supabase를 연결하면
            켜집니다 — <code className="rounded bg-surface-2 px-1">docs/SETUP-SUPABASE.md</code> 참고.
          </p>
        ) : !session.userId ? (
          <p className="text-sm text-muted">먼저 ‘동기화’ 탭에서 로그인하세요.</p>
        ) : !pushSupported() ? (
          <p className="text-sm text-muted">이 브라우저는 Web Push를 지원하지 않거나 VAPID 공개키가 설정되지 않았습니다.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx("rounded-lg px-2.5 py-1 text-sm font-bold", pushOn ? "bg-ok/15 text-ok" : "bg-surface-2 text-muted")}>
              {pushOn ? "이 기기 등록됨" : "등록 안 됨"}
            </span>
            {pushOn ? (
              <>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await sendTestPush(sb!);
                      toast({ text: `푸시 보냄: ${r.sent}개 기기`, tone: "ok" });
                    } catch (e) {
                      toast({ text: `실패: ${(e as Error).message}`, tone: "danger" });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  서버 푸시 테스트
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await unsubscribePush(sb!);
                    setPushOn(false);
                  }}
                >
                  등록 해제
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const p = await requestNotificationPermission();
                    setPerm(p);
                    if (p !== "granted") throw new Error("알림 권한이 필요합니다");
                    await subscribePush(sb!, session.userId!);
                    setPushOn(true);
                    toast({ text: "이 기기가 서버 푸시에 등록됐습니다", tone: "ok" });
                  } catch (e) {
                    toast({ text: `등록 실패: ${(e as Error).message}`, tone: "danger" });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Smartphone size={16} /> 이 기기 등록
              </Button>
            )}
          </div>
        )}
      </Section>

      <Section title="기본 알림 시점" desc="새 일정을 만들 때 미리 선택되는 알림입니다.">
        <div className="flex flex-wrap gap-1.5">
          {OFFSET_CHOICES.map((o) => (
            <Chip
              key={o}
              active={settings.defaultOffsets.includes(o)}
              onClick={() =>
                set({
                  defaultOffsets: settings.defaultOffsets.includes(o)
                    ? settings.defaultOffsets.filter((x) => x !== o)
                    : [...settings.defaultOffsets, o].sort((a, b) => b - a),
                })
              }
            >
              {fmtOffset(o)}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="알람 연출">
        <Label>전체화면 알람 테마</Label>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { v: "pulse", name: "펄스", bg: "radial-gradient(circle at 50% 50%, rgba(200,255,46,.45) 0 18%, transparent 19% 32%, rgba(200,255,46,.25) 33% 35%, #07080b 36%)" },
              { v: "strobe", name: "스트로브", bg: "linear-gradient(135deg,#ff3d5a 0 50%,#12030a 50%)" },
              { v: "calm", name: "차분하게", bg: "radial-gradient(circle,rgba(200,255,46,.28),#07080b 70%)" },
            ] as { v: AlarmTheme; name: string; bg: string }[]
          ).map((t) => (
            <button
              key={t.v}
              onClick={() => set({ alarmTheme: t.v })}
              className={cx(
                "overflow-hidden rounded-2xl border-2 text-left transition",
                settings.alarmTheme === t.v ? "border-accent" : "border-line",
              )}
            >
              <div className="h-16" style={{ background: t.bg }} />
              <p className="px-3 py-2 text-sm font-semibold">{t.name}</p>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">스트로브는 미시작 경고에서만 깜빡입니다. 빛에 민감하면 ‘차분하게’를 고르세요.</p>

        <div className="mt-4">
          <Label>진동 패턴 (안드로이드)</Label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(VIBRATIONS) as VibrationKey[]).map((k) => (
              <Chip
                key={k}
                active={settings.vibration === k}
                onClick={() => {
                  set({ vibration: k });
                  vibrate(k);
                }}
              >
                {k !== "none" && <Vibrate size={13} className="mr-1 inline" />}
                {VIBRATIONS[k].label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <Range label="알람 음량" value={Math.round(settings.volume * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => set({ volume: v / 100 })} />
          <Switch checked={settings.escalate} onChange={(escalate) => set({ escalate })} label="점점 크게·빠르게" desc="무시할수록 알람이 커지고 빨라집니다. 미시작 경고는 항상 켜짐." />
          <Switch checked={settings.speak} onChange={(speak) => set({ speak })} label="일정 제목 읽어 주기" desc="“독일어 단어 30개, 시작할 시간입니다.” — 음성 합성(TTS)으로 말해 줍니다." />
        </div>
      </Section>
    </>
  );
}

function SoundTab() {
  const { settings, updateSettings } = usePlanner();
  const all = [...BUILTIN_SOUNDS, ...settings.customSounds];
  const rows: { key: keyof Settings["sounds"]; label: string; desc: string }[] = [
    { key: "before", label: "곧 시작 (N분 전)", desc: "짧게 한 번" },
    { key: "start", label: "정각", desc: "전체화면 + 반복" },
    { key: "overdue", label: "미시작 경고", desc: "가장 시끄럽게" },
    { key: "focus", label: "집중·휴식 끝", desc: "뽀모도로" },
  ];
  return (
    <>
      <Section title="알림 종류별 소리" desc="일정마다 따로 소리를 고를 수도 있습니다(일정 편집 → 알림 소리). 미시작 경고는 항상 여기 소리로 울립니다.">
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-3 rounded-2xl bg-surface-2/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{r.label}</p>
                <p className="text-xs text-muted">{r.desc}</p>
              </div>
              <select
                value={settings.sounds[r.key]}
                onChange={(e) => updateSettings({ sounds: { ...settings.sounds, [r.key]: e.target.value } })}
                className="h-9 max-w-[160px] rounded-xl border border-line bg-surface px-2 text-sm"
              >
                {all.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.emoji} {s.name}
                  </option>
                ))}
              </select>
              <button
                className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-3 hover:text-fg"
                aria-label="듣기"
                onClick={() => playSound(findSound(settings.sounds[r.key], settings.customSounds), { volume: settings.volume })}
              >
                <Volume2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </Section>
      <Section title="사운드 스튜디오" desc="칸을 눌러 음을 찍으면 나만의 알람이 됩니다. 저장하면 위 목록과 일정 편집에서 고를 수 있어요.">
        <SoundStudio />
      </Section>
    </>
  );
}

function RulesTab() {
  const { settings, updateSettings } = usePlanner();
  return (
    <>
      <Section title="유예 시간" desc="시작 시각 뒤 이 시간이 지나도 시작하지 않으면 빨간 경고창이 뜨고 미시작 알림이 갑니다.">
        <Range label="유예" value={settings.graceMin} min={0} max={30} unit="분" onChange={(graceMin) => updateSettings({ graceMin })} />
      </Section>
      <Section title="사유 최소 글자 수" desc="미루기·건너뛰기·놓침 기록 때 필요한 사유 길이. 짧게 잡으면 ‘ㅇㅇ’로 넘어가게 됩니다.">
        <Range label="최소" value={settings.reasonMinLength} min={0} max={60} unit="자" onChange={(reasonMinLength) => updateSettings({ reasonMinLength })} />
      </Section>
      <Section title="미루기 경고" desc="같은 일정을 이 횟수 이상 미루면 경고 문구가 세지고 블록에 ‘N회 미룸’ 딱지가 붙습니다.">
        <Range label="경고 시작" value={settings.postponeWarnAt} min={1} max={5} unit="회" onChange={(postponeWarnAt) => updateSettings({ postponeWarnAt })} />
      </Section>
      <Section title="지금 적용 중인 규칙">
        <ul className="space-y-1.5 text-sm text-muted">
          <li>• 강제 모드 일정이 {settings.graceMin}분 넘게 시작 안 되면 → 닫을 수 없는 경고창</li>
          <li>• 미루기·건너뛰기는 사유 {settings.reasonMinLength}자 이상 → ‘변명 노트’에 영구 기록</li>
          <li>• 이미 시작했어야 할 일정을 끌어서 뒤로 옮기는 것도 미루기로 취급</li>
          <li>• 건너뛴 일정도 달성률 분모에 남음 (도망쳐도 숫자는 안 좋아짐)</li>
          <li>• 미시작 경고는 유예 직후, +10분, +25분 세 번 — 점점 세게</li>
        </ul>
      </Section>
    </>
  );
}

function FocusTab() {
  const { settings, updateSettings } = usePlanner();
  return (
    <>
      <Section title="뽀모도로">
        <Range label="집중" value={settings.focusMin} min={5} max={90} step={5} unit="분" onChange={(focusMin) => updateSettings({ focusMin })} />
        <Range label="짧은 휴식" value={settings.breakMin} min={1} max={30} unit="분" onChange={(breakMin) => updateSettings({ breakMin })} />
        <Range label="긴 휴식" value={settings.longBreakMin} min={5} max={60} step={5} unit="분" onChange={(longBreakMin) => updateSettings({ longBreakMin })} />
        <Range label="긴 휴식까지" value={settings.cyclesPerLong} min={2} max={8} unit="회" onChange={(cyclesPerLong) => updateSettings({ cyclesPerLong })} />
        <Switch checked={settings.autoStartBreak} onChange={(autoStartBreak) => updateSettings({ autoStartBreak })} label="집중이 끝나면 휴식 자동 시작" />
      </Section>
      <Section title="타임라인" desc="다른 날짜를 열었을 때 처음 보여 줄 시각입니다.">
        <Range label="하루 시작" value={settings.dayStartHour} min={0} max={12} unit="시" onChange={(dayStartHour) => updateSettings({ dayStartHour })} />
      </Section>
    </>
  );
}

function AccountTab() {
  const { session, snap, store, signOut, toast } = usePlanner();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sb = getSupabase();
  const importedKey = session.userId ? `must:local-imported:${session.userId}` : "";
  const [importedNow, setImportedNow] = useState(false);
  const canImport = Boolean(session.userId) && !importedNow && hasLocalData("local") && !localStorage.getItem(importedKey);

  if (!cloudEnabled) {
    return (
      <Section title="로컬 모드" desc="지금은 모든 데이터가 이 브라우저(localStorage)에만 저장됩니다. 오프라인에서도 그대로 동작합니다.">
        <div className="space-y-2 text-sm leading-relaxed text-muted">
          <p>노트북 ↔ 핸드폰 실시간 동기화와 ‘앱이 꺼져 있어도 오는 푸시’를 켜려면 Supabase(무료)를 연결하세요.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>supabase.com 에서 프로젝트 생성</li>
            <li><code>supabase/migrations</code> 의 SQL 실행</li>
            <li><code>.env.local</code> 에 URL·키 입력 후 다시 빌드</li>
          </ol>
          <p>자세한 순서: <code className="rounded bg-surface-2 px-1">docs/SETUP-SUPABASE.md</code></p>
        </div>
      </Section>
    );
  }

  if (session.userId) {
    const st = snap.status;
    return (
      <>
        <Section title="계정">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-accent font-black text-accent-fg">
              {(session.email ?? "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{session.email}</p>
              <p className="text-xs text-muted">같은 이메일로 다른 기기에서 로그인하면 실시간으로 이어집니다.</p>
            </div>
            <Button variant="ghost" onClick={() => void signOut()}>
              <LogOut size={16} /> 로그아웃
            </Button>
          </div>
        </Section>
        <Section title="동기화 상태">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-xs text-muted">실시간 연결</dt>
              <dd className="font-bold">{st.realtime === "live" ? "연결됨" : st.realtime === "connecting" ? "연결 중" : "꺼짐"}</dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-xs text-muted">올릴 변경</dt>
              <dd className="font-bold">{st.pending}건</dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-xs text-muted">네트워크</dt>
              <dd className="font-bold">{st.online ? "온라인" : "오프라인"}</dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-xs text-muted">마지막 동기화</dt>
              <dd className="font-bold">{st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleTimeString("ko-KR") : "-"}</dd>
            </div>
          </dl>
          {st.error && <p className="mt-2 text-sm text-danger">{st.error}</p>}
          <Button
            className="mt-3"
            onClick={async () => {
              await store.flush();
              await store.pull();
              toast({ text: "동기화했습니다", tone: "ok" });
            }}
          >
            <RefreshCw size={16} /> 지금 동기화
          </Button>
        </Section>
        {canImport && (
          <Section title="이 기기의 로컬 데이터" desc="로그인 전에 이 기기에서 만든 일정·습관이 있습니다. 계정으로 옮길까요?">
            <Button
              variant="primary"
              onClick={() => {
                store.importDb(readLocalDb("local"));
                localStorage.setItem(importedKey, new Date().toISOString());
                setImportedNow(true);
                toast({ text: "로컬 데이터를 계정으로 옮겼습니다", tone: "ok" });
              }}
            >
              <Cloud size={16} /> 계정으로 가져오기
            </Button>
          </Section>
        )}
      </>
    );
  }

  return (
    <Section
      title="로그인 — 기기 간 동기화"
      desc="비밀번호 없이 이메일로 받은 6자리 코드로 로그인합니다. (iPhone 홈 화면 앱은 메일 링크가 Safari로 열려서, 링크 대신 코드를 씁니다.)"
    >
      {step === "email" ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            const { error } = await sb!.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
            setBusy(false);
            if (error) setErr(error.message);
            else setStep("code");
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputCls}
            autoComplete="email"
          />
          <Button variant="primary" disabled={busy} className="h-11 shrink-0">
            <Mail size={16} /> 코드 받기
          </Button>
        </form>
      ) : (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            const { error } = await sb!.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
            setBusy(false);
            if (error) setErr(error.message);
            else toast({ text: "로그인했습니다 — 동기화를 시작합니다", tone: "ok" });
          }}
        >
          <p className="text-sm text-muted">{email} 로 보낸 코드를 입력하세요.</p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="123456"
              className={cx(inputCls, "font-mono text-xl tracking-[0.4em]")}
            />
            <Button variant="primary" disabled={busy || code.length < 6} className="h-12 shrink-0">
              <KeyRound size={16} /> 확인
            </Button>
          </div>
          <button type="button" onClick={() => setStep("email")} className="text-xs text-muted underline">
            이메일 다시 입력
          </button>
        </form>
      )}
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}
    </Section>
  );
}

function DataTab() {
  const { settings, updateSettings, store, toast } = usePlanner();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Section title="테마">
        <Segmented
          value={settings.theme}
          onChange={(theme) => updateSettings({ theme })}
          options={[
            { value: "system", label: <span className="inline-flex items-center gap-1"><Monitor size={14} /> 시스템</span> },
            { value: "dark", label: <span className="inline-flex items-center gap-1"><Moon size={14} /> 다크</span> },
            { value: "light", label: <span className="inline-flex items-center gap-1"><Sun size={14} /> 라이트</span> },
          ]}
        />
      </Section>
      <Section title="백업" desc="모든 일정·습관·기록·설정을 JSON 파일 하나로 내보내고 가져옵니다. 가져오기는 더 최신인 항목만 덮어씁니다.">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              const blob = new Blob([store.exportJson()], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `must-backup-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 2000);
            }}
          >
            <Download size={16} /> 내보내기
          </Button>
          <Button onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> 가져오기
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const n = store.importJson(await f.text());
                toast({ text: `가져오기 완료 (새 항목 ${n}개)`, tone: "ok" });
              } catch (err) {
                toast({ text: `가져오기 실패: ${(err as Error).message}`, tone: "danger" });
              }
              e.target.value = "";
            }}
          />
        </div>
      </Section>
    </>
  );
}

export function SettingsSheet() {
  const { sheet, sheetTab } = usePlanner();
  if (sheet !== "settings") return null;
  return <SettingsBody key={sheetTab ?? "notify"} initial={(sheetTab as Tab) ?? "notify"} />;
}

function SettingsBody({ initial }: { initial: Tab }) {
  const { openSheet } = usePlanner();
  const [tab, setTab] = useState<Tab>(initial);
  return (
    <Modal open onClose={() => openSheet(null)} title="설정" size="lg" className="md:h-[86dvh]">
      <div className="sticky top-0 z-10 -mx-5 mb-2 overflow-x-auto bg-surface px-5 pb-2 md:-mx-6 md:px-6">
        <Segmented value={tab} onChange={setTab} options={TABS} />
      </div>
      {tab === "notify" && <NotifyTab />}
      {tab === "sound" && <SoundTab />}
      {tab === "rules" && <RulesTab />}
      {tab === "focus" && <FocusTab />}
      {tab === "account" && <AccountTab />}
      {tab === "data" && <DataTab />}
    </Modal>
  );
}
