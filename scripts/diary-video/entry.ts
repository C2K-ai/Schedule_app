import { createDiaryIntro } from "../../src/lib/diaryIntro/engine";
declare global { interface Window { __make: (mode: "open" | "close") => void; __seek: (ms: number) => Promise<void> } }
let intro: ReturnType<typeof createDiaryIntro> | null = null;
window.__make = (mode) => {
  intro?.destroy();
  intro = createDiaryIntro(document.getElementById("root")!, { mode, reducedMotion: false, sound: false, date: new Date(2026, 9, 10), onDone() {}, interactive: false, quality: "high" });
};
window.__seek = (ms) => new Promise((r) => { intro!.seek(ms); requestAnimationFrame(() => requestAnimationFrame(() => r())); });
