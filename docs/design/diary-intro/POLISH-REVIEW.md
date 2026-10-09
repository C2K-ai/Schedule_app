# 책 열림 애니메이션 — 다듬은 판(polish-wip.html) 디자인 심사

2026-10-08 첫 계정 세션의 polish 단계 결과. 대상: `polish-wip.html`(= polish 최종, 77KB). 디자인 심사 점수 **6/10**.
엔지니어링 심사와 고치기(refine) 단계는 사용량 한도로 못 돌았다. `src/lib/diaryIntro/` 엔진을 이 판에서 옮겼다면 아래 문제를 같이 갖고 있을 수 있으니 하나씩 확인할 것.

## 다듬기 담당이 적은 내용

The polished intro is finished. It runs 2.42 s and every must-do is in. I checked it with Playwright frames on phone (390×844 @2x) and desktop (1440×900), plus a script that tests playback, skip, sound, reduced motion and seeking; all passed with no console errors.

**What changed**
- **Cover:** the title is now "DREAM" with "2026" under it. The letters are drawn as vector shapes, so they look the same on every device and stay sharp at DPR 2–3. The year is drawn as text, so it still depends on the device's serif font.
  - **Holographic foil:** two colour layers slide under the lettering. As the sheen sweeps across, the title shifts through champagne, pink, violet, silver and cyan, and the frame and moon stay classic gold.
  - **Sharpness:** the book is built at its final on-screen page size and the camera only ever scales it down.
- **Frame 0:** the dark veil starts at 0.16 instead of 0.5, and the sheen is already on the cover. The closed book now leans slightly (about 7°) and the camera straightens as it opens.
- **Gilded edges and ribbon:** the page edges are striped gold. I raised the closed-book camera angle to 38° so the gold band actually shows between the boards. The ribbon comes out near the spine and has a swallowtail end.
- **Cover swing:** the near-flat moment is now about 640–670 ms (2–3 frames) instead of about 100 ms. The swing passes through vertical faster, the camera starts the swing off-axis, and the inside of the cover and its edges glow warm from the light leaking out.
- **Light:** the god rays, light column and bloom are drawn behind the book, so pages and standing leaves block them. Only the leak at the page edge, the core at the gutter and the page glow sit in front. The gold colour wash now sits behind the book only, so pages read cream-gold rather than peach. A noise overlay removes banding in the dark gradients, and the sparkles, glints and bokeh are kept.
- **Page riffle:** each leaf has 10 strips with smoothly blended shading, and a leaf only exists on screen while it is flipping.
  - **No needle:** leaves bow at mid-flip, so a leaf standing upright never shows as a thin needle.
  - **Matching light:** the flipping leaves now get the same golden light as the pages.
  - **Shadows:** the cover and leaves cast shadows onto the pages.
- **Hand-off to the writing page:** the right page lifts with a small peel at its outer edge while the camera flattens onto it. It then matches the writing sheet pixel for pixel, including the ruled lines. The sheet opens out to the target area without stretching anything. It starts slightly before the camera settles, so there is no pause at the hand-off.
- **End state:**
  - **Layout:** a 900 px centred column on desktop, with a small "DREAM" label and the date "2026년 10월 8일 (목)" built from the `date` option.
  - **Placeholder and caret:** "오늘 하루는 어땠나요?" with a blinking caret on the first rule. On desktop the text box gets focus; on phones it doesn't, so the keyboard doesn't pop up.
  - **Toggle and replay:** the speaker toggle is hidden at the end, and the "다시 보기" button appears only with `?demo=1`.
- **Structure for React:** `createDiaryIntro(root, {reducedMotion, sound, date, targetRect, onDone})` returns `{play, seek, skip, duration, destroy}`.
  - **Scoping:** everything is looked up inside `root` and style writes are skipped when nothing changed.
  - **Sizing:** particle counts scale with screen size, pixel density and CPU cores.
  - **End:** the whole animation layer is set to `display:none`, and a `diaryintro:done` event fires.
- **Controls and sound:**
  - **Skip:** tap, click, Esc, Enter or Space skips.
  - **Seeking:** `window.__seek` and `?t=` give identical frames every time.
  - **Reduced motion:** the system setting or `?rm=1` gives a 420 ms fade with a chime only.
  - **Sound:** generated in the browser, with a compressor on the output, riffle ticks panned right to left, a whoosh as the page lifts and a chime when the date appears. Stop really stops every sound. The toggle saves to `diary.introSound` (default on) and pressing it doesn't skip.

**Checks:** render() costs about 0.6 ms of JavaScript per frame (95th percentile 1.8 ms), and rendered audio peaks at 0.55 with no clipping. I also tested `targetRect` with a 56 px header and a 64 px bottom nav, and the sheet lands correctly between them.

