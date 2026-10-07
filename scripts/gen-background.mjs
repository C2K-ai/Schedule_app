// 테마 배경 그리기 — 사용자가 고른 사진(design/theme-swing-sunset.png, 출처 미확인)의 분위기를
// 직접 다시 그린 벡터 그림. 사진을 복제하지 않고 구도·색감만 재현한다.
//   node scripts/gen-background.mjs   →  public/themes/dusk-portrait.svg, dusk-landscape.svg
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// 재현 가능한 난수
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const n1 = (v) => Math.round(v * 10) / 10;
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function scene(W, H, L, seed = 7) {
  const r = rng(seed);
  const out = [];
  const defs = [];
  const hz = L.horizon * H; // 지평선
  const U = Math.min(W, H * 0.62); // 크기 단위

  // ── 하늘 ──
  defs.push(`<linearGradient id="sky" x1="0" y1="0" x2="0" y2="${n1(hz + 40)}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#05071f"/>
    <stop offset="0.38" stop-color="#11123d"/>
    <stop offset="0.6" stop-color="#241a55"/>
    <stop offset="0.76" stop-color="#43216b"/>
    <stop offset="0.86" stop-color="#762a73"/>
    <stop offset="0.925" stop-color="#bb4170"/>
    <stop offset="0.965" stop-color="#ec7766"/>
    <stop offset="1" stop-color="#ffb57d"/>
  </linearGradient>`);
  out.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);

  // 은하수 띠(아주 옅게)
  defs.push(`<radialGradient id="milky"><stop offset="0" stop-color="#9c86e0" stop-opacity="0.16"/><stop offset="0.5" stop-color="#6f5fb8" stop-opacity="0.07"/><stop offset="1" stop-color="#4a3f8a" stop-opacity="0"/></radialGradient>`);
  out.push(
    `<ellipse cx="${n1(W * L.milky.x)}" cy="${n1(hz * L.milky.y)}" rx="${n1(W * L.milky.rx)}" ry="${n1(hz * L.milky.ry)}" fill="url(#milky)" transform="rotate(${L.milky.rot} ${n1(W * L.milky.x)} ${n1(hz * L.milky.y)})"/>`,
  );

  // ── 별 ──
  defs.push(`<radialGradient id="starGlow"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);
  const starColors = ["#ffffff", "#ffffff", "#ffffff", "#dce6ff", "#cfd9ff", "#ffeedd"];
  const sc = U / 1080;
  const stars = [];
  for (let i = 0; i < L.stars; i++) {
    const y = hz * 0.93 * Math.pow(r(), 1.45);
    const x = r() * W;
    const p = r();
    const fade = 1 - Math.pow(y / (hz * 0.93), 3) * 0.7; // 지평선 가까울수록 흐리게
    if (p < 0.78) stars.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(lerp(0.5, 1.15, r()) * sc * 1.4)}" fill="${pick(r, starColors)}" opacity="${(lerp(0.3, 0.8, r()) * fade).toFixed(2)}"/>`);
    else if (p < 0.965) stars.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(lerp(1.2, 1.9, r()) * sc * 1.4)}" fill="${pick(r, starColors)}" opacity="${(lerp(0.6, 0.95, r()) * fade).toFixed(2)}"/>`);
    else {
      const rr = lerp(1.9, 2.8, r()) * sc * 1.4;
      stars.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(rr * 5)}" fill="url(#starGlow)" opacity="${(0.7 * fade).toFixed(2)}"/>`);
      stars.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(rr)}" fill="#fff" opacity="${(0.95 * fade).toFixed(2)}"/>`);
    }
  }
  // 은하수 따라 촘촘한 잔별
  const mrad = (L.milky.rot * Math.PI) / 180;
  for (let i = 0; i < L.stars * 0.35; i++) {
    const t = r() * 2 - 1;
    const off = (r() + r() + r() - 1.5) * hz * L.milky.ry * 0.9;
    const x = W * L.milky.x + Math.cos(mrad) * t * W * L.milky.rx - Math.sin(mrad) * off;
    const y = hz * L.milky.y + Math.sin(mrad) * t * W * L.milky.rx + Math.cos(mrad) * off;
    if (y < 0 || y > hz * 0.85 || x < 0 || x > W) continue;
    stars.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(lerp(0.4, 0.9, r()) * sc * 1.4)}" fill="#e6e8ff" opacity="${lerp(0.25, 0.6, r()).toFixed(2)}"/>`);
  }
  out.push(`<g>${stars.join("")}</g>`);

  // ── 노을빛 + 해 ──
  const sunX = W * L.sun.x;
  const sunY = hz + U * 0.006;
  const sunR = U * L.sun.r;
  defs.push(`<radialGradient id="glow"><stop offset="0" stop-color="#ffcf98" stop-opacity="0.9"/><stop offset="0.18" stop-color="#ff9a78" stop-opacity="0.6"/><stop offset="0.45" stop-color="#e2557c" stop-opacity="0.32"/><stop offset="0.75" stop-color="#9b3b86" stop-opacity="0.12"/><stop offset="1" stop-color="#5a2a78" stop-opacity="0"/></radialGradient>`);
  out.push(`<ellipse cx="${n1(sunX)}" cy="${n1(sunY)}" rx="${n1(W * L.glow.rx)}" ry="${n1(U * L.glow.ry)}" fill="url(#glow)"/>`);
  defs.push(`<radialGradient id="halo"><stop offset="0" stop-color="#fff1cf" stop-opacity="0.8"/><stop offset="0.35" stop-color="#ffc58f" stop-opacity="0.35"/><stop offset="1" stop-color="#ff9a70" stop-opacity="0"/></radialGradient>`);
  out.push(`<circle cx="${n1(sunX)}" cy="${n1(sunY)}" r="${n1(sunR * 4.2)}" fill="url(#halo)"/>`);
  defs.push(`<radialGradient id="sun"><stop offset="0" stop-color="#fffdf2"/><stop offset="0.55" stop-color="#ffe7b0"/><stop offset="0.86" stop-color="#ffbb78"/><stop offset="1" stop-color="#ff9466"/></radialGradient>`);
  out.push(`<circle cx="${n1(sunX)}" cy="${n1(sunY)}" r="${n1(sunR)}" fill="url(#sun)"/>`);

  // ── 산 능선(먼 것 → 가까운 것) ──
  const ridge = (base, amp, freq, phase, colTop, colBot, id, op = 1) => {
    defs.push(`<linearGradient id="${id}" x1="0" y1="${n1(base - amp)}" x2="0" y2="${n1(base + amp * 3)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${colTop}"/><stop offset="1" stop-color="${colBot}"/></linearGradient>`);
    const pts = [];
    const steps = 90;
    for (let i = 0; i <= steps; i++) {
      const x = -20 + ((W + 40) * i) / steps;
      const t = x / W;
      const y =
        base -
        amp *
          (0.55 * Math.sin(t * Math.PI * freq + phase) +
            0.3 * Math.sin(t * Math.PI * freq * 2.3 + phase * 1.7) +
            0.15 * Math.sin(t * Math.PI * freq * 5.1 + phase * 0.3) +
            (r() - 0.5) * 0.12);
      pts.push([x, y]);
    }
    let d = `M -20 ${H} L ${n1(pts[0][0])} ${n1(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q ${n1(pts[i][0])} ${n1(pts[i][1])} ${n1(mx)} ${n1(my)}`;
    }
    d += ` L ${W + 20} ${H} Z`;
    out.push(`<path d="${d}" fill="url(#${id})" opacity="${op}"/>`);
  };
  ridge(hz + U * 0.012, U * 0.03, 2.2, 0.6, "#8a4f90", "#55377e", "r1", 0.95);
  // 능선 사이 옅은 노을 안개
  defs.push(`<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a8a" stop-opacity="0.25"/><stop offset="1" stop-color="#ff9a8a" stop-opacity="0"/></linearGradient>`);
  out.push(`<rect x="0" y="${n1(hz + U * 0.005)}" width="${W}" height="${n1(U * 0.07)}" fill="url(#haze)"/>`);
  ridge(hz + U * 0.05, U * 0.04, 1.6, 2.1, "#4c3c80", "#30296a", "r2");
  ridge(hz + U * 0.1, U * 0.05, 1.3, 4.0, "#2c2c62", "#1f224d", "r3");
  ridge(hz + U * 0.16, U * 0.045, 1.0, 1.2, "#1b1e43", "#131634", "r4");

  // ── 땅 ──
  const g0 = L.ground.left * H;
  const g1 = L.ground.right * H;
  defs.push(`<linearGradient id="ground" x1="0" y1="${n1(Math.min(g0, g1))}" x2="0" y2="${H}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1c3626"/><stop offset="0.2" stop-color="#132a1b"/><stop offset="0.6" stop-color="#0b190f"/><stop offset="1" stop-color="#040a05"/></linearGradient>`);
  const groundPath = `M -10 ${n1(g0)} C ${n1(W * 0.3)} ${n1(g0 + U * 0.012)} ${n1(W * 0.55)} ${n1(g1 + U * 0.02)} ${n1(W * 0.78)} ${n1(g1)} S ${W + 10} ${n1(g1 + U * 0.01)} ${W + 10} ${n1(g1 + U * 0.012)} L ${W + 10} ${H} L -10 ${H} Z`;
  out.push(`<path d="${groundPath}" fill="url(#ground)"/>`);
  out.push(`<path d="M -10 ${n1(g0)} C ${n1(W * 0.3)} ${n1(g0 + U * 0.012)} ${n1(W * 0.55)} ${n1(g1 + U * 0.02)} ${n1(W * 0.78)} ${n1(g1)} S ${W + 10} ${n1(g1 + U * 0.01)} ${W + 10} ${n1(g1 + U * 0.012)}" fill="none" stroke="#5f8f5c" stroke-opacity="0.45" stroke-width="${n1(U * 0.003)}"/>`);
  // 그네 아래 은은하게 밝은 풀빛
  defs.push(`<radialGradient id="lawn"><stop offset="0" stop-color="#4f7d42" stop-opacity="0.38"/><stop offset="1" stop-color="#2c4d2c" stop-opacity="0"/></radialGradient>`);
  out.push(`<ellipse cx="${n1(W * L.lawn.x)}" cy="${n1(H * L.lawn.y)}" rx="${n1(W * L.lawn.rx)}" ry="${n1(U * 0.09)}" fill="url(#lawn)"/>`);

  const groundTopAt = (x) => lerp(g0, g1, Math.min(1, Math.max(0, x / (W * 0.78))));

  // ── 왼쪽 작은 나무(실루엣에 가깝게) ──
  {
    const T = L.small;
    const bx = W * T.x;
    const by = H * T.base;
    const h = U * T.h;
    const tw = U * 0.012;
    out.push(`<path d="M ${n1(bx - tw)} ${n1(by)} Q ${n1(bx - tw * 0.6)} ${n1(by - h * 0.45)} ${n1(bx - tw * 0.2)} ${n1(by - h * 0.7)} L ${n1(bx + tw * 0.3)} ${n1(by - h * 0.7)} Q ${n1(bx + tw * 0.5)} ${n1(by - h * 0.4)} ${n1(bx + tw)} ${n1(by)} Z" fill="#15100d"/>`);
    const blobs = [];
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2;
      const rad = Math.sqrt(r());
      const cx = bx + Math.cos(a) * rad * h * 0.42;
      const cy = by - h * 0.72 + Math.sin(a) * rad * h * 0.34;
      blobs.push(`<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(lerp(0.12, 0.2, r()) * h)}" fill="${pick(r, ["#0d1d14", "#11251a", "#16301f"])}"/>`);
    }
    for (let i = 0; i < 30; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.2;
      const rad = lerp(0.5, 1, r());
      const cx = bx + Math.cos(a) * rad * h * 0.38;
      const cy = by - h * 0.72 + Math.sin(a) * rad * h * 0.3;
      blobs.push(`<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(lerp(0.05, 0.09, r()) * h)}" fill="${pick(r, ["#2a4a2c", "#335a34"])}" opacity="0.8"/>`);
    }
    out.push(`<g>${blobs.join("")}</g>`);
  }

  // ── 쓰러진 통나무 ──
  {
    const lx = W * L.log.x;
    const ly = groundTopAt(lx) + U * 0.02;
    out.push(`<g transform="rotate(-6 ${n1(lx)} ${n1(ly)})"><rect x="${n1(lx - U * 0.06)}" y="${n1(ly - U * 0.012)}" width="${n1(U * 0.12)}" height="${n1(U * 0.026)}" rx="${n1(U * 0.012)}" fill="#2a1d14"/><rect x="${n1(lx - U * 0.055)}" y="${n1(ly - U * 0.011)}" width="${n1(U * 0.11)}" height="${n1(U * 0.007)}" rx="${n1(U * 0.004)}" fill="#5b4330" opacity="0.6"/><ellipse cx="${n1(lx + U * 0.058)}" cy="${n1(ly + U * 0.001)}" rx="${n1(U * 0.008)}" ry="${n1(U * 0.012)}" fill="#7a5a3e"/></g>`);
  }

  // ── 돌(뒤쪽) — 앞쪽 큰 돌은 풀과 함께 나무 뒤에 그린다 ──
  const gTop = Math.min(g0, g1) + U * 0.03;
  const tree = L.tree;
  const tbx = W * tree.trunkX;
  const tby = H * tree.base;
  defs.push(`<linearGradient id="stoneA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#717a92"/><stop offset="0.5" stop-color="#434a5e"/><stop offset="1" stop-color="#1a1e29"/></linearGradient>`);
  defs.push(`<linearGradient id="stoneB" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#666e84"/><stop offset="0.55" stop-color="#3a4053"/><stop offset="1" stop-color="#171a24"/></linearGradient>`);
  const stoneSvg = (x, y, s) => {
    const lit = r() < 0.5 ? "stoneA" : "stoneB";
    const squash = lerp(0.5, 0.7, r());
    // 둥근 돌: 위가 조금 납작한 비대칭 모양
    const d = `M ${n1(x - s)} ${n1(y + s * squash * 0.35)}
      C ${n1(x - s)} ${n1(y - s * squash * 0.7)} ${n1(x - s * 0.2)} ${n1(y - s * squash)} ${n1(x + s * 0.25)} ${n1(y - s * squash * 0.95)}
      C ${n1(x + s * 0.85)} ${n1(y - s * squash * 0.85)} ${n1(x + s)} ${n1(y - s * squash * 0.1)} ${n1(x + s * 0.95)} ${n1(y + s * squash * 0.35)}
      Z`.replace(/\s+/g, " ");
    return (
      `<ellipse cx="${n1(x + s * 0.12)}" cy="${n1(y + s * squash * 0.38)}" rx="${n1(s * 1.08)}" ry="${n1(s * 0.22)}" fill="#030604" opacity="0.6"/>` +
      `<path d="${d}" fill="url(#${lit})"/>` +
      `<path d="M ${n1(x - s * 0.7)} ${n1(y - s * squash * 0.45)} Q ${n1(x - s * 0.2)} ${n1(y - s * squash * 0.9)} ${n1(x + s * 0.35)} ${n1(y - s * squash * 0.82)}" stroke="#b9c2da" stroke-opacity="${lerp(0.18, 0.35, r()).toFixed(2)}" stroke-width="${n1(s * 0.09)}" fill="none" stroke-linecap="round"/>`
    );
  };
  const backStones = [];
  const frontStones = [];
  for (let i = 0; i < L.stonesN; i++) {
    // 앞쪽(아래)에 몰리게, 위쪽엔 작고 드물게
    const y = r() < 0.55 ? lerp(H * 0.86, H * 1.0, r()) : lerp(gTop + U * 0.03, H * 0.86, Math.pow(r(), 0.8));
    const x = r() * W;
    if (y < groundTopAt(x) + U * 0.02) continue;
    const depth = (y - gTop) / (H - gTop);
    const s = lerp(U * 0.01, U * 0.075, Math.pow(depth, 1.7)) * lerp(0.6, 1.25, r());
    (y > tby ? frontStones : backStones).push(stoneSvg(x, y, s));
  }
  out.push(`<g>${backStones.join("")}</g>`);

  // ── 큰 나무 ──
  const x0 = W * tree.x0;
  const x1 = W * tree.x1;
  const y0 = H * tree.y0;
  const y1 = H * tree.y1;
  const bw = x1 - x0;
  const bh = y1 - y0;
  const P = (u, v) => [x0 + u * bw, y0 + v * bh];
  const split = P(tree.split[0] - 0.035, tree.split[1]);

  // 줄기 — 어두운 실루엣에 노을 쪽(왼쪽) 가장자리만 따뜻하게 빛남
  const tw0 = bw * 0.062;
  const tw1 = bw * 0.03;
  defs.push(`<linearGradient id="bark" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4b3626"/><stop offset="0.3" stop-color="#2e2119"/><stop offset="1" stop-color="#140e0a"/></linearGradient>`);
  const ly = (t) => lerp(tby, split[1], t);
  const trunk = `M ${n1(tbx - tw0 * 1.9)} ${n1(tby + U * 0.006)}
    C ${n1(tbx - tw0 * 0.9)} ${n1(tby - U * 0.004)} ${n1(tbx - tw0 * 0.62)} ${n1(tby - U * 0.04)} ${n1(tbx - tw0 * 0.55)} ${n1(ly(0.22))}
    C ${n1(tbx - tw0 * 0.25)} ${n1(ly(0.5))} ${n1(split[0] - tw1 * 1.6)} ${n1(ly(0.72))} ${n1(split[0] - tw1)} ${n1(split[1])}
    L ${n1(split[0] + tw1)} ${n1(split[1])}
    C ${n1(split[0] + tw1 * 0.4)} ${n1(ly(0.75))} ${n1(tbx + tw0 * 0.75)} ${n1(ly(0.5))} ${n1(tbx + tw0 * 0.6)} ${n1(ly(0.18))}
    C ${n1(tbx + tw0 * 0.65)} ${n1(tby - U * 0.03)} ${n1(tbx + tw0 * 1.0)} ${n1(tby - U * 0.004)} ${n1(tbx + tw0 * 2.1)} ${n1(tby + U * 0.008)} Z`.replace(/\s+/g, " ");
  const quad = (from, ctrl, to, t) => [
    (1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * ctrl[0] + t * t * to[0],
    (1 - t) * (1 - t) * from[1] + 2 * (1 - t) * t * ctrl[1] + t * t * to[1],
  ];
  const branchSvg = (from, ctrl, to, w0, w1, seg = 12) => {
    const parts = [];
    for (let i = 0; i < seg; i++) {
      const a = quad(from, ctrl, to, i / seg);
      const b = quad(from, ctrl, to, (i + 1) / seg);
      const w = lerp(w0, w1, i / seg);
      parts.push(`<path d="M ${n1(a[0])} ${n1(a[1])} L ${n1(b[0])} ${n1(b[1])}" stroke="#22180f" stroke-width="${n1(w)}" stroke-linecap="round"/>`);
      parts.push(`<path d="M ${n1(a[0] - w * 0.22)} ${n1(a[1] - w * 0.15)} L ${n1(b[0] - w * 0.22)} ${n1(b[1] - w * 0.15)}" stroke="#a8705a" stroke-opacity="0.22" stroke-width="${n1(w * 0.22)}" stroke-linecap="round"/>`);
    }
    return parts.join("");
  };
  // 큰 가지 + 곁가지
  const mainBranches = [];
  const twigs = [];
  for (const b of tree.branches) {
    const to = P(b.to[0], b.to[1]);
    const c = P(b.c[0], b.c[1]);
    mainBranches.push(branchSvg(split, c, to, bw * b.w0, bw * b.w1));
    for (let k = 0; k < 3; k++) {
      const t = lerp(0.35, 0.85, r());
      const s = quad(split, c, to, t);
      const ang = Math.atan2(to[1] - split[1], to[0] - split[0]) + (r() < 0.5 ? -1 : 1) * lerp(0.4, 0.9, r());
      const len = bw * lerp(0.06, 0.12, r());
      const e = [s[0] + Math.cos(ang) * len, s[1] + Math.sin(ang) * len * 0.8];
      twigs.push(branchSvg(s, [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2 - len * 0.15], e, bw * lerp(b.w0, b.w1, t) * 0.5, bw * 0.004, 6));
    }
  }
  // 그네 가지 — 줄기에서 왼쪽으로, 수관 아래쪽 안에 숨어 있음
  const sb = tree.swingBranch;
  const sbFrom = P(sb.from[0], sb.from[1]);
  const sbTo = P(sb.to[0], sb.to[1]);
  const sbC = P(sb.c[0], sb.c[1]);
  const swingBranch = branchSvg(sbFrom, sbC, sbTo, bw * 0.028, bw * 0.008, 14);

  // 그네 줄 — 가지에서 내려옴(위쪽은 잎에 가려짐)
  const s = tree.swing;
  const rx1 = x0 + s.x1 * bw;
  const rx2 = x0 + s.x2 * bw;
  const seatY = H * s.seat;
  const ropeTop = (x) => {
    // 그네 가지 곡선에서 x 에 가장 가까운 점의 y
    let best = sbFrom[1];
    let bd = Infinity;
    for (let i = 0; i <= 40; i++) {
      const q = quad(sbFrom, sbC, sbTo, i / 40);
      const d = Math.abs(q[0] - x);
      if (d < bd) {
        bd = d;
        best = q[1];
      }
    }
    return best;
  };
  const rope = U * 0.0032;
  const ropes =
    `<path d="M ${n1(rx1)} ${n1(ropeTop(rx1))} L ${n1(rx1 + U * 0.001)} ${n1(seatY)}" stroke="#e9d8b6" stroke-opacity="0.88" stroke-width="${n1(rope)}"/>` +
    `<path d="M ${n1(rx2)} ${n1(ropeTop(rx2))} L ${n1(rx2 + U * 0.001)} ${n1(seatY)}" stroke="#e9d8b6" stroke-opacity="0.88" stroke-width="${n1(rope)}"/>`;

  // 잎 뭉치 — 원 몇 개를 겹친 덩어리. 위·왼쪽 밝게, 아래·오른쪽 어둡게.
  const lobes = tree.lobes.map((l) => ({ cx: x0 + l.u * bw, cy: y0 + l.v * bh, rx: l.ru * bw, ry: l.rv * bh, w: l.ru * l.rv }));
  const wsum = lobes.reduce((acc, l) => acc + l.w, 0);
  const canopyTop = Math.min(...lobes.map((l) => l.cy - l.ry));
  const canopyBot = Math.max(...lobes.map((l) => l.cy + l.ry));
  const samplePoint = (edgeBias = 0) => {
    let k = r() * wsum;
    let lobe = lobes[0];
    for (const l of lobes) {
      k -= l.w;
      if (k <= 0) {
        lobe = l;
        break;
      }
    }
    const a = r() * Math.PI * 2;
    const rad = Math.pow(r(), lerp(0.5, 0.2, edgeBias));
    return { x: lobe.cx + Math.cos(a) * rad * lobe.rx, y: lobe.cy + Math.sin(a) * rad * lobe.ry, lobe, rad, a };
  };
  const clump = (cx, cy, size, base, light, dark, lightOp) => {
    const parts = [];
    const n = 4 + Math.floor(r() * 4);
    // 그림자(아래 오른쪽)
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * size * 0.55;
      parts.push(`<circle cx="${n1(cx + Math.cos(a) * d + size * 0.12)}" cy="${n1(cy + Math.sin(a) * d * 0.8 + size * 0.14)}" r="${n1(size * lerp(0.35, 0.6, r()))}" fill="${dark}"/>`);
    }
    // 몸통
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * size * 0.5;
      parts.push(`<circle cx="${n1(cx + Math.cos(a) * d)}" cy="${n1(cy + Math.sin(a) * d * 0.8)}" r="${n1(size * lerp(0.3, 0.52, r()))}" fill="${base}"/>`);
    }
    // 빛(위 왼쪽)
    if (lightOp > 0) {
      for (let i = 0; i < Math.ceil(n / 2); i++) {
        const a = Math.PI * lerp(1.05, 1.6, r());
        const d = size * lerp(0.15, 0.45, r());
        parts.push(`<circle cx="${n1(cx + Math.cos(a) * d)}" cy="${n1(cy + Math.sin(a) * d * 0.8)}" r="${n1(size * lerp(0.14, 0.26, r()))}" fill="${light}" opacity="${lightOp.toFixed(2)}"/>`);
      }
    }
    return parts.join("");
  };
  const leafBack = [];
  const leafMid = [];
  const leafFront = [];
  const sz = (lo, hi) => bw * lerp(lo, hi, Math.pow(r(), 1.6));
  // 1) 뒤쪽 어두운 덩어리 — 전체 실루엣
  for (let i = 0; i < L.clumps * 0.45; i++) {
    const p = samplePoint(0.3);
    leafBack.push(clump(p.x, p.y, sz(0.035, 0.07), "#0c1d13", "#14301d", "#07120b", 0));
  }
  // 늘어진 아랫자락 + 가장자리 잔잎(실루엣을 불규칙하게)
  for (const l of lobes) {
    const m = Math.round(l.rx / bw * 60);
    for (let i = 0; i < m; i++) {
      const a = lerp(0.15, 0.85, r()) * Math.PI; // 아래쪽 반
      const x = l.cx + Math.cos(a) * l.rx * lerp(0.75, 1.02, r());
      const y = l.cy + Math.sin(a) * l.ry * lerp(0.8, 1.08, r());
      leafBack.push(clump(x, y, sz(0.012, 0.03), "#0e2116", "#173520", "#08140c", 0));
    }
  }
  // 2) 중간 — 깊이에 따라 색
  for (let i = 0; i < L.clumps * 0.4; i++) {
    const p = samplePoint(0.5);
    const h = (p.y - canopyTop) / (canopyBot - canopyTop); // 0 위 ~ 1 아래
    const base = h < 0.35 ? "#25472b" : h < 0.65 ? "#1d3c24" : "#16301d";
    const light = h < 0.5 ? "#3d6b38" : "#2e5530";
    leafMid.push(clump(p.x, p.y, sz(0.022, 0.048), base, light, "#0e2216", h < 0.6 ? 0.8 : 0.5));
  }
  // 3) 앞쪽 밝은 뭉치 — 덩어리 위·왼쪽에 몰림(빛 받는 면)
  for (let i = 0; i < L.clumps * 0.32; i++) {
    const p = samplePoint(0.6);
    const relY = (p.y - p.lobe.cy) / p.lobe.ry;
    const relX = (p.x - p.lobe.cx) / p.lobe.rx;
    if (relY > 0.2 || relX > 0.55) continue;
    leafFront.push(clump(p.x, p.y, sz(0.014, 0.032), pick(r, ["#2d5631", "#335f34", "#2a5230"]), pick(r, ["#4f8142", "#5a8c48", "#467a3e"]), "#1a3a22", 0.85));
  }
  // 4) 하늘이 비치는 틈 — 가장자리 근처에 하늘색(같은 그라데이션)으로 구멍
  const holes = [];
  const insideOther = (x, y, self) =>
    lobes.some((o) => o !== self && ((x - o.cx) / o.rx) ** 2 + ((y - o.cy) / o.ry) ** 2 < 0.85);
  for (let i = 0; i < L.clumps * 0.25; i++) {
    const l = pick(r, lobes);
    const a = r() * Math.PI * 2;
    const rad = lerp(0.8, 0.95, r());
    const x = l.cx + Math.cos(a) * l.rx * rad;
    const y = l.cy + Math.sin(a) * l.ry * rad;
    if (y > canopyBot - bh * 0.06 || insideOther(x, y, l)) continue;
    holes.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(bw * lerp(0.003, 0.008, r()))}" fill="url(#sky)"/>`);
  }
  // 5) 노을에 물든 가장자리 — 아주 옅게, 아래·왼쪽 테두리에만
  const rims = [];
  for (let i = 0; i < L.clumps * 0.05; i++) {
    const l = pick(r, lobes);
    const a = lerp(0.45, 1.05, r()) * Math.PI; // 왼쪽 아래
    const x = l.cx + Math.cos(a) * l.rx * lerp(0.86, 0.99, r());
    const y = l.cy + Math.sin(a) * l.ry * lerp(0.86, 0.99, r());
    rims.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(bw * lerp(0.003, 0.007, r()))}" fill="${pick(r, ["#ff9f7c", "#f2857c", "#ffb48a"])}" opacity="${lerp(0.07, 0.16, r()).toFixed(2)}"/>`);
  }

  // 그리는 순서: 가지 → 그네 가지·줄 → 뒤 잎 → 곁가지 → 중간 잎 → 앞 잎 → 틈 → 가장자리 빛 → 줄기
  out.push(`<g>${mainBranches.join("")}</g>`);
  out.push(swingBranch);
  out.push(ropes);
  out.push(`<g>${leafBack.join("")}</g>`);
  out.push(`<g>${twigs.join("")}</g>`);
  out.push(`<g>${leafMid.join("")}</g>`);
  out.push(`<g>${leafFront.join("")}</g>`);
  out.push(`<g>${holes.join("")}</g>`);
  out.push(`<g>${rims.join("")}</g>`);
  out.push(`<path d="${trunk}" fill="url(#bark)"/>`);
  // 줄기 결 + 노을 쪽 테두리 빛
  const bark = [];
  for (let i = 0; i < 9; i++) {
    const u = lerp(-0.4, 0.45, r());
    const t0 = lerp(0, 0.3, r());
    const t1 = lerp(0.55, 0.95, r());
    const xa = lerp(tbx, split[0], t0) + u * lerp(tw0, tw1, t0);
    const xb = lerp(tbx, split[0], t1) + u * lerp(tw0, tw1, t1);
    bark.push(`<path d="M ${n1(xa)} ${n1(ly(t0))} Q ${n1((xa + xb) / 2 + (r() - 0.5) * tw1 * 0.4)} ${n1(ly((t0 + t1) / 2))} ${n1(xb)} ${n1(ly(t1))}" stroke="#0e0906" stroke-opacity="0.55" stroke-width="${n1(U * lerp(0.0015, 0.003, r()))}" fill="none"/>`);
  }
  bark.push(`<path d="M ${n1(tbx - tw0 * 0.55)} ${n1(ly(0.06))} C ${n1(tbx - tw0 * 0.5)} ${n1(ly(0.55))} ${n1(split[0] - tw1 * 1.1)} ${n1(ly(0.8))} ${n1(split[0] - tw1)} ${n1(split[1])}" stroke="#d48a62" stroke-opacity="0.28" stroke-width="${n1(U * 0.004)}" fill="none"/>`);
  out.push(`<g>${bark.join("")}</g>`);

  // 그네 판
  {
    const sw = rx2 - rx1 + U * 0.022;
    out.push(`<rect x="${n1(rx1 - U * 0.009)}" y="${n1(seatY - U * 0.004)}" width="${n1(sw)}" height="${n1(U * 0.012)}" rx="${n1(U * 0.003)}" fill="#7a4e2e"/>`);
    out.push(`<rect x="${n1(rx1 - U * 0.009)}" y="${n1(seatY - U * 0.004)}" width="${n1(sw)}" height="${n1(U * 0.0035)}" rx="${n1(U * 0.002)}" fill="#e0aa72"/>`);
    out.push(`<ellipse cx="${n1((rx1 + rx2) / 2 + U * 0.012)}" cy="${n1(seatY + U * 0.085)}" rx="${n1(sw * 0.75)}" ry="${n1(U * 0.009)}" fill="#030604" opacity="0.45"/>`);
  }

  // ── 풀 ──
  const blade = (x, y, h) => {
    const lean = (r() - 0.5) * h * 0.9;
    const w = Math.max(0.7, h * 0.075);
    const col = pick(r, ["#1f4123", "#28512a", "#173219", "#2f5f30", "#122a15", "#3a6a36"]);
    return `<path d="M ${n1(x - w)} ${n1(y)} Q ${n1(x + lean * 0.35)} ${n1(y - h * 0.6)} ${n1(x + lean)} ${n1(y - h)} Q ${n1(x + lean * 0.4 + w)} ${n1(y - h * 0.5)} ${n1(x + w)} ${n1(y)} Z" fill="${col}"/>`;
  };
  const grassBack = [];
  const grassFront = [];
  for (let i = 0; i < L.grass; i++) {
    const t = Math.pow(r(), 0.75);
    const y = lerp(gTop - U * 0.02, H * 1.01, t);
    const x = r() * W;
    if (y < groundTopAt(x) + U * 0.004) continue;
    const h = lerp(U * 0.008, U * 0.06, Math.pow(t, 1.5)) * lerp(0.6, 1.3, r());
    // 풀 무더기: 한 자리에 2~5가닥
    const n = 2 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) (y > tby && r() < 0.35 ? grassFront : grassBack).push(blade(x + (r() - 0.5) * h * 0.5, y, h * lerp(0.7, 1.1, r())));
  }
  out.push(`<g>${grassBack.join("")}</g>`);
  out.push(`<g>${frontStones.join("")}</g>`);
  out.push(`<g>${grassFront.join("")}</g>`);

  // ── 마무리: 가장자리 어둡게 + 위쪽(글자 자리) 어둡게 ──
  defs.push(`<radialGradient id="vig" cx="0.5" cy="0.45" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></radialGradient>`);
  out.push(`<rect width="${W}" height="${H}" fill="url(#vig)"/>`);
  defs.push(`<linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04051a" stop-opacity="0.55"/><stop offset="1" stop-color="#04051a" stop-opacity="0"/></linearGradient>`);
  out.push(`<rect width="${W}" height="${n1(H * 0.2)}" fill="url(#top)"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs.join("")}</defs>${out.join("")}</svg>`;
}

