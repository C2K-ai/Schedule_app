"use client";

import { KeyRound, LogIn, Mail, UserPlus } from "lucide-react";
import { useState } from "react";
import { BASE_PATH } from "@/lib/base";
import { getSupabase } from "@/lib/supabase";
import { usePlanner } from "./PlannerProvider";
import { Button, cx, inputCls, Segmented } from "./ui";

type Mode = "login" | "signup" | "code";

/** Supabase 오류 → 알아듣기 쉬운 말 */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "이메일 또는 비밀번호가 틀렸어요.";
  if (m.includes("email not confirmed"))
    return "아직 메일 확인 전이에요. 메일함의 확인 링크를 먼저 눌러 주세요 — 링크를 누른 뒤 열리는 페이지가 오류여도 확인은 끝난 거예요.";
  if (m.includes("database error saving new user") || m.includes("1인 전용"))
    return "이 서버는 1인 전용이라 새 가입을 받지 않아요. 이미 만든 계정으로 로그인하세요.";
  if (m.includes("already registered") || m.includes("already been registered")) return "이미 가입된 이메일이에요. ‘로그인’으로 들어가세요.";
  if (m.includes("rate limit")) return "메일 발송 한도를 넘었어요(무료는 시간당 몇 통). 잠시 뒤 다시 하거나 비밀번호로 로그인하세요.";
  if (m.includes("password") && m.includes("6")) return "비밀번호는 6자 이상이어야 해요.";
  if (m.includes("token has expired") || m.includes("otp")) return "코드가 틀렸거나 만료됐어요. 다시 받아 주세요.";
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
          { value: "login", label: "로그인" },
          { value: "signup", label: "처음이에요" },
          { value: "code", label: "메일 코드로" },
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
                const { data, error } = await sb.auth.signUp({
                  email: email.trim(),
                  password,
                  options: { emailRedirectTo: redirect },
                });
                if (error) throw error;
                if (data.session) {
                  toast({ text: "가입 완료 — 로그인됐어요", tone: "ok" });
                } else {
                  setInfo(
                    `${email.trim()} 로 확인 메일을 보냈어요. 메일의 링크를 한 번 누른 뒤(열리는 페이지가 오류여도 괜찮아요) 여기서 ‘로그인’ 하세요.`,
                  );
                  setMode("login");
                }
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
            {busy ? "잠시만요…" : mode === "login" ? "로그인" : "계정 만들기"}
          </Button>
          {mode === "signup" && (
            <p className="text-xs leading-relaxed text-muted">
              이 서버는 1인 전용이에요. 처음 만든 계정 하나만 쓸 수 있고, 그 뒤 가입은 막힙니다.
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
