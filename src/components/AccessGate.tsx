"use client";

import { Clock, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { getSupabase } from "@/lib/supabase";
import { usePlanner } from "./PlannerProvider";
import { Button, Logo } from "./ui";

/** 가입 승인 대기 중이면 앱 대신 안내 화면 — 운영자가 승인하면 저절로 넘어간다.
 *  서버가 '대기'라고 분명히 답할 때만 막는다(오프라인·오류면 그대로 연다). */
export function AccessGate({ children }: { children: ReactNode }) {
  const { session } = usePlanner();
  const userId = session.userId;
  const [access, setAccess] = useState<{ user: string; approved: boolean } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    let alive = true;
    void sb.rpc("must_my_access").then(({ data, error }) => {
      if (!alive || error || !data) return;
      setAccess({ user: userId, approved: (data as { approved?: boolean }).approved !== false });
    });
    return () => {
      alive = false;
    };
  }, [userId, tick]);

  const pending = Boolean(userId && access?.user === userId && !access.approved);

  // 기다리는 동안 20초마다·앱으로 돌아올 때 다시 확인
  useEffect(() => {
    if (!pending) return;
    const again = () => setTick((n) => n + 1);
    const id = window.setInterval(again, 20_000);
    const onVis = () => document.visibilityState === "visible" && again();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pending]);

  if (!pending) return <>{children}</>;
  return <Pending email={session.email} onCheck={() => setTick((n) => n + 1)} />;
}

function Pending({ email, onCheck }: { email: string | null; onCheck: () => void }) {
  const { signOut } = usePlanner();
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-6 text-center shadow-xl">
        <Logo />
        <div className="mx-auto mt-6 grid size-14 place-items-center rounded-2xl bg-warn/15 text-warn">
          <Clock size={28} />
        </div>
        <h1 className="mt-4 text-xl font-black">승인을 기다리고 있어요</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {email ? <b className="text-fg">{email}</b> : "이 계정"} 으로 가입 신청을 보냈어요. 운영자가 승인하면 이 화면이 저절로 바뀌어요 — 앱을 닫았다
          나중에 다시 열어도 돼요.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button
            variant="primary"
            className="h-11"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onCheck();
              window.setTimeout(() => setBusy(false), 1200);
            }}
          >
            <RefreshCw size={16} className={busy ? "animate-spin" : undefined} /> 승인됐는지 확인
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => void signOut()}>
            <LogOut size={16} /> 로그아웃
          </Button>
        </div>
      </div>
    </div>
  );
}
