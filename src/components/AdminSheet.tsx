"use client";

import {
  Activity,
  Ban,
  Bot,
  KeyRound,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Trash2,
  TriangleAlert,
  Undo2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  adminOverview,
  adminSettings,
  adminUserAction,
  adminUsers,
  costKrw,
  fmtAgo,
  fmtKrw,
  isBanned,
  userCostKrw,
  type AdminSettings,
  type AdminUser,
  type CronJob,
  type Overview,
  type UserAction,
} from "@/lib/admin";
import { getSupabase } from "@/lib/supabase";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";
import { Button, Chip, cx, inputCls, Modal, Segmented, Switch } from "./ui";

type Tab = "overview" | "users" | "settings";

const CRON_LABEL: Record<string, string> = {
  "must-send-due": "알림 보내기 (1분마다)",
  "must-materialize-habits": "습관 → 일정 만들기 (매시)",
  "must-cleanup": "오래된 알림 정리 (매일 새벽)",
};

const LIMIT_CHOICES = [0, 10, 30, 50, 100];

const fmtStudy = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}시간${m ? ` ${m}분` : ""}` : `${m}분`;
};
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });

/** 운영자 화면 — 개요 · 사용자 · 설정. 관리자에게만 메뉴가 보이고, 서버도 관리자인지 다시 확인한다 */
export function AdminSheet() {
  const { sheet } = usePlanner();
  if (sheet !== "admin") return null;
  return <AdminBody />;
}

interface Confirm {
  title: string;
  body: ReactNode;
  cta: string;
  danger?: boolean;
  /** 이 글자를 그대로 적어야 실행(삭제용) */
  typeToConfirm?: string;
  run: () => Promise<void>;
}

function AdminBody() {
  const { openSheet, sheetTab, toast } = usePlanner();
  const sb = getSupabase();
  const now = useNow(30_000);
  const [tab, setTab] = useState<Tab>(sheetTab === "users" || sheetTab === "settings" ? sheetTab : "overview");
  const [ov, setOv] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  useEffect(() => {
    if (!sb) return;
    let alive = true;
    Promise.all([adminOverview(sb), adminUsers(sb)])
      .then(([o, u]) => {
        if (!alive) return;
        setOv(o);
        setUsers(u.users);
        setMe(u.me);
        setErr(null);
      })
      .catch((e: Error) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [sb, reload]);

  const refresh = () => {
    setLoading(true);
    setReload((n) => n + 1);
  };

  const close = () => openSheet(null);
  if (!sb) return null;

  const runAction = async (action: UserAction, u: AdminUser, extra?: Record<string, unknown>) => {
    const r = await adminUserAction(sb, action, u.id, extra);
    const who = u.email ?? "사용자";
    const text: Record<UserAction, string> = {
      ban: `${who} 정지 — 모든 기기에서 로그아웃돼요`,
      unban: `${who} 정지를 풀었어요`,
      signout: `${who} 로그인 세션 ${r.sessions ?? 0}개를 끊었어요`,
      reset_password: `${who} 로 비밀번호 재설정 메일을 보냈어요`,
      make_admin: `${who} 을(를) 관리자로 지정했어요`,
      remove_admin: `${who} 의 관리자 권한을 뺐어요`,
      delete: `${who} 계정과 데이터를 지웠어요`,
    };
    toast({ text: text[action], tone: "ok", ttl: 6000 });
    refresh();
  };

  const saveSettings = async (patch: Partial<Pick<AdminSettings, "signups_open" | "ai_daily_limit">>) => {
    try {
      const r = await adminSettings(sb, patch);
      setOv((o) => (o ? { ...o, settings: r.settings } : o));
      toast({ text: "저장했어요", tone: "ok" });
    } catch (e) {
      toast({ text: (e as Error).message, tone: "danger" });
    }
  };

  return (
    <>
      <Modal
        open
        onClose={close}
        size="lg"
        title={
          <span className="inline-flex items-center gap-2">
            <ShieldCheck size={20} className="text-accent-text" /> 관리자
          </span>
        }
        subtitle="운영자에게만 보이는 화면이에요."
      >
        <div className="mb-4 flex items-center gap-2">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "overview", label: "개요" },
              { value: "users", label: `사용자${users ? ` ${users.length}` : ""}` },
              { value: "settings", label: "설정" },
            ]}
          />
          <Button size="sm" variant="ghost" className="ml-auto" onClick={refresh} disabled={loading} aria-label="새로고침">
            <RefreshCw size={15} className={cx(loading && "animate-spin")} />
            <span className="hidden sm:inline">새로고침</span>
          </Button>
        </div>

        {err && (
          <p className="mb-4 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            {err}
          </p>
        )}

        {!ov || !users ? (
          !err && <p className="py-10 text-center text-sm text-muted">불러오는 중…</p>
        ) : tab === "overview" ? (
          <OverviewTab ov={ov} now={now} onUsers={() => setTab("users")} />
        ) : tab === "users" ? (
          <UsersTab users={users} me={me} now={now} ask={setConfirm} act={runAction} />
        ) : (
          <SettingsTab settings={ov.settings} save={saveSettings} ask={setConfirm} />
        )}
      </Modal>
      {confirm && <ConfirmDialog c={confirm} onClose={() => setConfirm(null)} />}
    </>
  );
}

// ─────────────────────────── 개요 ───────────────────────────

function Stat({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-surface-2 p-3.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        {icon}
        {label}
      </p>
      <p className="mt-1 truncate text-2xl font-black tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs leading-snug text-muted">{sub}</p>}
    </div>
  );
}

function StatusRow({ ok, label, value }: { ok: boolean | null; label: string; value: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={cx("size-2.5 shrink-0 rounded-full", ok === null ? "bg-faint" : ok ? "bg-ok" : "bg-danger")} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</span>
      <span className="shrink-0 text-right text-xs text-muted">{value}</span>
    </li>
  );
}

function cronState(j: CronJob, now: number): { ok: boolean | null; text: string } {
  if (!j.active) return { ok: null, text: "꺼짐" };
  if (!j.last_at) return { ok: false, text: "하루 넘게 안 돌았어요" };
  if (j.last_status && j.last_status !== "succeeded") return { ok: false, text: `마지막 실행 실패 · ${fmtAgo(j.last_at, now)}` };
  if (j.fails_24h > 0) return { ok: false, text: `하루 동안 ${j.fails_24h}번 실패 · 마지막은 정상` };
  return { ok: true, text: `정상 · ${fmtAgo(j.last_at, now)}` };
}

function OverviewTab({ ov, now, onUsers }: { ov: Overview; now: number; onUsers: () => void }) {
  const month = ov.ai_month.reduce(
    (a, m) => {
      const c = costKrw(m.model, m.input, m.output);
      return { calls: a.calls + m.calls, tokens: a.tokens + m.input + m.output, krw: a.krw + (c ?? 0), unknown: a.unknown || c === null };
    },
    { calls: 0, tokens: 0, krw: 0, unknown: false },
  );
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <button type="button" onClick={onUsers} className="text-left">
          <Stat
            icon={<Users size={13} />}
            label="사용자"
            value={`${ov.users}명`}
            sub={`이번 주 가입 ${ov.users_week} · 7일 활동 ${ov.active_week}`}
          />
        </button>
        <Stat icon={<Bot size={13} />} label="오늘 AI" value={`${ov.ai_today}회`} sub={`1인 하루 한도 ${ov.settings.ai_daily_limit}회`} />
        <Stat
          icon={<Activity size={13} />}
          label="이번 달 AI 비용"
          value={`≈ ${fmtKrw(month.krw)}${month.unknown ? "+" : ""}`}
          sub={`${month.calls}회 · 토큰 ${month.tokens.toLocaleString("ko-KR")}`}
        />
        <Stat
          icon={<Smartphone size={13} />}
          label="알림 받는 기기"
          value={`${ov.devices}대`}
          sub={`오늘 보낸 알림 ${ov.pushes_today}${ov.push_errors_24h ? ` · 오류 ${ov.push_errors_24h}` : ""}`}
        />
      </div>

      <section>
        <h3 className="mb-1 text-sm font-bold">서버 상태</h3>
        <ul className="divide-y divide-line rounded-2xl bg-surface-2 px-3.5">
          <StatusRow ok={ov.ai_key} label="AI 키 (Claude)" value={ov.ai_key ? "연결됨" : "없음 — 설정 → AI 에서 넣는 방법"} />
          <StatusRow ok={null} label="새 가입" value={ov.settings.signups_open ? "받는 중 (누구나 가입)" : "닫힘 (1인 전용)"} />
          {ov.cron.length === 0 && <StatusRow ok={null} label="예약 작업" value="정보 없음" />}
          {ov.cron.map((j) => {
            const s = cronState(j, now);
            return <StatusRow key={j.name} ok={s.ok} label={CRON_LABEL[j.name] ?? j.name} value={s.text} />;
          })}
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-faint">
          비용은 토큰 수로 어림한 값이에요(1달러 ≈ 1,400원). 정확한 청구액은 console.anthropic.com 의 Usage 에서 보세요.
        </p>
      </section>
    </div>
  );
}

// ─────────────────────────── 사용자 ───────────────────────────

function Badge({ tone = "muted", children }: { tone?: "muted" | "accent" | "danger" | "warn"; children: ReactNode }) {
  const cls = {
    muted: "bg-surface-3 text-muted",
    accent: "bg-accent/15 text-accent-text",
    danger: "bg-danger-soft text-danger",
    warn: "bg-warn/15 text-warn",
  }[tone];
  return <span className={cx("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-bold", cls)}>{children}</span>;
}

function UsersTab({
  users,
  me,
  now,
  ask,
  act,
}: {
  users: AdminUser[];
  me: string | null;
  now: number;
  ask: (c: Confirm) => void;
  act: (a: UserAction, u: AdminUser, extra?: Record<string, unknown>) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? users.filter((u) => (u.email ?? "").toLowerCase().includes(s)) : users;
  }, [users, q]);
  return (
    <div className="space-y-3">
      {users.length > 5 && (
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이메일로 찾기" className={cx(inputCls, "pl-9")} />
        </label>
      )}
      <ul className="space-y-2.5">
        {list.map((u) => (
          <UserCard key={u.id} u={u} self={u.id === me} now={now} ask={ask} act={act} />
        ))}
      </ul>
      {list.length === 0 && <p className="py-6 text-center text-sm text-muted">맞는 사용자가 없어요.</p>}
      <p className="text-xs leading-relaxed text-faint">
        비밀번호는 되돌릴 수 없는 암호(해시)로만 저장돼서 운영자도 볼 수 없어요. 잊었으면 ‘재설정 메일’을 보내세요.
      </p>
    </div>
  );
}

function UserCard({
  u,
  self,
  now,
  ask,
  act,
}: {
  u: AdminUser;
  self: boolean;
  now: number;
  ask: (c: Confirm) => void;
  act: (a: UserAction, u: AdminUser, extra?: Record<string, unknown>) => Promise<void>;
}) {
  const banned = isBanned(u, now);
  const who = u.email ?? "(이메일 없음)";
  const cost = userCostKrw(u);
  const confirmThen = (c: Omit<Confirm, "run">, action: UserAction, extra?: () => Record<string, unknown>) =>
    ask({ ...c, run: () => act(action, u, extra?.()) });

  return (
    <li className={cx("rounded-2xl border border-line bg-surface-2/60 p-3.5", banned && "opacity-70")}>
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent font-black text-accent-fg">
          {(u.email ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate font-semibold">{who}</span>
            {self && <Badge tone="accent">나</Badge>}
            {u.is_admin && <Badge tone="accent">관리자</Badge>}
            {banned && <Badge tone="danger">정지됨</Badge>}
            {!u.confirmed && <Badge tone="warn">메일 미확인</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            가입 {fmtDay(u.created_at)} · 최근 활동 {fmtAgo(u.last_active_at, now)} · 로그인 기기 {u.sessions}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
        {[
          ["일정", `${u.tasks}`, `완료 ${u.tasks_done}`],
          ["습관", `${u.habits}`, null],
          ["공부", fmtStudy(u.study_sec), null],
          ["AI 이번 달", `${u.ai_month_calls}회`, `≈${fmtKrw(cost)} · 오늘 ${u.ai_today}`],
          ["알림 기기", `${u.devices}대`, null],
        ].map(([k, v, s]) => (
          <div key={k} className="min-w-0 rounded-xl bg-surface px-2 py-2">
            <dt className="truncate text-[11px] text-muted">{k}</dt>
            <dd className="truncate text-sm font-bold tabular-nums">{v}</dd>
            {s && <dd className="truncate text-[11px] text-faint">{s}</dd>}
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button
          size="sm"
          onClick={() =>
            confirmThen(
              {
                title: "비밀번호 재설정 메일",
                body: (
                  <>
                    <b>{who}</b> 로 새 비밀번호를 정하는 링크를 보내요. 링크를 누르면 앱이 열리고 새 비밀번호를 정하는 칸이 나와요.
                  </>
                ),
                cta: "메일 보내기",
              },
              "reset_password",
            )
          }
        >
          <KeyRound size={14} /> 재설정 메일
        </Button>
        <Button
          size="sm"
          onClick={() =>
            confirmThen(
              {
                title: "모든 기기에서 로그아웃",
                body: (
                  <>
                    <b>{who}</b> 의 로그인을 모든 기기에서 끊어요{self ? " — 지금 이 기기도 포함" : ""}. 이미 열린 화면은 길어야 1시간 안에 로그아웃돼요.
                    데이터는 그대로예요.
                  </>
                ),
                cta: "로그아웃시키기",
              },
              "signout",
            )
          }
        >
          <LogOut size={14} /> 모든 기기 로그아웃
        </Button>
        {!self &&
          (u.is_admin ? (
            <Button
              size="sm"
              onClick={() =>
                confirmThen({ title: "관리자 해제", body: <><b>{who}</b> 의 관리자 권한을 빼요. 이 화면이 더는 안 보이게 돼요.</>, cta: "해제" }, "remove_admin")
              }
            >
              <ShieldOff size={14} /> 관리자 해제
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                onClick={() =>
                  confirmThen(
                    { title: "관리자로 지정", body: <><b>{who}</b> 도 이 관리자 화면을 쓰고, 다른 사용자를 정지·삭제할 수 있게 돼요.</>, cta: "지정" },
                    "make_admin",
                  )
                }
              >
                <ShieldCheck size={14} /> 관리자 지정
              </Button>
              {banned ? (
                <Button size="sm" onClick={() => confirmThen({ title: "정지 풀기", body: <><b>{who}</b> 가 다시 로그인할 수 있어요.</>, cta: "풀기" }, "unban")}>
                  <Undo2 size={14} /> 정지 풀기
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="dangerSoft"
                  onClick={() =>
                    confirmThen(
                      {
                        title: "계정 정지",
                        body: <><b>{who}</b> 를 모든 기기에서 로그아웃시키고 다시 로그인하지 못하게 해요. 데이터는 지우지 않고, 언제든 풀 수 있어요.</>,
                        cta: "정지",
                        danger: true,
                      },
                      "ban",
                    )
                  }
                >
                  <Ban size={14} /> 정지
                </Button>
              )}
              <Button
                size="sm"
                variant="dangerSoft"
                onClick={() =>
                  ask({
                    title: "계정 삭제",
                    body: (
                      <>
                        <b>{who}</b> 의 계정과 일정·습관·공부·커리어 기록이 <b>모두 지워지고 되돌릴 수 없어요.</b> 확인하려면 아래에 이메일을 그대로 적어 주세요.
                      </>
                    ),
                    cta: "영구 삭제",
                    danger: true,
                    typeToConfirm: u.email ?? "",
                    run: () => act("delete", u, { confirm_email: u.email ?? "" }),
                  })
                }
              >
                <Trash2 size={14} /> 삭제
              </Button>
            </>
          ))}
      </div>
    </li>
  );
}

// ─────────────────────────── 설정 ───────────────────────────

function SettingsTab({
  settings,
  save,
  ask,
}: {
  settings: AdminSettings;
  save: (p: Partial<Pick<AdminSettings, "signups_open" | "ai_daily_limit">>) => Promise<void>;
  ask: (c: Confirm) => void;
}) {
  const [limit, setLimit] = useState(String(settings.ai_daily_limit));
  const parsed = Number(limit);
  const validLimit = limit.trim() !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= 1000;
  const dirty = validLimit && parsed !== settings.ai_daily_limit;
  return (
    <div className="space-y-6">
      <section>
        <Switch
          checked={settings.signups_open}
          onChange={(open) =>
            open
              ? ask({
                  title: "새 가입 받기",
                  body: (
                    <>
                      앱 주소를 아는 <b>누구나</b> 가입할 수 있게 돼요. 그 사람들이 AI 를 쓰면 비용은 <b>내 API 키</b>로 나가요 — 아래 하루 한도로 막아 두세요.
                      각자의 일정은 서로 볼 수 없어요.
                    </>
                  ),
                  cta: "가입 열기",
                  run: () => save({ signups_open: true }),
                })
              : void save({ signups_open: false })
          }
          label="새 가입 받기"
          desc={settings.signups_open ? "지금 누구나 가입할 수 있어요." : "닫혀 있어요(1인 전용) — 지금 있는 계정만 로그인할 수 있어요."}
        />
      </section>

      <section>
        <h3 className="font-bold">AI 하루 한도 (한 사람당)</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          말로 일정 추가와 커리어 다듬기를 합쳐 하루에 몇 번까지 쓸 수 있는지예요. 관리자는 한도가 없어요. 0 이면 관리자 말고는 못 써요. 1번에 약 5~10원.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {LIMIT_CHOICES.map((n) => (
            <Chip
              key={n}
              active={settings.ai_daily_limit === n}
              onClick={() => {
                setLimit(String(n));
                void save({ ai_daily_limit: n });
              }}
            >
              {n === 0 ? "막기" : `${n}회`}
            </Chip>
          ))}
          <span className="flex items-center gap-1.5">
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
              inputMode="numeric"
              aria-label="직접 입력"
              className={cx(inputCls, "h-9 w-20! py-1 text-center text-sm")}
            />
            <Button size="sm" variant="primary" disabled={!dirty} onClick={() => void save({ ai_daily_limit: parsed })}>
              저장
            </Button>
          </span>
        </div>
        {!validLimit && <p className="mt-1.5 text-xs font-semibold text-danger">0~1000 사이 숫자만 넣을 수 있어요.</p>}
      </section>

      <section className="rounded-2xl bg-surface-2 p-3.5 text-sm leading-relaxed">
        <h3 className="font-bold">메일 링크가 안 될 때</h3>
        <p className="mt-1 text-muted">
          로그인·재설정 메일의 링크가 localhost 로 가거나 열리지 않으면, Supabase 대시보드 → Authentication → URL Configuration 에서
          Site URL 을 앱 주소로, Redirect URLs 에 <span className="font-semibold break-all text-fg">https://c2k-ai.github.io/Schedule_app/**</span> 를 넣어 주세요.
        </p>
        <a
          href="https://supabase.com/dashboard/project/gcnosxcojuefkaaxefug/auth/url-configuration"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block font-bold text-accent-text"
        >
          URL 설정 열기 →
        </a>
      </section>
    </div>
  );
}

// ─────────────────────────── 확인 창 ───────────────────────────

function ConfirmDialog({ c, onClose }: { c: Confirm; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = !c.typeToConfirm || typed.trim().toLowerCase() === c.typeToConfirm.trim().toLowerCase();
  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      size="sm"
      tone={c.danger ? "danger" : "default"}
      title={c.title}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button
            variant={c.danger ? "danger" : "primary"}
            className="ml-auto"
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await c.run();
                onClose();
              } catch (e) {
                setErr((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? "처리 중…" : c.cta}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-relaxed">{c.body}</p>
      {c.typeToConfirm !== undefined && (
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={c.typeToConfirm}
          className={cx(inputCls, "mt-3")}
          autoComplete="off"
          aria-label="확인용 이메일"
        />
      )}
      {err && <p className="mt-3 text-sm font-semibold text-danger">{err}</p>}
    </Modal>
  );
}
