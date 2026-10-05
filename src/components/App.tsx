"use client";

import { Dashboard } from "./Dashboard";
import { PlannerProvider } from "./PlannerProvider";
import { Logo } from "./ui";

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-3">
        <div className="breathe">
          <Logo />
        </div>
        <p className="text-xs text-faint">불러오는 중…</p>
      </div>
    </div>
  );
}

export function App() {
  return (
    <PlannerProvider splash={<Splash />}>
      <Dashboard />
    </PlannerProvider>
  );
}
