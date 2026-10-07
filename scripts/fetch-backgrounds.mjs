// 배경 사진 받아오기 — Unsplash(무료 사용·출처 표기 불필요 라이선스) 사진을 앱 배경용 webp 로.
//   node scripts/fetch-backgrounds.mjs candidates   → bg-out/ 에 후보 미리보기 + 번호 붙은 모아보기(sheet-*.jpg)
//   node scripts/fetch-backgrounds.mjs final        → scripts/backgrounds.json 의 사진을 public/themes/bg/ 에
// 사진은 Unsplash 다운로드 주소에서 받는다. 유료(Unsplash+) 사진은 받아지지 않아 자동으로 빠진다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "candidates";

async function download(id, width) {
  const res = await fetch(`https://unsplash.com/photos/${id}/download?force=true&w=${width}`, {
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (MUST planner background fetch)" },
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new Error(`${id}: ${res.status} ${type}`);
  return Buffer.from(await res.arrayBuffer());
}

if (mode === "candidates") {
  const ids = JSON.parse(await readFile(join(root, "scripts/background-candidates.json"), "utf8"));
  const out = join(root, "bg-out");
  await mkdir(join(out, "cand"), { recursive: true });
  const ok = [];
  for (const [i, id] of ids.entries()) {
    try {
      const buf = await download(id, 640);
      const meta = await sharp(buf).metadata();
      await writeFile(join(out, "cand", `${String(i + 1).padStart(2, "0")}-${id}.jpg`), buf);
      ok.push({ n: i + 1, id, w: meta.width, h: meta.height, buf });
      console.log("ok", i + 1, id, meta.width, meta.height);
    } catch (e) {
      console.log("skip", i + 1, id, String(e.message ?? e));
    }
  }
  // 번호 붙은 모아보기 — 한 장에 12개(4×3)
  const W = 300,
    H = 200,
    COLS = 4,
    PER = 12;
  for (let s = 0; s * PER < ok.length; s++) {
    const items = ok.slice(s * PER, s * PER + PER);
    const rows = Math.ceil(items.length / COLS);
    const tiles = await Promise.all(
      items.map(async (it, k) => {
        const label = Buffer.from(
          `<svg width="${W}" height="${H}"><rect x="0" y="0" width="64" height="34" fill="black" opacity="0.7"/><text x="8" y="25" font-size="22" font-family="sans-serif" font-weight="bold" fill="white">${it.n}</text></svg>`,
        );
        const img = await sharp(it.buf).resize(W, H, { fit: "cover" }).composite([{ input: label }]).jpeg({ quality: 80 }).toBuffer();
        return { input: img, left: (k % COLS) * W, top: Math.floor(k / COLS) * H };
      }),
    );
    await sharp({ create: { width: COLS * W, height: rows * H, channels: 3, background: "#111" } })
      .composite(tiles)
      .jpeg({ quality: 82 })
      .toFile(join(out, `sheet-${s + 1}.jpg`));
  }
  await writeFile(join(out, "ok.json"), JSON.stringify(ok.map(({ buf, ...r }) => r), null, 2));
} else if (mode === "final") {
  const list = JSON.parse(await readFile(join(root, "scripts/backgrounds.json"), "utf8"));
  const dir = join(root, "public/themes/bg");
  await mkdir(dir, { recursive: true });
  for (const b of list) {
    const buf = await download(b.id, 2400);
    const img = sharp(buf).rotate();
    // 폰(세로)·PC(가로) 둘 다 cover 로 잘라 쓰므로 큰 쪽 2000px 이면 충분
    await img.clone().resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).webp({ quality: 74, effort: 6 }).toFile(join(dir, `${b.key}.webp`));
    await img.clone().resize(240, 160, { fit: "cover" }).webp({ quality: 70 }).toFile(join(dir, `${b.key}-thumb.webp`));
    console.log("saved", b.key, b.id);
  }
}
