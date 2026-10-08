"use client";

import { Bell, BellRing, Cloud, Download, KeyRound, LogOut, Monitor, Moon, RefreshCw, Smartphone, Sun, Upload, Vibrate, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  isIOS,
  isStandalone,
  notificationPermission,
  requestNotificationPermission,
  showSystemNotification,
  type PermissionState,
} from "@/lib/notify";
import { aiStatus } from "@/lib/ai";
import { clearRecovery, inRecovery } from "@/lib/authLinks";
import { lockCardSupported, testLockCard } from "@/lib/lockCard";
import { OFFSET_CHOICES } from "@/lib/settings";
import { briefingTime, currentPushSubscription, pushSupported, sendTestPush, setBriefingTime, subscribePush, unsubscribePush } from "@/lib/push";
import { downloadSound, findSound, playSound, unlockAudio, vibrate, VIBRATIONS } from "@/lib/sound";
import { hasLocalData, readLocalDb } from "@/lib/store";
import { cloudEnabled, getSupabase } from "@/lib/supabase";
import { fmtOffset, uuid } from "@/lib/time";
import type { AlarmTheme, Settings, VibrationKey } from "@/lib/types";
import { usePlanner } from "./PlannerProvider";
import { AuthForm, friendly } from "./AuthForm";
import { BackgroundPicker } from "./BackgroundPicker";
import { DIARY_INTRO_SOUND } from "./DiaryIntro";
import { PalettePicker } from "./PalettePicker";
import { SoundOptions } from "./SoundOptions";
import { SoundStudio } from "./SoundStudio";
import { Button, Chip, cx, inputCls, Label, Modal, Segmented, Switch } from "./ui";

type Tab = "notify" | "sound" | "rules" | "focus" | "ai" | "account" | "data";

const TABS: { value: Tab; label: string }[] = [
  { value: "notify", label: "알림" },
  { value: "sound", label: "소리" },
  { value: "rules", label: "강제 규칙" },
  { value: "focus", label: "집중" },
  { value: "ai", label: "AI" },
  { value: "account", label: "동기화" },
  { value: "data", label: "화면·데이터" },
];

