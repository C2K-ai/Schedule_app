# 책 열림 애니메이션 — 심사 결과 (시안 3개)

두 심사위원 모두 **layered(빛 강조형)** 우승. 아래 graft 목록이 최종 다듬기(polish)의 할 일이다.


## 디자인 심사 — 우승: layered

- **layered**: 아름다움 9 · 요구 일치 9 · 움직임 8 · 폰 9 · 코드 7
  - 문제: The cover title 'DIARY'/'2026' rasterizes jaggy at the 1.3x close-up camera on phone (frames 0–300). It is visibly less crisp than storybook's SVG cover.
  - 문제: t=0 starts under a 50% dark veil, so the very first frame of the closed book is murky and dim, especially on desktop.
  - 문제: The closed book's page edge is a flat grey strip with no gilding. The ribbon hangs out of the bottom-left corner, which looks slightly arbitrary.
  - 문제: Around 560–660 ms the cover is edge-on as a thin dark slab, and at 600 ms the hinge reads as a kink.
  - 문제: The multiply grade tints the pages strongly orange-peach during the light phase. The outermost rays still lean beige/mauve against the purple.
  - 문제: The flying sheet is one plane scaled non-uniformly: ruled lines stretch, it has no curl or peel, and it reads a little like a flat card sliding forward (1800 ms).
  - 문제: End state: on desktop the rules run a full-bleed 1440 px with no max-width column. The sound toggle stays on screen and a demo '다시 보기' pill appears after real playback. No safe-area inset.
  - 문제: Code: module-level globals and getElementById, no factory API. Style writes are not cached, so every element is written every frame. DIARY_DATE is hard-coded instead of passed in. Three full-screen canvases (two screen-blended) plus a multiply layer have not been measured on a real phone.
- **css3d**: 아름다움 7 · 요구 일치 8 · 움직임 7 · 폰 7 · 코드 9
  - 문제: The light is a 2D overlay drawn on top of the 3D scene, so rays streak across the standing cover and the left page. On purple the rays read mauve rather than gold. Desktop rays look thin.
  - 문제: The light and sparkles die as the lift starts (fxOut 1840+). At 1950–2100 the scene is dark with a big skewed homography quad on near-black. This is the least premium moment and loses the golden mood right before the reveal.
  - 문제: The 6-segment leaves show visible vertical faceting/banding in the curl (phone 1200/1500, desktop 1200).
  - 문제: On phone the book sits low, leaving a large empty floor below. On desktop at about 600 ms the standing cover is a translucent purple sliver.
  - 문제: The date text is squashed during the morph, so it only appears late. A stray 1px dash can show on the left during the morph (2250 ms at 1x).
  - 문제: About 660 DOM nodes and 80+ composited layers with will-change. A demo replay pill shows at the end after playback.
- **storybook**: 아름다움 6.5 · 요구 일치 7 · 움직임 7.5 · 폰 6.5 · 코드 8
  - 문제: The golden light is the weakest and least faithful to ref-open: rays are thin and sparse, the burst is not very golden, and it only arrives after the cover lands (about 800–1000 ms).
  - 문제: A leaf standing upright reads as a thin needle/spike in the middle of the spread at 1200 ms on both phone and desktop.
  - 문제: Orange bokeh sprites drawn in front of the lifted page look like stains or blotches on the paper (1800 ms).
  - 문제: During the lift the left page turns into a flat grey-lavender block (desktop 1800/2100), which is a dull, plain frame.
  - 문제: The cover's inner face at 800 ms is a flat dark slab with almost no endpaper detail.
  - 문제: End state: rules run full-bleed edge to edge with no margins. On desktop the header sits in an off-centre column while the lines span 1440 px. The date in regular weight feels plain compared with the others.

