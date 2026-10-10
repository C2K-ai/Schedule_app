# 폰용 일기 책 영상 다시 만들기

폰에서는 책 애니메이션을 실시간으로 그리지 않고 `public/diary/open.mp4`·`close.mp4`(엔진을 최고 화질로 녹화한 영상)를 튼다.
표지 연도('2026')는 영상에 박혀 있으니 **해가 바뀌거나 엔진 모양을 바꾸면 다시 만든다.** 날짜·안내 글자는 영상에 없다(진짜 일기 종이가 보여 줌).

```bash
cd scripts/diary-video
npm i --no-save esbuild@0.24.0 playwright-core@1.56.1      # 스크래치에 깔아도 됨
npx esbuild entry.ts --bundle --format=iife --target=es2020 --outfile=rec.js
mkdir -p fo fc
# 크로미움 위치: executablePath 는 shoot.cjs 안에서 /opt/pw-browsers/chromium (클라우드 컨테이너 기준)
node shoot.cjs open 0 2330 fo      # 0 ~ OPEN.dissolve[0] (그 뒤 페이드는 앱이 CSS 로)
node shoot.cjs close 80 2340 fc    # CLOSE.fadeIn 뒤 ~ CLOSE.exit[0]
for d in fo fc; do ffmpeg -y -framerate 60 -i $d/f%04d.jpg -vf "crop=1080:2336:0:0,format=yuv420p" \
  -c:v libx264 -preset slow -crf 24 -x264-params aq-mode=3 -profile:v high -level 5.1 -movflags +faststart -an $d.mp4; done
cp fo.mp4 ../../public/diary/open.mp4 && cp fc.mp4 ../../public/diary/close.mp4
```
시간표(`timeline.ts`)의 OPEN.dissolve·CLOSE.exit 를 바꾸면 위 숫자와 `DiaryIntro.tsx` 의 VIDEO 끝 처리도 같이 본다.