// 나무 모양(사진 구도: 넓게 퍼진 우산형 수관, 오른쪽에 줄기, 왼쪽으로 낮게 뻗은 가지에 그네)
const TREE_SHAPE = {
  lobes: [
    { u: 0.62, v: 0.42, ru: 0.3, rv: 0.34 },
    { u: 0.83, v: 0.44, ru: 0.19, rv: 0.32 },
    { u: 0.4, v: 0.47, ru: 0.24, rv: 0.27 },
    { u: 0.2, v: 0.6, ru: 0.19, rv: 0.2 },
    { u: 0.06, v: 0.68, ru: 0.08, rv: 0.12 },
    { u: 0.55, v: 0.18, ru: 0.19, rv: 0.17 },
    { u: 0.76, v: 0.17, ru: 0.15, rv: 0.15 },
    { u: 0.93, v: 0.66, ru: 0.08, rv: 0.2 },
    { u: 0.52, v: 0.76, ru: 0.3, rv: 0.09 },
    { u: 0.3, v: 0.74, ru: 0.12, rv: 0.08 },
  ],
  split: [0.79, 0.86],
  branches: [
    { to: [0.42, 0.45], c: [0.62, 0.62], w0: 0.034, w1: 0.012 },
    { to: [0.58, 0.22], c: [0.7, 0.45], w0: 0.032, w1: 0.01 },
    { to: [0.8, 0.25], c: [0.82, 0.5], w0: 0.028, w1: 0.009 },
    { to: [0.95, 0.6], c: [0.9, 0.75], w0: 0.022, w1: 0.008 },
    { to: [0.12, 0.66], c: [0.45, 0.66], w0: 0.026, w1: 0.008 },
  ],
  swingBranch: { from: [0.78, 0.88], to: [0.32, 0.78], c: [0.55, 0.86] },
};

