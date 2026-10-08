"use client";

import { KeyRound, LogIn, Mail, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/base";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { usePlanner } from "./PlannerProvider";
import { Button, cx, inputCls, Segmented } from "./ui";

type Mode = "login" | "signup" | "code";

const SIGNUP_ERRORS: Record<string, string> = {
  exists: "이미 가입된 이메일이에요. ‘로그인’으로 들어가세요(비밀번호를 잊었으면 ‘비밀번호를 잊었어요’).",
  closed: "지금은 가입 신청을 받지 않아요. 운영자에게 열어 달라고 하세요.",
  too_many: "승인을 기다리는 신청이 많아요. 운영자가 정리한 뒤 다시 해 주세요.",
  weak_password: "비밀번호는 6자 이상이어야 해요.",
  long_password: "비밀번호가 너무 길어요(72자까지).",
  bad_email: "이메일 주소를 확인해 주세요.",
};

/** 가입 신청(Edge Function `signup`) — 메일 확인 없이 계정을 만들고 운영자 승인을 기다린다 */
async function requestSignup(sb: SupabaseClient, email: string, password: string) {
  const { error } = await sb.functions.invoke("signup", { body: { email, password } });
  if (!error) return;
  const ctx = (error as { context?: Response }).context;
  const code = ctx && typeof ctx.json === "function" ? ((await ctx.json().catch(() => ({}))) as { error?: string }).error : undefined;
  throw new Error(SIGNUP_ERRORS[code ?? ""] ?? (navigator.onLine ? "가입 신청을 보내지 못했어요. 잠시 뒤 다시 해 주세요." : "인터넷 연결을 확인해 주세요."));
}

/** Supabase 오류 → 알아듣기 쉬운 말 */
export function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "이메일 또는 비밀번호가 틀렸어요.";
  if (m.includes("email not confirmed"))
    return "아직 메일 확인 전이에요. 메일함의 확인 링크를 먼저 눌러 주세요 — 링크를 누른 뒤 열리는 페이지가 오류여도 확인은 끝난 거예요.";
  if (m.includes("database error saving new user") || m.includes("새 가입을 받지"))
    return "지금은 새 가입을 받지 않아요. 이미 만든 계정으로 로그인하세요.";
  if (m.includes("already registered") || m.includes("already been registered")) return "이미 가입된 이메일이에요. ‘로그인’으로 들어가세요.";
  if (m.includes("rate limit")) return "메일 발송 한도를 넘었어요(무료는 시간당 몇 통). 잠시 뒤 다시 하거나 비밀번호로 로그인하세요.";
  if (m.includes("password") && m.includes("6")) return "비밀번호는 6자 이상이어야 해요.";
  if (m.includes("for security purposes") || m.includes("only request this after")) return "잠시 뒤(1분쯤) 다시 눌러 주세요.";
  if (m.includes("signups not allowed")) return "가입된 이메일이 아니에요. 가입할 때 쓴 주소를 넣어 주세요.";
  if (m.includes("token has expired") || m.includes("otp")) return "코드가 틀렸거나 만료됐어요. 다시 받아 주세요.";
  if (m.includes("should be different")) return "지금 비밀번호와 다른 비밀번호를 써 주세요.";
  if (m.includes("reauthentication")) return "보안을 위해 다시 로그인한 뒤 바꿔 주세요.";
  if (m.includes("fetch") || m.includes("network")) return "인터넷 연결을 확인해 주세요.";
  return message;
}