**Remaining weaknesses**
- There are three full-screen canvases plus a gold colour-wash layer, and up to about 40 visible leaf strips mid-riffle. I haven't measured this on a real mid-range Android phone. The page has about 900 DOM nodes, most of them hidden leaf strips.
- A thin sliver of the cover still shows for 2–3 frames around 640–670 ms.
- The hot core at the gutter is a 2D glow drawn over the spread, so up close it reads a little like a lens flare.
- On desktop the end page is a lot of plain cream around the 900 px column.
- Headless Chromium used fallback fonts for the Korean date and the year, so these will look different on real devices.
- Sound was only checked by rendering it offline, not by listening. Autoplay is blocked when opening the file directly; in the app the tap on "일기" allows it.

Files are in `/tmp/claude-0/-home-user-schedule-app/70800e21-0e27-5afe-af20-d3d229b80a9b/scratchpad/intro/final/`:
- intro.html
- frames/_sheet-phone.png
- frames/_sheet-desktop.png
- frames/_reduced.png
- frames/{phone,desktop}-{0,250,500,750,1000,1250,1500,1750,2000,2250,2600}.png
- shoot.js, sheet.py, check.js, snap.js, target.js (helper scripts to rerun the captures and checks)

## 디자인 심사 (점수 6)

### 꼭 고칠 것
- The cover breaks apart when it is edge-on (about 640–680 ms), and the book has no spine. In desktop-660 the vertical cover is a cream bar split into two pieces, with a gap of about 30 px and a sideways shift of about 5 px (x≈580–600, y≈390–420). phone-660 shows a step at the same spot. My extra captures are in /tmp/claude-0/-home-user-schedule-app/70800e21-0e27-5afe-af20-d3d229b80a9b/scratchpad/review/fr/. A dark gap of about 15–20 px also separates the cover's hinge from the page block (desktop-660 x≈590–610, desktop-750 x≈660–678), so the cover looks like a loose floating panel. Fix: add a spine/hinge strip that joins the back board to the cover hinge, make the cover's fore-edge one continuous piece, and colour that edge like the navy board instead of cream.
- On desktop and tablet the swinging cover goes off the top of the screen (about 560–700 ms). desktop-600 crops the cover at y=0, and in desktop-640/660 the edge-on cover runs out of frame. This is the main beat of the swing. Fix: make cameraAt() frame the cover's full swing height during TL.cover, by zooming out a little or moving the framing point down.
- The inside of the cover looks like a perforated sheet or speaker grille. `.ci-paper` uses two regularly repeating radial-gradient dot grids, which show as an even dot matrix in desktop-750 and phone-750/850. Replace it with a real endpaper: a scattered star field from a seeded random pattern (not tiled), a marbled or star-map print, or a cream endpaper with a gold moon.
- The gilded page edge shows moiré. The 1.1/1.7 px stripes in `.di-pedge` alias under the 3D transform into a diagonal crosshatch (phone-0 bottom band, desktop-0/250 at y≈715–745, desktop-500). It reads as a barber-pole pattern, not polished gilt. Fix: remove the stripes under 2 px. Use a smooth metallic gradient with very faint page lines at least 3 px apart, plus a single highlight.
- Mid-flip leaves look like pointed blades or flames. Each one is a tall sliver ending in a needle tip well above the book: desktop-1000 (632,55), desktop-1250 (645,50), desktop-1380 (490,118), phone-850 (500,650), phone-1000 (325,660). The narrow flame-shaped light column right behind them makes the gutter look like a candle. Fix: reduce LEAF_BOW/LEAF_CURL so the top edge always reads as a curved four-sided page, move faster through the 70–110° range, and keep the leaf's height capped at about the spread's height.
- The light column and the core at the gutter look like 2D sprites stuck on the image. The tall, narrow SPR.hot ellipse above the gutter looks like a candle flame or lightsaber (desktop-1000 x≈720, y≈100–350; phone-1500 y≈700–900). The round white orb on the spread (desktop-1000 (715,525), desktop-1500 (720,525)) looks like a lens flare stuck on the paper. ref-open has a broad, soft light column rising from the whole gutter, and the pages glow from inside. Fix: make the column about as wide as the spread, soft and fading upward, and turn the core into a glow along the gutter line instead of a round blob.
- The god rays and background are pale pink-lavender, not gold. With screen blending over violet, the rays come out champagne-pink (phone-1000/1250, desktop-1250/1500). ref-open is saturated amber-gold on near-black. Fix: tint the rays warmer and more saturated (amber into gold), darken the background between the rays toward deep indigo-black so the gold stands out, and keep the multiply wash from turning the background mauve.
- The pages don't share the same lighting, so they look like different papers. Unlit, cool grey-white base pages sit under golden leaves (desktop-1250/1380 left stack x≈265–330, y≈680–760; phone-1250 bottom-left). A grey wedge shows under the lifting page (desktop-1650 x≈655–1115, y≈760–800). At the hand-off the right page turns cool white while the left page stays gold, with a hard seam between them (desktop-1880, phone-1800). Fix: apply the same warm page glow to pageL, the base pages and the page edges, and fade the lifted page's glow and the left page's glow together.
- On desktop the hand-off turns the page into a square card. The clip rectangle interpolates from the portrait page to the landscape screen, so the 'page' passes through a square (desktop-2000 sheet ≈690×715, desktop-2050 ≈865×760) and slides over the left page. It stops reading as paper and looks like a UI modal zooming in. Fix for wide screens: scale the page uniformly at its own aspect ratio, and crossfade the surroundings from the dark scene to the cream background. Alternatively, land the page as the 900 px writing column on a desk tone.
- The ribbon is a stiff orange tube in every frame. It has rounded tube shading, hangs straight down into empty space, and has no shadow. After the lift it still pokes out under the floating writing card (phone-2000 x≈118, y≈1395; desktop-2000/2050 x≈520). Fix: give it flat satin shading, a slight S-curve or twist, and a contact shadow on the floor, then hide it or fade it out from TL.lift onward.
- Mounting the intro inside a React tree renders nothing. `.di` has `contain: strict` and `position: relative`, and the only sizing rule is `body > .di {position: fixed; inset: 0}`. A host nested in an app div therefore gets clientHeight 0 (I tested this: h=0, w=390). Fix: have createDiaryIntro apply fixed/inset sizing to the root itself, or drop size containment.
- The AudioContext is never closed or reused. destroy() stops the voice but keeps the context, and 5 create/destroy cycles made 5 AudioContexts (tested). In an app that mounts the intro every time the diary opens, these pile up. Fix: share one context at module level, or close it in destroy().

