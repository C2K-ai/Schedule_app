// 앱 아이콘 생성기 — 외부 의존성 없이 SDF로 그려서 PNG로 저장한다.
//   node scripts/gen-icons.mjs
// 디자인: 어두운 바탕 + 라임색 달성 링(300°) + 가운데 느낌표(!) = "해야 한다(MUST)"
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── PNG 인코더 ──
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── SDF 도형 ──
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const LIME = hex("#C8FF2E");
const WHITE = hex("#F4F6F8");
const BG_TOP = hex("#1A1D27");
const BG_BOT = hex("#08090C");

const sdRoundRect = (x, y, half, r) => {
  const qx = Math.abs(x) - half + r;
  const qy = Math.abs(y) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdCapsule = (x, y, ax, ay, bx, by, r) => {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
};
// 12시 방향에서 시계방향으로 sweep 만큼 그린 호 (둥근 끝)
const sdArc = (x, y, R, thick, startDeg, sweepDeg) => {
  let a = (Math.atan2(x, -y) * 180) / Math.PI; // 12시=0, 시계방향 +
  if (a < 0) a += 360;
  let rel = a - startDeg;
  if (rel < 0) rel += 360;
  if (rel <= sweepDeg) return Math.abs(Math.hypot(x, y) - R) - thick / 2;
  const end = (deg) => {
    const t = ((deg % 360) * Math.PI) / 180;
    return [Math.sin(t) * R, -Math.cos(t) * R];
  };
  const [sx, sy] = end(startDeg);
  const [ex, ey] = end(startDeg + sweepDeg);
  return Math.min(Math.hypot(x - sx, y - sy), Math.hypot(x - ex, y - ey)) - thick / 2;
};

function render(size, { shape = "round", mono = false, scale = 1 } = {}) {
  const out = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // -0.5..0.5 좌표
          const u = (px + (sx + 0.5) / SS) / size - 0.5;
          const v = (py + (sy + 0.5) / SS) / size - 0.5;
          let col = null;
          let alpha = 0;
          // 바탕
          if (!mono) {
            const inBg = shape === "square" ? true : sdRoundRect(u, v, 0.5, 0.22) <= 0;
            if (inBg) {
              const t = v + 0.5;
              col = BG_TOP.map((c, i) => c + (BG_BOT[i] - c) * t);
              // 왼쪽 위 라임 광
              const glow = Math.max(0, 1 - Math.hypot(u + 0.22, v + 0.26) / 0.55) ** 2 * 0.16;
              col = col.map((c, i) => c + (LIME[i] - c) * glow);
              alpha = 1;
            }
          }
          const x = u / scale, y = v / scale;
          // 링 트랙(옅게)
          const track = Math.abs(Math.hypot(x, y) - 0.29) - 0.04;
          if (track <= 0 && !mono) {
            col = col.map((c) => c + (255 - c) * 0.07);
          }
          // 링 호
          if (sdArc(x, y, 0.29, 0.08, 0, 300) <= 0) {
            col = mono ? [255, 255, 255] : LIME;
            alpha = 1;
          }
          // 느낌표 막대
          if (sdCapsule(x, y, 0, -0.125, 0, 0.035, 0.036) <= 0) {
            col = mono ? [255, 255, 255] : WHITE;
            alpha = 1;
          }
          // 느낌표 점
          if (Math.hypot(x, y - 0.115) - 0.04 <= 0) {
            col = mono ? [255, 255, 255] : LIME;
            alpha = 1;
          }
          if (col && alpha) {
            r += col[0];
            g += col[1];
            b += col[2];
            a += alpha;
          }
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      out[i] = a ? Math.round(r / a) : 0;
      out[i + 1] = a ? Math.round(g / a) : 0;
      out[i + 2] = a ? Math.round(b / a) : 0;
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, out);
}

const targets = [
  ["public/icons/icon-192.png", 192, {}],
  ["public/icons/icon-512.png", 512, {}],
  ["public/icons/maskable-512.png", 512, { shape: "square", scale: 0.86 }],
  ["public/icons/apple-touch-icon.png", 180, { shape: "square", scale: 0.92 }],
  ["public/icons/badge-96.png", 96, { mono: true, scale: 1.25 }],
  ["src/app/icon.png", 64, {}],
];

for (const [rel, size, opts] of targets) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(size, opts));
  console.log("✓", rel, `${size}px`);
}