/** updateUser 등의 오류(모양이 제각각) → 글자 */
const errText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown } | null)?.message ?? e));

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
  const { settings, updateSettings, session, ring, toast, tasks } = usePlanner();
  const [perm, setPerm] = useState<PermissionState>(() => notificationPermission());
  const [lockTest, setLockTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [pushOn, setPushOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(() => briefingTime());
  const set = (p: Partial<Settings>) => updateSettings(p);

  useEffect(() => {
    void currentPushSubscription().then((s) => setPushOn(Boolean(s)));
  }, []);

  const ios = isIOS();
  const standalone = isStandalone();
  const lockOk = lockCardSupported();
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
                title: "🔔 DREAM 알림 테스트",
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

      {(lockOk || ios) && (
        <Section title="잠금화면 일정 카드 (선택)" desc="원하면 켜세요. 폰을 켜자마자 잠금화면에서 지금·다음 일정과 오늘 남은 할 일이 보여요. 안드로이드 전용이에요.">
          {lockOk ? (
            <>
              <Switch
                checked={settings.lockCard}
                onChange={async (lockCard) => {
                  // 켤 때 알림 권한이 없으면 바로 묻는다 — 권한이 있어야 카드가 뜬다
                  if (lockCard && perm !== "granted" && perm !== "unsupported") setPerm(await requestNotificationPermission());
                  set({ lockCard });
                }}
                label="잠금화면에 일정 카드 띄우기"
                desc="소리 없는 알림 한 장으로 띄워 두고, 일정이 시작·끝날 때마다 내용을 바꿉니다. 밀어서 지워도 앱을 한 번 열었다 닫으면 다시 떠요."
              />
              {settings.lockCard && perm !== "granted" && (
                <p className="mt-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
                  {perm === "denied"
                    ? "알림이 차단돼 있어 카드가 안 떠요. 주소창 왼쪽 자물쇠(또는 폰 설정 → 앱 → 크롬 → 알림)에서 허용으로 바꿔 주세요."
                    : "위 ‘1. 알림 권한’을 허용해야 카드가 떠요."}
                </p>
              )}
              {settings.lockCard && perm === "granted" && (
                <div className="mt-2 space-y-2">
                  <p className="text-sm text-muted">
                    잠금화면 알림 목록에 <b className="text-fg">DREAM</b> 카드 한 장이 떠요 — 제목에 ‘다음 13:00 ○○’(또는 ‘▶ 지금 ○○’), 아래에 이어지는 일정·오늘 할 일.
                    오늘·내일 남은 일정이 없으면 카드도 없어요.
                  </p>
                  <Button
                    size="sm"
                    onClick={async () => {
                      setLockTest(null);
                      setLockTest(await testLockCard(tasks));
                    }}
                  >
                    지금 띄워 보기
                  </Button>
                  {lockTest && <p className={cx("text-sm", lockTest.ok ? "text-ok" : "text-warn")}>{lockTest.text}</p>}
                </div>
              )}
              <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
                알림창엔 있는데 잠금화면에만 안 보이면 — 폰 <b className="text-fg">설정 → 잠금화면 → 알림</b>(갤럭시) 또는{" "}
                <b className="text-fg">설정 → 알림 → 잠금화면 알림</b>에서 ‘아이콘만’ 대신 <b className="text-fg">‘자세히’</b>로, ‘조용한 알림 표시’를 켜 주세요.
                앱을 오래 안 열면 사흘 뒤 카드가 저절로 내려가요.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">
              아이폰은 웹앱이 알림을 조용히 고쳐 다는 걸 지원하지 않아서(고칠 때마다 울림) 이 기능을 쓸 수 없어요. 대신 일정 시각마다 오는
              알림이 잠금화면에 뜹니다.
            </p>
          )}
        </Section>
      )}

      <Section title="오늘 브리핑" desc="‘오늘 할 일 n개 · 다음 일정 · 미시작 n건’을 한 줄로 알려 줍니다.">
        <Switch
          checked={settings.launchBriefing}
          onChange={(launchBriefing) => set({ launchBriefing })}
          label="앱을 켤 때 브리핑"
          desc="노트북을 켜고 앱이 열릴 때 알림 + 작업 탭 맨 위 한 줄."
        />
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
          노트북을 켤 때 앱이 저절로 열리게 하려면(설치한 앱 기준) — <b className="text-fg">Chrome</b>: 주소창에{" "}
          <code>chrome://apps</code> → DREAM 아이콘 우클릭 → ‘로그인 시 앱 시작’. <b className="text-fg">Edge</b>:{" "}
          <code>edge://apps</code> → DREAM 의 ⋯ → ‘디바이스 로그인 시 자동 시작’.
        </p>
        <div className="flex items-center justify-between gap-4 py-2">
          <span>
            <span className="block text-sm font-semibold">이 기기 아침 브리핑 시각</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted">
              앱을 안 열어도 서버가 이 시각에 푸시로 보냅니다(하루 한 번). ‘3. 서버 푸시’에서 이 기기를 등록해야 와요.
            </span>
          </span>
          <select
            value={briefing ?? "off"}
            onChange={async (e) => {
              const v = e.target.value === "off" ? null : e.target.value;
              setBriefing(v);
              try {
                await setBriefingTime(sb, v);
                toast({ text: v ? `이 기기는 매일 ${v}에 브리핑을 받아요` : "이 기기 아침 브리핑을 껐어요", tone: "ok" });
              } catch (err) {
                toast({ text: `저장 실패: ${(err as Error).message}`, tone: "danger" });
              }
            }}
            className="h-10 shrink-0 rounded-xl border border-line bg-surface-2 px-3 text-sm font-semibold"
            aria-label="아침 브리핑 시각"
          >
            <option value="off">끔</option>
            {["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
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
  const rows: { key: keyof Settings["sounds"]; label: string; desc: string }[] = [
    { key: "before", label: "곧 시작 (N분 전)", desc: "짧게 한 번" },
    { key: "start", label: "정각", desc: "전체화면 + 반복" },
    { key: "overdue", label: "미시작 경고", desc: "가장 시끄럽게" },
    { key: "focus", label: "집중·휴식 끝", desc: "뽀모도로" },
  ];
  return (
    <>
      <Section title="알림 종류별 소리" desc="일정마다 따로 소리를 고를 수도 있습니다(일정 편집 → 알림 소리). 미시작 경고는 항상 여기 소리로 울립니다. ↓ 버튼으로 파일을 받아 안드로이드 알림음으로 지정하면, 앱이 꺼져 있을 때 오는 푸시도 이 소리로 울립니다.">
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
                <SoundOptions custom={settings.customSounds} />
              </select>
              <button
                className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-3 hover:text-fg"
                aria-label="듣기"
                onClick={() => playSound(findSound(settings.sounds[r.key], settings.customSounds), { volume: settings.volume })}
              >
                <Volume2 size={16} />
              </button>
              <button
                className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-3 hover:text-fg"
                aria-label="파일로 저장"
                title="파일로 저장 — 안드로이드 알림 소리로 지정할 수 있어요"
                onClick={() => void downloadSound(findSound(settings.sounds[r.key], settings.customSounds))}
              >
                <Download size={16} />
              </button>
            </div>
          ))}
        </div>
      </Section>
      {DIARY_INTRO_SOUND && (
        <Section title="일기">
          <Switch
            checked={settings.diarySound}
            onChange={(diarySound) => updateSettings({ diarySound })}
            label="일기 열고 닫을 때 효과음"
            desc="책이 열리고 덮일 때 소리를 내요. 기본은 꺼져 있어요."
          />
        </Section>
      )}
      <Section title="사운드 스튜디오" desc="녹음 음원은 Kenney.nl 의 CC0(퍼블릭 도메인) 징글입니다. 칸을 눌러 음을 찍으면 나만의 합성 알람도 만들 수 있어요.">
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
      <Section title="공부 타이머" desc="열품타처럼 과목별로 시간을 쌓습니다.">
        <Switch
          checked={settings.studyAutoPause}
          onChange={(studyAutoPause) => updateSettings({ studyAutoPause })}
          label="자리 비우면 자동 멈춤"
          desc="공부 중에 앱을 1분 넘게 벗어나면 떠난 시각에 멈춥니다. 딴짓한 시간이 쌓이지 않게."
        />
      </Section>
      <Section title="하루 시작 시각" desc="타임라인을 처음 보여 줄 시각이자, 공부 시간을 하루로 묶는 경계입니다(새벽 공부는 전날로).">
        <Range label="하루 시작" value={settings.dayStartHour} min={0} max={12} unit="시" onChange={(dayStartHour) => updateSettings({ dayStartHour })} />
      </Section>
    </>
  );
}

