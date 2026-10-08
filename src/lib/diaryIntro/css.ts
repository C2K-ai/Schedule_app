// 연출 스타일 — 모든 선택자가 .di 아래라 앱의 다른 곳에 새지 않는다.
// 움직임은 전부 JS(render) 가 그린다. 여기엔 CSS 애니메이션이 없다.

export const CSS = `
.di {
  --di-bg-0: #1e1752; --di-bg-1: #110d36; --di-bg-2: #06051a;
  --di-cover-hi: #313790; --di-cover: #1c2062; --di-cover-lo: #0e1039; --di-cover-edge: #0b0c2c;
  --di-gold-hi: #fff3cc; --di-gold: #e6c174; --di-gold-mid: #c4963f; --di-gold-lo: #7c581c;
  --di-endpaper: #1a1c55; --di-endpaper-lo: #0f1139;
  /* 일기 종이(globals.css .diary-paper)와 같은 값 — 앱 안에선 그 변수를 그대로 물려받는다 */
  --di-paper-1: var(--paper-1, #fbf6ea); --di-paper-2: var(--paper-2, #f1e5cd);
  --di-ink: var(--ink, #3b2d1f); --di-ink-soft: var(--ink-soft, #a8977c);
  --di-rule: var(--rule, rgba(128, 98, 60, 0.26)); --di-hrule: var(--hrule, rgba(184, 138, 62, 0.75));
  --di-gold-text: var(--gold-text, #b8893c);
  --di-ribbon-hi: #ffb27e; --di-ribbon: #ea8650; --di-ribbon-lo: #9d4722;
  --di-shadow: 6, 4, 22;
  --di-serif: var(--diary-serif, "Cormorant Garamond", "Playfair Display", Didot, "Bodoni 72", "Libre Baskerville", Georgia, "Times New Roman", serif);
  position: absolute; inset: 0; overflow: hidden; contain: strict; isolation: isolate;
  font-family: inherit; line-height: 1.5; text-align: left; color: var(--di-ink);
  -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent;
  user-select: none; -webkit-user-select: none; touch-action: manipulation; cursor: pointer;
}
.di *, .di *::before, .di *::after { box-sizing: border-box; margin: 0; padding: 0; border: 0; }
.di i, .di b { display: block; font-style: normal; }
.di.is-done { cursor: auto; }
.di .is-off { display: none !important; }

.di-stage { position: absolute; inset: 0; overflow: hidden; isolation: isolate; pointer-events: none;
  background:
    radial-gradient(90% 62% at 50% 44%, var(--di-bg-0) 0%, rgba(30, 23, 82, 0) 70%),
    radial-gradient(140% 100% at 50% 40%, var(--di-bg-1) 38%, var(--di-bg-2) 100%); }
/* 빛이 나는 동안 배경을 호박빛으로 — 곱하기 대신 보통 겹침(값싼 투명도만 바뀐다) */
.di-warm { position: absolute; inset: 0; opacity: 0;
  background: radial-gradient(70% 58% at 50% var(--warm-y, 52%), rgba(112, 62, 26, 0.9) 0%, rgba(74, 36, 40, 0.55) 45%, rgba(30, 16, 40, 0) 100%); }
.di-cv { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; display: block; }
.di-cv-front { mix-blend-mode: screen; }
.di-scene { position: absolute; inset: 0; overflow: hidden; }
.di-vignette { position: absolute; inset: 0; background: radial-gradient(125% 92% at 50% 48%, transparent 55%, rgba(3, 2, 14, 0.55) 100%); }
.di-dither { position: absolute; inset: 0; background-image: var(--di-dither); background-size: var(--di-dither-size) var(--di-dither-size); }
.di-front { position: absolute; inset: 0; pointer-events: none; }
.di-veil { position: absolute; inset: 0; background: #0b0920; opacity: 0; }

/* 3D 세계: x → 오른쪽(책등 x=0), y → 앞쪽, z → 책상에서 위로 */
.di-world { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-style: preserve-3d; transform-origin: 0 0; }
.di .w { position: absolute; left: 0; top: 0; transform-origin: 0 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.di .p3 { transform-style: preserve-3d; backface-visibility: visible; -webkit-backface-visibility: visible; }
.di .w > i { position: absolute; inset: 0; }

.di-floor { width: calc(var(--W) * 4.6); height: calc(var(--H) * 3.1);
  background: radial-gradient(closest-side, rgba(96, 84, 190, 0.26), rgba(54, 44, 130, 0.1) 55%, rgba(0, 0, 0, 0) 100%); }
.di-floor-glow { width: calc(var(--W) * 4.2); height: calc(var(--H) * 2.6); opacity: 0;
  background: radial-gradient(closest-side, rgba(255, 196, 112, 0.5), rgba(255, 150, 70, 0.13) 42%, rgba(255, 140, 60, 0) 76%); }
.di-shadow { width: var(--W); height: var(--H); border-radius: 6px; background: rgba(var(--di-shadow), 0.82);
  box-shadow: 0 calc(var(--W) * 0.03) calc(var(--W) * 0.06) calc(var(--W) * 0.015) rgba(var(--di-shadow), 0.66),
              0 calc(var(--W) * 0.08) calc(var(--W) * 0.2) calc(var(--W) * 0.04) rgba(var(--di-shadow), 0.45); }

.di-board { width: var(--W); height: var(--H); border-radius: 2px 5px 5px 2px;
  background: linear-gradient(160deg, var(--di-cover) 0%, var(--di-cover-lo) 100%); }
.di-board-edge { width: var(--W); height: var(--Tb); background: linear-gradient(to bottom, #262a70, var(--di-cover-edge)); }

/* 종이(책 속 페이지·넘어가는 장·들리는 장) — 무늬를 화면 좌표에 맞춰서 끝 장면 종이와 1:1 */
.di-pg { width: var(--PW); height: var(--PH); overflow: hidden; background-color: var(--di-paper-2);
  background-image:
    radial-gradient(130% 90% at 35% 20%, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 60%),
    linear-gradient(175deg, var(--di-paper-1), var(--di-paper-2));
  background-size: var(--vw) var(--vh); background-position: var(--pg-bx) var(--pg-by); background-repeat: no-repeat; }
.di i.pr { position: absolute; right: auto; bottom: auto; left: var(--pg-rx); width: var(--pg-rw); top: var(--pg-rt); height: var(--pg-rh);
  background: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--gap) - 1px), var(--di-rule) calc(var(--gap) - 1px), var(--di-rule) var(--gap)); }
.di i.hr { position: absolute; right: auto; bottom: auto; left: var(--pg-rx); width: var(--pg-rw); top: var(--pg-ht); height: 1.5px;
  background: linear-gradient(to right, var(--di-hrule), rgba(184, 138, 62, 0.35) 70%, rgba(184, 138, 62, 0)); }
.di-pg.l .pr, .di-pg.l .hr { left: 0; width: 100%; }
.di .gut-l { background: linear-gradient(to right, rgba(84, 56, 20, 0.3), rgba(84, 56, 20, 0.07) 7%, rgba(84, 56, 20, 0) 16%); }
.di .gut-r { background: linear-gradient(to left, rgba(84, 56, 20, 0.3), rgba(84, 56, 20, 0.07) 7%, rgba(84, 56, 20, 0) 16%); }
.di .cast { opacity: 0; background: linear-gradient(to right, rgba(var(--di-shadow), 0.7), rgba(var(--di-shadow), 0.25) 40%, rgba(var(--di-shadow), 0) 85%); }
/* 페이지에 비친 빛 — 크림빛이 남게(주황으로 물들지 않게) 흰빛 쪽으로 */
.di .pglow { opacity: 0; background: radial-gradient(118% 100% at var(--gx) 44%, rgba(255, 238, 196, 0.9), rgba(255, 222, 160, 0.46) 38%, rgba(255, 214, 140, 0.14) 72%, rgba(255, 210, 130, 0) 100%); }
.di-pg.r .pglow, .di-pg.lift .pglow { --gx: 0%; }
.di-pg.l .pglow { --gx: 100%; }
.di-liftshadow { width: var(--PW); height: var(--PH); opacity: 0; background: rgba(var(--di-shadow), 0.45);
  box-shadow: 0 0 calc(var(--PW) * 0.07) calc(var(--PW) * 0.02) rgba(var(--di-shadow), 0.4); }

/* 금박을 입힌 책배(페이지 묶음 가장자리) */
.di-pedge { width: var(--PW); height: var(--Tp); overflow: hidden;
  background:
    repeating-linear-gradient(180deg, rgba(110, 72, 18, 0) 0 1.1px, rgba(110, 72, 18, 0.34) 1.1px 1.7px),
    linear-gradient(90deg, #8f6420 0%, #e9c77e 14%, #c9993f 34%, #f8e2a6 56%, #c7973c 78%, #f0d38e 90%, #8c611c 100%); }
.di-pedge::after { content: ""; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(255, 245, 210, 0.42), rgba(0, 0, 0, 0) 32%, rgba(40, 20, 0, 0.32)); }
.di-pedge .lit { opacity: 0; background: linear-gradient(90deg, rgba(255, 236, 190, 0.2), rgba(255, 230, 170, 0.75) 70%, rgba(255, 246, 220, 0.95)); }
.di-rib { background: linear-gradient(90deg, var(--di-ribbon-lo), var(--di-ribbon-hi) 45%, var(--di-ribbon) 70%, var(--di-ribbon-lo)); }
.di .w > i.rib { left: var(--rx); width: var(--rw); right: auto; }
.di-rib-sq { width: var(--rw); height: calc(var(--sq) + 0.6px); filter: brightness(0.92); }
.di-rib-floor { width: var(--rw); height: var(--rl); filter: brightness(0.86);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% calc(100% - var(--rw) * 0.6), 0 100%); }

/* 넘어가는 장: 얇은 띠를 이어 붙인 사슬 — 그늘은 띠마다 두 경사의 투명도(관절 값)로만 */
.di-leaf { width: var(--sw); height: var(--PH); }
.di-strip { position: absolute; left: var(--sw); top: 0; width: var(--sw); height: var(--PH); transform-origin: 0 0; transform-style: preserve-3d; }
.di-sface { position: absolute; left: 0; top: 0; width: calc(var(--sw) + var(--ov)); height: var(--PH); overflow: hidden;
  background: linear-gradient(175deg, var(--di-paper-1), var(--di-paper-2)); }
.di-sface.tip { width: var(--sw); box-shadow: inset -1px 0 0 rgba(150, 120, 80, 0.4); }
.di-sface > i { position: absolute; inset: 0; }
.di-sface > .d0 { opacity: 0; background: linear-gradient(to right, rgb(22, 14, 44), rgba(22, 14, 44, 0)); }
.di-sface > .d1 { opacity: 0; background: linear-gradient(to left, rgb(22, 14, 44), rgba(22, 14, 44, 0)); }
.di-sface > .w0 { opacity: 0; background: linear-gradient(to right, rgb(255, 232, 186), rgba(255, 232, 186, 0)); }
.di-sface > .w1 { opacity: 0; background: linear-gradient(to left, rgb(255, 232, 186), rgba(255, 232, 186, 0)); }

/* 표지(앞·뒤 같은 짜임) */
.di-cover { width: var(--W); height: var(--H); }
.di-cface { width: var(--W); height: var(--H); border-radius: 2px 6px 6px 2px; overflow: hidden; }
.di-cface.di-back { border-radius: 6px 2px 2px 6px; --art-frame: var(--art-frame-b); --art-title: var(--art-title-b); }
.di-cface > i { position: absolute; inset: 0; }
.di-cface > i > b { position: absolute; }
.co-leather {
  background:
    var(--di-leather, none) 0 0 / calc(var(--W) * 0.42) auto,
    radial-gradient(100% 70% at 26% 20%, rgba(120, 132, 255, 0.14), rgba(120, 132, 255, 0) 60%),
    radial-gradient(120% 90% at 82% 100%, rgba(0, 0, 0, 0.32), rgba(0, 0, 0, 0) 60%),
    linear-gradient(155deg, var(--di-cover-hi) 0%, var(--di-cover) 44%, var(--di-cover-lo) 100%); }
.di .co-groove { right: auto; left: calc(var(--W) * 0.048); width: calc(var(--W) * 0.032);
  background: linear-gradient(to right, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.42) 38%, rgba(170, 180, 255, 0.1) 62%, rgba(0, 0, 0, 0)); }
.di .di-back .co-groove { left: auto; right: calc(var(--W) * 0.048);
  background: linear-gradient(to left, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.42) 38%, rgba(170, 180, 255, 0.1) 62%, rgba(0, 0, 0, 0)); }
.co-art { -webkit-mask-image: var(--art-frame), var(--art-title); mask-image: var(--art-frame), var(--art-title);
  -webkit-mask-size: 100% 100%; mask-size: 100% 100%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; }
.co-deboss { background: rgba(2, 2, 16, 0.75); transform: translate(calc(var(--W) * -0.0018), calc(var(--W) * -0.0026)); }
.co-lip { background: rgba(200, 210, 255, 0.16); transform: translate(calc(var(--W) * 0.0016), calc(var(--W) * 0.0026)); }
.co-gold { -webkit-mask-image: var(--art-frame); mask-image: var(--art-frame); -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
  background: linear-gradient(122deg, var(--di-gold-lo) 0%, var(--di-gold-hi) 16%, var(--di-gold) 30%, var(--di-gold-mid) 46%, var(--di-gold-hi) 62%, var(--di-gold) 78%, var(--di-gold-lo) 100%); }
/* 무지개빛 홀로그램 박: 색 띠와 밝기 띠가 글자 마스크 밑을 서로 엇갈려 지나간다 */
.co-holo { overflow: hidden; isolation: isolate;
  -webkit-mask-image: var(--art-title); mask-image: var(--art-title);
  -webkit-mask-size: 100% 100%; mask-size: 100% 100%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; }
.co-holo > b.h1 { left: 0; top: -10%; width: 340%; height: 120%;
  background: linear-gradient(104deg,
    #e9d29c 0%, #fbf3dc 4%, #c3a8ff 9%, #8fd8f2 14%, #d8f5ec 18%, #f5d98f 23%, #f6a9cf 28%, #b9a2ff 33%,
    #86d6ef 38%, #f7f2ff 43%, #e8c27a 48%, #f4a6cd 53%, #bea6ff 58%, #8bd5ee 63%, #f9e6a8 68%, #f0a5cb 73%,
    #b8a5fb 78%, #92dbef 83%, #f8f1de 88%, #e8cb8a 94%, #f6e3b0 100%); }
.co-holo > b.h2 { left: 0; top: -20%; width: 300%; height: 140%; mix-blend-mode: soft-light;
  background: linear-gradient(58deg,
    rgba(26, 12, 56, 1) 0%, rgba(255, 255, 255, 1) 7%, rgba(26, 12, 56, 0.85) 14%, rgba(255, 255, 255, 0.8) 21%,
    rgba(26, 12, 56, 1) 29%, rgba(255, 255, 255, 1) 36%, rgba(26, 12, 56, 0.75) 44%, rgba(255, 255, 255, 0.9) 52%,
    rgba(26, 12, 56, 1) 60%, rgba(255, 255, 255, 1) 68%, rgba(26, 12, 56, 0.85) 76%, rgba(255, 255, 255, 0.95) 84%,
    rgba(26, 12, 56, 1) 92%, rgba(255, 255, 255, 0.85) 100%); }
.co-spec > b { top: -20%; height: 140%; left: 0; width: 34%;
  background: linear-gradient(90deg, rgba(255, 250, 235, 0) 0%, rgba(255, 248, 230, 0.55) 38%, rgba(255, 255, 248, 1) 50%, rgba(255, 248, 230, 0.55) 62%, rgba(255, 250, 235, 0) 100%); }
.co-gloss > b { top: -30%; height: 160%; left: 0; width: 72%;
  background: linear-gradient(90deg, rgba(200, 210, 255, 0) 0%, rgba(200, 210, 255, 0.06) 30%, rgba(220, 225, 255, 0.15) 50%, rgba(200, 210, 255, 0.06) 70%, rgba(200, 210, 255, 0) 100%); }
.co-vig { border-radius: inherit; box-shadow: inset 0 0 calc(var(--W) * 0.05) rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.07); }
.co-shade, .ci-shade { background: #04030f; opacity: 0; }
.di-cin { background: var(--di-cover-lo); border-radius: 6px 2px 2px 6px; }
.di .ci-paper { left: var(--sq); top: var(--sq); bottom: var(--sq); right: 0;
  background:
    radial-gradient(circle at 30% 30%, rgba(236, 199, 119, 0.5) 0 0.8px, transparent 1.4px) 0 0 / calc(var(--W) * 0.05) calc(var(--W) * 0.05),
    radial-gradient(circle at 70% 75%, rgba(236, 199, 119, 0.3) 0 0.6px, transparent 1.1px) 0 0 / calc(var(--W) * 0.036) calc(var(--W) * 0.036),
    linear-gradient(200deg, #2a2a6c, var(--di-endpaper) 50%, var(--di-endpaper-lo)); }
.ci-gut { background: linear-gradient(to left, rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0) 14%); }
.ci-warm { opacity: 0; background: radial-gradient(115% 92% at 100% 46%, rgba(255, 216, 150, 0.7), rgba(255, 186, 110, 0.22) 46%, rgba(255, 170, 90, 0) 82%); }
.di-cedge-n { width: var(--W); height: var(--Tb); background: linear-gradient(to bottom, #2c3078, var(--di-cover-edge)); }
.di-cedge-f { width: var(--Tb); height: var(--H); background: linear-gradient(to right, #2c3078, var(--di-cover-edge)); }
.di-cedge-n .lit, .di-cedge-f .lit { opacity: 0; background: linear-gradient(to right, rgba(255, 200, 130, 0.35), rgba(255, 226, 170, 0.95)); }
/* 책등(뒤집을 때 위로 지나간다) */
.di-spine { width: var(--thick); height: var(--H); border-radius: 3px;
  background: linear-gradient(to right, #0d0f36, var(--di-cover) 30%, #2a2f80 55%, var(--di-cover) 75%, #0d0f36); }
.di-spine > .sp-gold { -webkit-mask-image: var(--art-spine); mask-image: var(--art-spine); -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
  background: linear-gradient(90deg, var(--di-gold-lo), var(--di-gold-hi) 45%, var(--di-gold) 60%, var(--di-gold-lo)); }

/* 끝 장면 종이 — DiarySheet 와 같은 자리·같은 값(.diary-paper·.diary-col·.diary-date·.diary-hrule·.diary-lines) */
.di-sheet, .di-sheet-shadow { position: absolute; left: 0; top: 0; width: 100%; height: 100%; transform-origin: 0 0; visibility: hidden; }
.di-sheet { overflow: hidden; }
.di-sheet-shadow { box-shadow: 0 18px 60px rgba(2, 1, 12, 0.7), 0 4px 14px rgba(2, 1, 12, 0.4); opacity: 0; }
.di-sheet-in { position: absolute; left: 0; top: 0; width: 100%; height: 100%; transform-origin: 0 0; }
.di-paper { position: absolute; inset: 0;
  background:
    radial-gradient(130% 90% at 35% 20%, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 60%),
    linear-gradient(175deg, var(--di-paper-1), var(--di-paper-2)); }
.di-paper::after { content: ""; position: absolute; inset: 0; box-shadow: inset 0 0 12vmin rgba(150, 110, 55, 0.14); }
.di-sheet .di-rules { position: absolute; left: var(--col-x); width: var(--col-w); top: var(--rules-top); height: var(--rules-h);
  background: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--gap) - 1px), var(--di-rule) calc(var(--gap) - 1px), var(--di-rule) var(--gap)); }
.di-sheet .di-hrule { position: absolute; left: var(--col-x); width: var(--col-w); top: var(--hrule-top); height: 1.5px;
  background: linear-gradient(to right, var(--di-hrule), rgba(184, 138, 62, 0.35) 70%, rgba(184, 138, 62, 0)); }
.di-head { position: absolute; left: var(--col-x); width: var(--col-w); top: 0; height: 0; opacity: 0; }
.di-eyebrow { position: absolute; left: 0; top: var(--eb-top); display: flex; align-items: center; gap: 8px; white-space: nowrap;
  font-family: var(--di-serif); font-size: var(--eb-size); line-height: 1.5; letter-spacing: 0.32em; text-transform: uppercase; color: var(--di-gold-text); }
.di-eyebrow svg { display: block; width: 13px; height: 13px; flex: none; }
.di-date { position: absolute; left: 0; top: var(--date-top); white-space: nowrap;
  font-size: var(--date-size); font-weight: 650; line-height: 1.5; letter-spacing: -0.01em; color: var(--di-ink); }
.di-date span { font-weight: 500; color: #8a7558; margin-left: 2px; }
.di-ph { position: absolute; left: var(--col-x); width: var(--col-w); top: var(--ph-top); opacity: 0; white-space: nowrap; overflow: hidden;
  font-size: var(--body-size); line-height: var(--gap); color: var(--di-ink-soft); }
.di-ph > span { opacity: 0.85; }
`;