const portrait = scene(1080, 2340, {
  horizon: 0.505,
  stars: 520,
  milky: { x: 0.45, y: 0.42, rx: 0.9, ry: 0.12, rot: -32 },
  sun: { x: 0.53, r: 0.032 },
  glow: { rx: 0.85, ry: 0.11 },
  ground: { left: 0.655, right: 0.625 },
  lawn: { x: 0.55, y: 0.73, rx: 0.45 },
  small: { x: 0.06, base: 0.69, h: 0.2 },
  log: { x: 0.24 },
  stonesN: 34,
  grass: 900,
  clumps: 520,
  tree: {
    x0: 0.02,
    x1: 1.06,
    y0: 0.255,
    y1: 0.49,
    trunkX: 0.84,
    base: 0.71,
    ...TREE_SHAPE,
    swing: { x1: 0.47, x2: 0.53, top: 0.9, seat: 0.675 },
  },
}, 11);

const landscape = scene(2400, 1350, {
  horizon: 0.55,
  stars: 700,
  milky: { x: 0.4, y: 0.5, rx: 0.7, ry: 0.22, rot: -18 },
  sun: { x: 0.44, r: 0.036 },
  glow: { rx: 0.6, ry: 0.13 },
  ground: { left: 0.72, right: 0.69 },
  lawn: { x: 0.6, y: 0.82, rx: 0.3 },
  small: { x: 0.06, base: 0.765, h: 0.28 },
  log: { x: 0.28 },
  stonesN: 40,
  grass: 1300,
  clumps: 600,
  tree: {
    x0: 0.42,
    x1: 1.02,
    y0: 0.1,
    y1: 0.52,
    trunkX: 0.88,
    base: 0.8,
    ...TREE_SHAPE,
    swing: { x1: 0.47, x2: 0.53, top: 0.9, seat: 0.76 },
  },
}, 23);

// 원본 SVG(무거움, ~1MB)는 design/ 에만 두고, 앱에는 고화질 WebP(~110KB)만 싣는다.
const svgDir = join(root, "design", "generated");
const outDir = join(root, "public", "themes");
mkdirSync(svgDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
const sharp = (await import("sharp")).default;
for (const [name, svg, width] of [
  ["dusk-portrait", portrait, 1080],
  ["dusk-landscape", landscape, 2400],
]) {
  writeFileSync(join(svgDir, `${name}.svg`), svg);
  const info = await sharp(Buffer.from(svg)).resize(width).webp({ quality: 82, effort: 6 }).toFile(join(outDir, `${name}.webp`));
  console.log(`✓ ${name}.webp ${info.width}×${info.height} ${Math.round(info.size / 1024)}KB (SVG ${Math.round(svg.length / 1024)}KB)`);
}