const KEY_SQL = "select vault.create_secret('여기에-sk-ant-로-시작하는-키', 'must_anthropic_key');";

function AiTab() {
  const { session, openSheet } = usePlanner();
  const [state, setState] = useState<"checking" | "ready" | "missing" | "error" | "offline">(
    cloudEnabled && session.userId ? "checking" : "offline",
  );
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !session.userId) return;
    let alive = true;
    aiStatus(sb)
      .then((r) => alive && setState(r.ready ? "ready" : "missing"))
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [session.userId]);

  const badge = {
    checking: { text: "확인 중…", cls: "bg-surface-2 text-muted" },
    ready: { text: "연결됨 — 바로 쓸 수 있어요", cls: "bg-ok/15 text-ok" },
    missing: { text: "키가 아직 없어요", cls: "bg-warn/15 text-warn" },
    error: { text: "서버에 연결하지 못했어요", cls: "bg-danger-soft text-danger" },
    offline: { text: "로그인해야 쓸 수 있어요", cls: "bg-warn/15 text-warn" },
  }[state];

  return (
    <>
      <Section
        title="말로 일정 추가"
        desc="마이크 버튼을 누르고 생각나는 대로 말하면 AI(Claude)가 날짜·시간·반복·카테고리를 알아서 정리해 미리보기로 보여 줍니다. 확인을 눌러야 저장돼요."
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx("rounded-lg px-2.5 py-1 text-sm font-bold", badge.cls)}>{badge.text}</span>
          <Button size="sm" variant="primary" onClick={() => openSheet("voice")}>
            지금 해 보기
          </Button>
        </div>
      </Section>
      <Section
        title="AI 키 넣기 (한 번만)"
        desc="키는 서버(Supabase Vault)에만 저장되고 앱·깃허브에는 남지 않습니다."
      >
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
          <li>
            <b>console.anthropic.com</b> 가입 → Billing 에서 크레딧 충전(최소 $5) → API Keys 에서 <b>Create Key</b> → <code>sk-ant-…</code> 복사
          </li>
          <li>
            <b>supabase.com</b> → 이 앱 프로젝트 → 왼쪽 <b>SQL Editor</b> → 아래 한 줄에서 키 부분만 바꿔 붙여넣고 <b>Run</b>
          </li>
        </ol>
        <div className="mt-3 flex items-start gap-2">
          <code className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed break-all">{KEY_SQL}</code>
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(KEY_SQL);
            }}
          >
            복사
          </Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          비용: 말로 정리는 빠르고 싼 Claude Haiku 5.5(한 번 1원 미만), 커리어 다듬기는 없는 사실을 덜 지어내는 Sonnet(한 번 약 10원) — 혼자 쓰면 $5 로 1년 넘게. 이 탭을 다시 열면 연결 상태가 바뀌어 있을 거예요.
        </p>
      </Section>
    </>
  );
}

