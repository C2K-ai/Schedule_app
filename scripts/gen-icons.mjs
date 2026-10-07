// 앱 아이콘 생성기 — 사용자가 고른 탁상 달력 그림을 배경만 살짝 잘라 아이콘으로 쓴다.
//   node scripts/gen-icons.mjs
// 원본: design/icon-source.png (1024², gitignore — 오른쪽 아래 생성 표시는 지워 둔 것)
// 알림 배지(badge-96)만은 상태 표시줄용 흰 실루엣이라 SVG로 그린다.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "design/icon-source.png");

// 사용자가 직접 자른 범위(위·아래 50~918) 그대로, 좌우만 조금 넓혀 정사각형 (원본 좌표)
const TIGHT = { left: 90, top: 50, width: 868, height: 868 };
// 마스커블(안드로이드 홈 화면) — 런처가 가장자리를 잘라 내므로 원본 전체
const FULL = { left: 0, top: 0, width: 1024, height: 1024 };

const roundMask = (size, radius) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`,
  );

async function photo(rel, size, { region = TIGHT, round = true } = {}) {
  let img = sharp(source).extract(region).resize(size, size, { kernel: "lanczos3" });
  if (round) {
    const mask = await sharp(roundMask(size, Math.round(size * 0.22))).png().toBuffer();
    img = sharp(await img.png().toBuffer()).composite([{ input: mask, blend: "dest-in" }]);
  }
  await img.png({ compressionLevel: 9, palette: true, quality: 92, effort: 10, dither: 0.6 }).toFile(join(root, rel));
}

// 흰 달력 실루엣 + 체크 표시(투명으로 뚫음)
const BADGE = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <defs><mask id="m"><rect width="96" height="96" fill="#fff"/>
    <path d="M30 54l12 12 24-26" fill="none" stroke="#000" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  </mask></defs>
  <g fill="#fff" mask="url(#m)">
    <rect x="14" y="20" width="68" height="64" rx="12"/>
  </g>
  <rect x="28" y="10" width="9" height="20" rx="4.5" fill="#fff"/>
  <rect x="59" y="10" width="9" height="20" rx="4.5" fill="#fff"/>
</svg>`;

const targets = [
  ["public/icons/icon-192.png", 192, {}],
  ["public/icons/icon-512.png", 512, {}],
  ["public/icons/maskable-512.png", 512, { region: FULL, round: false }],
  // iOS 는 모서리를 알아서 둥글린다
  ["public/icons/apple-touch-icon.png", 180, { round: false }],
  ["src/app/icon.png", 64, {}],
];

for (const [rel, size, opts] of targets) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  await photo(rel, size, opts);
  console.log("✓", rel, `${size}px`);
}
await sharp(Buffer.from(BADGE)).png().toFile(join(root, "public/icons/badge-96.png"));
console.log("✓ public/icons/badge-96.png 96px");