### 다른 시안에서 가져올 것(graft)
- From storybook: replace layered's canvas-leather cover title with storybook's size-generated inline SVG cover art (frame, moon mask, DIARY, 2026), so the title is crisp under the 1.3x close-up camera. Keep layered's leather grain as a separate low-opacity layer.
- From storybook: raise LEAF_SEGS from 6 to about 10 and adopt per-strip Gouraud shading via CSS custom properties (--sl/--sr/--wl/--wr). Also add the clamp that keeps the curl above the page blocks. This removes faceting and smooths the line kinks in the riffle.
- From storybook: add the cover and leaf cast shadows onto the pages (castR/castL), and a small free-edge peel on the lifted sheet so it does not read as a flat card.
- From css3d: wrap layered in a createDiaryIntro(root, {reducedMotion, sound, date, targetRect, onDone}) factory returning {play, seek, skip, duration}. Replace the module globals and getElementById with root.querySelector. Pass the date in instead of hard-coding DIARY_DATE (storybook's ?date= fallback works for testing).
- From css3d: use cached style writers (setO/setT/setV) so layered stops rewriting every element's style every frame.
- From css3d: add a targetRect option so the lifted sheet lands on the app's real content area. On desktop, use a centred max-width writing column (about 860–980 px) instead of 1440 px full-bleed rules.
- From css3d: give the closed book a gilded gold-foil fore-edge and near-edge (striped gold gradient) instead of layered's flat grey strip. Keep the ribbon but anchor it nearer the spine.
- From css3d: add the dither noise overlay to kill banding in the dark gradients and in layered's large glow sprites.
- From css3d and storybook: hide the sound toggle in the final frame, or fade it to a tiny ink icon, and never show the demo '다시 보기' pill in the app. Surface the 'diary.introSound' preference in Settings as well.
- From storybook: add the blinking caret on the first rule in the end state, and the 'diaryintro:done' CustomEvent and Esc/Enter/Space keyboard skip.
- From storybook: on the sound side, put a DynamicsCompressor on the master, pan the riffle ticks slightly in stereo, and use a chime-only variant for reduced motion (layered's minimal flag can map to it).
- Layered-specific tuning: lighten the t=0 veil (start at about 0.2 instead of 0.5) so the first frame shows the closed book clearly. Slightly reduce the orange multiply grade on the pages so the paper stays cream-gold rather than peach. Shorten the edge-on cover moment (560–660 ms) by speeding up the ease through 80–100 degrees.

## 엔지니어링(폰 성능) 심사 — 우승: layered

- **layered**: 아름다움 8.5 · 요구 일치 8.5 · 움직임 8 · 폰 7.5 · 코드 7.5
  - 문제: The cover is visibly soft on a phone at 2x, from 0 to 300 ms. The book is built small (W is about 142 px) and CAM.sClosed of 1.3, times a settle factor of 1.04, scales the 3D layer up, so 'DIARY' and the gold frame come out as upscaled raster. My crop showed it clearly blurrier than storybook and somewhat blurrier than css3d.
  - 문제: The t=0 frame is the weakest first impression of the three. The veil is at 0.5 opacity and the sheen has not swept yet, so the cover reads dim and muddy.
  - 문제: From about 560 to 660 ms the cover is seen nearly edge-on and reads as a dark slab.
  - 문제: The multiply grade gives the pages a strong orange-peach cast during the light phase. On desktop the outer rays lean beige or mauve.
  - 문제: The hero sheet is one plane scaled non-uniformly (sx is not equal to sy), so the rules stretch during the flight and the date only appears at the very end. The end page has a heavy inset vignette, and on desktop the ruled lines run full-bleed across 1440 px with no writing column.
  - 문제: Architecture: the code uses module-level globals and document IDs (#stage, #hero, …), so a second instance would break. DIARY_DATE is hard-coded. There are no options for date, targetRect or onDone, every style is rewritten every frame without caching, and the sound's stop() only ramps the gain down while its sources keep running.
  - 문제: It has the heaviest main-thread canvas work: 3 canvases, about 700 sprite draws, 26 rotated ray draws and very large bloom sprites, plus 3 full-screen blend layers (a multiply grade and 2 screen-blended canvases). With CPU throttled 4x it was the slowest, at 22.6 fps against 27–32. Unthrottled it was the fastest on phone, at about 50 fps against 35–38.
- **css3d**: 아름다움 7.5 · 요구 일치 8 · 움직임 7.5 · 폰 7 · 코드 9
  - 문제: Around 550–650 ms the swinging cover reads as a thin translucent purple sliver, and there is no light leak to sell the moment.
  - 문제: The rays, fan and core are a 2D screen-blended overlay drawn on top of the pages and the standing cover. Leaves look washed out and translucent at 1200–1500 ms, and the rays read mauve against the purple background.
  - 문제: With 6 segments per leaf, the shading shows visible vertical faceting and banding on riffling leaves (phone crop at 1200 ms).
  - 문제: All 10×6 leaf segments are in the DOM and composited for the whole run, about 100 layers from t=0. Each has multiply and screen children whose per-frame opacity changes force the face to repaint. Unthrottled phone playback in headless ran at about 35–38 fps, against 50 for layered.
  - 문제: The homography lift turns the sheet into a skewed trapezoid, and around 2100 ms the date and placeholder show squashed and skewed (phone and desktop).
  - 문제: The miniature ruled lines are very dense on phone (8 px), and the cover text is slightly soft because zoomClosed is 1.28, which scales the book up.
- **storybook**: 아름다움 7 · 요구 일치 7 · 움직임 7.5 · 폰 6.5 · 코드 7.5
  - 문제: The golden light is underwhelming next to the reference: the rays are thin and sit behind the book, the pages read cool grey-white, there is no hot core, and the light only starts at 800 ms. It is the weakest 'magical burst' of the three.
  - 문제: From 600 to 800 ms the rising cover turns into a huge dark wedge, and on desktop it is cropped off the top of the viewport.
  - 문제: During the lift (1800–2100 ms) the dimmed left page is a flat grey slab beside the growing sheet. This is most visible on desktop.
  - 문제: At the end state the ruled lines run edge to edge while the header sits in a centred 860 px column on desktop. The caret is a fake blinking div rather than a real editable field.
  - 문제: Bug (confirmed with getComputedStyle): leaves and the left overlay set visibility:'visible' directly, which overrides the stage's visibility:hidden. At 2600 ms the stage is hidden but the leaves are visible, so about 92 drawing layers stay composited under the final sheet.
  - 문제: Per-strip CSS custom properties (--sl, --sr, --wl, --wr) change every frame because the glow flicker feeds into jw. That forces gradient repaints of every visible strip, so the riffle is not transform/opacity only. Up to about 200 layers are present during and after the riffle.
  - 문제: At exactly 90° a leaf shows as a thin spike for one frame. The code is an IIFE tied to document-level IDs and window globals.

### 다른 시안에서 가져올 것(graft)
- From storybook (fixes layered's soft cover on phones): build the 3D book at about the final on-screen page size and keep the CAM scales at 1 or below, so the camera only scales down and the cover text and rules stay crisp at DPR 2–3. Also make the right page's geometry equal the target writing rect, with the page rules mapped to the sheet rules. The hero hand-off then becomes 1:1 with uniform scale and no stretched lines, and the camera can flatten onto the lifted page as storybook does.
- From css3d: wrap everything in createDiaryIntro(root, {reducedMotion, sound, date, targetRect, onDone}) returning {play, seek, skip, duration}. Use scoped root.querySelector instead of document IDs, remove the hard-coded DIARY_DATE, and add cached setT/setO/setV writes so idle nodes aren't restyled every frame.
- From css3d: closed-cover polish on frame 0. Make the sheen visible at t=0 (drop the 0.5 veil in-app, since the route transition already fades in), give the page block a gilded fore-edge, and add a dither overlay so dark radial gradients don't band on 8-bit Android panels.
- From css3d: a targetRect, i.e. the app's content area rather than the full viewport, and a centred desktop writing column (max about 900–980 px) so the rules don't run across 1440 px. Lighten the hero's 12vmin inset vignette so the end page reads as clean paper.
- From storybook: draw the god rays on a back canvas behind the book, so pages and leaves block them, and keep only the gutter core and page glow in front. Reduce the multiply grade's strength on the pages so they read cream-gold rather than orange-peach.
- From storybook: at 560–660 ms, show the cover's outer face with Lambert shading while it swings, plus a cast shadow onto the pages. Combined with layered's existing fore-edge leak glow, this hides the edge-on dark slab (or adjust the camera so the cover is never edge-on for more than about 2 frames).
- From storybook: smoother page curl. Use 8–10 strips per leaf with joint-interpolated shading, but drive the shading with opacity on overlay children rather than per-frame CSS custom properties. Keep layered's 'only visible while flipping' rule.
- From storybook and css3d, for sound and UX: a chime-only variant for reduced motion, stereo-panned riffle ticks, a 'diaryintro:done' event or onDone callback, and skip on Escape or Enter. Hide the toggle at the end state and expose the same 'diary.introSound' localStorage key in the app's Settings, which covers the user's 'let me turn the sound off later' request. Keep layered's setMuted().
- Robustness (avoid storybook's bug): hide the scene with a class or display:none at the stage level, and never set visibility:'visible' on children, so nothing stays composited under the final page. Scale COUNTS (sparks, ambient, rays) by devicePixelRatio and navigator.hardwareConcurrency, keep the half-resolution glow canvas, and stop drawing on the canvases once fadeAll reaches 0.
- From css3d: if the hero's 1px rules break into dashes while it is scaled down, draw them on a canvas during the flight and switch to CSS lines at the end. With storybook's 1:1 geometry this may not be needed.