/** 비밀번호 바꾸기 — 재설정 메일 링크로 들어왔으면 '새 비밀번호 정하기'로 */
function PasswordSection() {
  const { toast, session, store, snap } = usePlanner();
  const [recovering, setRecovering] = useState(() => inRecovery(session.userId));
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(recovering);
  const sb = getSupabase();
  const ds = snap.diary.state;
  // 이 기기엔 일기 열쇠가 없지만 서버엔 있다 — 여기서 바꾸면 이 기기는 '예전 비밀번호' 상태가 된다
  const diaryKeyLocked = ds.kind === "locked" && ds.why !== "first_time";
  if (!sb) return null;
  const submit = async () => {
    if (pw.length < 8) return setErr("비밀번호는 8자 이상이어야 해요.");
    if (pw !== pw2) return setErr("두 칸의 비밀번호가 달라요.");
    setBusy(true);
    setErr(null);
    // 일기 열쇠도 새 비밀번호로 같이 잠근다(열쇠 다시 감싸기는 뒤에서)
    const { error } = await store.diary.changePassword(pw, () => sb.auth.updateUser({ password: pw }));
    setBusy(false);
    if (error) return setErr(friendly(errText(error)));
    clearRecovery();
    setRecovering(false);
    setOpen(false);
    setPw("");
    setPw2("");
    toast({ text: "비밀번호를 바꿨어요 — 다음부터 새 비밀번호로 로그인하세요", tone: "ok", ttl: 6000 });
  };
  return (
    <Section
      title={recovering ? "새 비밀번호 정하기" : "비밀번호"}
      desc={
        recovering
          ? "메일 링크로 들어왔어요. 새 비밀번호를 정하면 끝나요."
          : "비밀번호는 암호화돼 저장돼서 운영자도 볼 수 없어요. 일기 열쇠도 새 비밀번호로 같이 바뀌어요."
      }
    >
      {!open ? (
        <Button onClick={() => setOpen(true)}>
          <KeyRound size={16} /> 비밀번호 바꾸기
        </Button>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="새 비밀번호 (8자 이상)"
            autoComplete="new-password"
            className={inputCls}
            minLength={8}
            required
          />
          <input
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            placeholder="한 번 더"
            autoComplete="new-password"
            className={inputCls}
            required
          />
          {err && <p className="text-sm font-semibold text-danger">{err}</p>}
          {diaryKeyLocked && (
            <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
              이 기기에선 일기가 아직 잠겨 있어요. 일기가 열리는 기기(폰 등)에서 비밀번호를 바꾸면 모든 기기에서 그대로 열려요.
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy}>
              {busy ? "바꾸는 중…" : "저장"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                clearRecovery();
                setRecovering(false);
                setOpen(false);
                setErr(null);
              }}
            >
              {recovering ? "나중에" : "취소"}
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

/** 로그아웃 — 같이 쓰는 컴퓨터면 이 기기의 일기(잠긴 글·열쇠)도 지울 수 있다 */
function LogoutButton() {
  const { store, signOut } = usePlanner();
  const [wipe, setWipe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setErr(null);
    if (wipe) {
      setBusy(true);
      const ok = await store.diary.wipe();
      setBusy(false);
      if (!ok) return setErr("아직 안 올라간 일기가 있어요 — 인터넷에 연결된 뒤 다시 해 주세요.");
    }
    await signOut();
  };
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          이 기기에서 일기도 지우기 (같이 쓰는 컴퓨터일 때만)
        </label>
        <Button variant="ghost" disabled={busy} onClick={() => void go()}>
          <LogOut size={16} /> {busy ? "잠시만요…" : "로그아웃"}
        </Button>
      </div>
      {err && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
    </div>
  );
}

function AccountTab() {
  const { session, snap, store, toast } = usePlanner();
  const importedKey = session.userId ? `must:local-imported:${session.userId}` : "";
  const [importedNow, setImportedNow] = useState(false);
  const alreadyImported = (() => {
    try {
      return Boolean(localStorage.getItem(importedKey));
    } catch {
      return false;
    }
  })();
  const canImport = Boolean(session.userId) && !importedNow && hasLocalData("local") && !alreadyImported;

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
          </div>
          <LogoutButton />
        </Section>
        <PasswordSection />
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
                try {
                  localStorage.setItem(importedKey, new Date().toISOString());
                } catch {
                  /* 저장 불가 환경 */
                }
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
      title="로그인 — 노트북 ↔ 폰 동기화"
      desc="같은 계정으로 로그인한 기기끼리 일정·습관·기록이 실시간으로 맞춰지고, 앱을 닫아도 서버가 알림을 보냅니다."
    >
      <AuthForm />
    </Section>
  );
}
function DataTab() {
  const { settings, updateSettings, store, toast } = usePlanner();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Section title="테마" desc="사진 배경은 늘 어두운 테마예요(사진은 아래에서 고르거나 내 사진을 넣어요). 라임·바다·벚꽃·라벤더는 밝게/어둡게를 고를 수 있어요.">
        <PalettePicker />
        {settings.palette === "dusk" && (
          <div className="mt-3">
            <BackgroundPicker />
            <p className="mt-2 text-xs text-faint">사진: Pexels(무료 사용·출처 표기 불필요 라이선스). ‘내 사진’은 이 기기에만 저장돼요(다른 기기는 따로 골라요).</p>
          </div>
        )}
        {settings.palette !== "dusk" && (
          <Segmented
            className="mt-3"
            value={settings.theme}
            onChange={(theme) => updateSettings({ theme })}
            options={[
              { value: "system", label: <span className="inline-flex items-center gap-1"><Monitor size={14} /> 시스템</span> },
              { value: "dark", label: <span className="inline-flex items-center gap-1"><Moon size={14} /> 다크</span> },
              { value: "light", label: <span className="inline-flex items-center gap-1"><Sun size={14} /> 라이트</span> },
            ]}
          />
        )}
      </Section>
      <Section title="PC 앱 화면">
        <Switch
          checked={settings.pcFullscreen}
          onChange={(pcFullscreen) => updateSettings({ pcFullscreen })}
          label="전체 화면으로 쓰기"
          desc="PC 에 설치한 앱을 켜고 처음 클릭하면 전체 화면이 돼요(창 위쪽 줄·작업표시줄이 사라짐). 나오려면 Esc, 다시 들어가려면 위쪽 막대의 ⛶ 버튼이나 F11."
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
              a.download = `dream-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
        <p className="mt-2 text-xs text-faint">일기는 백업 파일에 들어가지 않아요 — 계정에 잠긴 채로 저장돼요.</p>
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
      {tab === "ai" && <AiTab />}
      {tab === "account" && <AccountTab />}
      {tab === "data" && <DataTab />}
    </Modal>
  );
}