export function AuthForm({ compact = false }: { compact?: boolean }) {
  const { toast } = usePlanner();
  const sb = getSupabase();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // 가입이 닫혀 있으면(1인 전용) '처음이에요' 탭을 숨긴다 — 모르면 보여 준다
  const [signupsOpen, setSignupsOpen] = useState(true);
  useEffect(() => {
    if (!sb) return;
    let alive = true;
    void sb.rpc("must_signups_open").then(({ data, error }) => {
      if (alive && !error && data === false) setSignupsOpen(false);
    });
    return () => {
      alive = false;
    };
  }, [sb]);
  if (!sb) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setErr(friendly((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const redirect = typeof window !== "undefined" ? `${window.location.origin}${BASE_PATH}/` : undefined;

  return (
    <div className={cx("space-y-3", compact && "text-sm")}>
      <Segmented
        value={mode}
        onChange={(m) => {
          setMode(m);
          setErr(null);
          setInfo(null);
        }}
        options={[
          { value: "login" as const, label: "로그인" },
          ...(signupsOpen || mode === "signup" ? [{ value: "signup" as const, label: "처음이에요" }] : []),
          { value: "code" as const, label: "메일 코드로" },
        ]}
      />

      {mode !== "code" ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (mode === "login") {
                const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
                if (error) throw error;
                toast({ text: "로그인했습니다 — 이 기기와 동기화를 시작해요", tone: "ok" });
              } else {
                await requestSignup(sb, email.trim(), password);
                // 바로 로그인 — 운영자가 승인할 때까지는 '승인 대기' 화면이 뜬다
                const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
                if (error) {
                  setMode("login");
                  setInfo("가입 신청을 보냈어요. 운영자가 승인하면 ‘로그인’으로 들어오세요.");
                  return;
                }
                toast({ text: "가입 신청 완료 — 운영자가 승인하면 바로 쓸 수 있어요", tone: "ok" });
              }
            });
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            className={inputCls}
            autoComplete="email"
            inputMode="email"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "새 비밀번호 (6자 이상)" : "비밀번호"}
            className={inputCls}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
          <Button variant="primary" disabled={busy} className="h-11 w-full">
            {mode === "login" ? <LogIn size={16} /> : <UserPlus size={16} />}
            {busy ? "잠시만요…" : mode === "login" ? "로그인" : "가입 신청"}
          </Button>
          {mode === "login" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!email.trim()) {
                  setInfo(null);
                  setErr("위에 이메일을 먼저 적어 주세요.");
                  return;
                }
                void run(async () => {
                  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect });
                  if (error) throw error;
                  setInfo(
                    "가입된 이메일이면 몇 분 안에 재설정 메일이 와요(안 오면 스팸함과, 가입할 때 쓴 주소가 맞는지 확인). 가장 최근 메일의 링크를 1시간 안에 이 기기에서 누르면 새 비밀번호를 정하는 칸이 열려요.",
                  );
                });
              }}
              className="w-full text-center text-xs font-semibold text-muted hover:text-fg"
            >
              비밀번호를 잊었어요
            </button>
          )}
          {mode === "signup" && (
            <p className="text-xs leading-relaxed text-muted">
              가입 신청을 하면 운영자가 승인한 뒤에 쓸 수 있어요. 이미 계정이 있으면 ‘로그인’ 탭을 쓰세요.
            </p>
          )}
        </form>
      ) : !codeSent ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const { error } = await sb.auth.signInWithOtp({
                email: email.trim(),
                options: { shouldCreateUser: false, emailRedirectTo: redirect },
              });
              if (error) throw error;
              setCodeSent(true);
              setInfo("메일을 보냈어요. 메일에 6자리 코드가 있으면 아래에 넣고, 링크만 있으면 그 링크를 이 기기에서 누르세요.");
            });
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="가입한 이메일"
            className={inputCls}
            autoComplete="email"
            inputMode="email"
          />
          <Button variant="primary" disabled={busy} className="h-11 shrink-0">
            <Mail size={16} /> 메일 받기
          </Button>
        </form>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
              if (error) throw error;
              toast({ text: "로그인했습니다 — 동기화를 시작해요", tone: "ok" });
            });
          }}
        >
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
          <button type="button" onClick={() => setCodeSent(false)} className="text-xs text-muted underline">
            이메일 다시 입력
          </button>
        </form>
      )}

      {info && <p className="rounded-xl bg-accent/10 px-3 py-2 text-sm leading-relaxed text-accent-text">{info}</p>}
      {err && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm leading-relaxed text-danger">{err}</p>}
    </div>
  );
}