### 하면 좋은 것
- Make the holographic title more holographic. It currently reads as a soft pastel gradient sliding left to right (champagne→pink→violet at 0–250 ms, then cyan). Add finer, higher-contrast rainbow banding, a crisp white highlight crossing the letters in sync with the cover sheen, and a thin raised-foil edge highlight. Also draw '2026' as vector paths: it is an SVG <text> inside a mask image, so on Android it falls back to Noto Serif instead of a Didone face.
- The leather texture's cells look like crocodile skin or cobblestones at phone DPR (phone-400 crop). A finer bookcloth weave or softer grain would look more premium for this diary.
- Give the open book the classic open-book silhouette. The pages are currently flat planes meeting at a hard crease. Add gutter curvature (pages rising from the spine in a gull-wing bow) and thicker page blocks on both sides, as in ref-open.
- Clean up the particles. There are too many big four-point star glints, which look like clip art (desktop-1880 about 110 px at (1040,455); desktop-2050 (1190,475)). Cap glint size, halve the count, and favour fine round glitter. Add denser fine dust inside the light column and sparkles on the surface around the book, as in ref-open.
- The rays fan out across about ±60° like a studio-logo sunburst with crisp beams. Narrow the fan, vary the widths and softness more, and add some volumetric haze.
- There is no still moment on the glowing open spread: the lift starts at 1440 ms, before the riffle ends at 1560 ms. Holding about 200–300 ms on the fully lit spread would make it feel like a reveal rather than a pass-through.
- The ruled lines across the spread are about 9 px out of line at the hand-off (desktop-1880: left page rows at y=160, 197… and right page at 151, 189…). Real notebooks line up across the spread.
- The front glow and spark canvases draw on top of the writing sheet during 1880–2380 ms, leaving a warm smear at its left edge (phone-2000 x≈40–120, y≈700–900). Clip the effects to the area outside the sheet, or fade them out faster once the sheet appears.
- End state:
- **Desktop:** there's a lot of flat cream around the 900 px column. Add a paper edge with a soft shadow or a desk tone around it, plus slightly stronger grain.
- **DREAM label:** draw it from the same vector glyphs as the cover; it is currently a fallback bold Times.
- **Caret:** it touches the first placeholder glyph, so add a 2–3 px gap, and consider gold rather than orange to match the label.
- Reduced motion fades from near-black #06051a to cream, passing through a muddy grey (reduced-phone-200), with the sound toggle visible. Fade from the app's own background or the cream instead, and hide the toggle when only a short chime plays.
- The intro opens with a hard cut from the app UI to a dark screen. A 120–180 ms crossfade or scale-in from the tapped '일기' element would make the entrance feel intentional.
- Performance is untested on real phones. Each frame draws three full-screen canvases (two with mix-blend-mode: screen), a multiply wash layer and about 900 DOM nodes in 3D, plus 26 full-height ray sprites on a 1.5x canvas. Add adaptive quality: if the first 10 frames take over 20 ms each, cut rays, particles and canvas scale. Then test on a mid-range Android.
- iOS will probably play no sound. The AudioContext is created inside play(); if the app calls play() from an effect after navigation, iOS Safari keeps the context suspended. Expose an unlockAudio() or primeAudio() that the '일기' tap handler calls synchronously, or accept a shared AudioContext.
- Accessibility: the demo root has role="img", which hides the end-state textarea from screen readers if the app copies that markup. Put aria-hidden on .di-stage instead and keep the sheet and textarea accessible. aria-live on the whole sheet is also noisy.
