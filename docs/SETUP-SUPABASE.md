# Supabase 연결 — 기기 간 동기화 + 앱이 꺼져도 오는 푸시

로컬 모드만 쓸 거면 이 문서는 필요 없습니다. 노트북 ↔ 폰 실시간 동기화와 “앱을 닫아도 오는 알림”이 필요할 때 따라 하세요.
전부 무료 플랜으로 됩니다. 처음 한 번 30분 정도.

> 필수 단계와 선택 단계를 나눴습니다. **필수만 해도 동기화 + 서버 푸시가 완성**됩니다.

---

## 필수 1. 프로젝트 만들기

1. https://supabase.com → New project
2. Region: **Northeast Asia (Seoul)** — 알림 지연이 가장 짧음
3. 만들어지면 **Project Settings → API** 에서 두 값을 복사
   - Project URL (`https://<프로젝트ID>.supabase.co`)
   - `anon` public 키 (또는 publishable 키)

## 필수 2. 스키마 적용

**SQL Editor → New query** 에 [`supabase/migrations/20261005000000_init.sql`](../supabase/migrations/20261005000000_init.sql) 내용을 통째로 붙여 넣고 **Run**.
테이블 7개, RLS, 트리거, 함수, Realtime 설정이 한 번에 들어갑니다. (여러 번 실행해도 안전)

> 같은 SQL 을 로컬에서 미리 검증할 수 있습니다: `npm run test:db` (실제 Postgres 로 25개 항목 확인)

## 필수 3. 로그인(이메일 코드) 설정

1. **Authentication → Sign In / Providers → Email** 이 켜져 있는지 확인
2. **Authentication → Emails → Templates → Magic Link** 본문에 코드가 보이게 아래 한 줄을 넣기

   ```html
   <h2>MUST 로그인 코드</h2>
   <p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
   ```

   (iPhone 홈 화면 앱은 메일 링크가 Safari 로 열려 로그인이 안 이어집니다 — 그래서 코드를 씁니다)
3. **Authentication → URL Configuration → Site URL** 에 앱 주소(배포 후 주소, 개발 중이면 `http://localhost:3000`)

## 필수 4. 키 만들기

```bash
npm run vapid
```

출력이 세 덩어리로 나옵니다.
- ① `.env.local` 에 넣을 공개키
- ② Edge Function 비밀값 등록 명령
- ③ SQL Editor 에서 실행할 Vault 두 줄

## 필수 5. 앱 환경변수

`.env.example` 을 `.env.local` 로 복사하고 채우기:

```
NEXT_PUBLIC_SUPABASE_URL=https://<프로젝트ID>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon 키>
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<①의 공개키>
```

`npm run dev` 를 다시 시작하면 설정 → 동기화 탭에 로그인 화면이 나옵니다.

## 필수 6. Edge Function 배포

```bash
npx supabase login
npx supabase link --project-ref <프로젝트ID>
```

```bash
npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=... ACTION_SECRET=...
```
(위 명령은 `npm run vapid` 출력 ②를 그대로 복사)

```bash
npx supabase functions deploy send-due-notifications --no-verify-jwt
```

```bash
npx supabase functions deploy notification-action --no-verify-jwt
```

```bash
npx supabase functions deploy push-test
```

`--no-verify-jwt` 인 두 함수는 크론·잠금화면 버튼이 부르기 때문에 로그인 토큰이 없습니다. 대신 `CRON_SECRET` 헤더와 서명 토큰으로 직접 확인합니다.

## 필수 7. 1분마다 알림 보내기(크론)

1. SQL Editor 에서 `npm run vapid` 출력 ③의 두 줄 실행 (Vault 에 프로젝트 URL·크론 비밀값 저장)
2. [`supabase/migrations/20261005000100_cron.sql`](../supabase/migrations/20261005000100_cron.sql) 내용을 붙여 넣고 Run
   - 매 분: 보낼 알림 발송
   - 매시 5분: 습관 → 오늘·내일 일정 생성(앱을 안 열어도 알림이 가도록)
   - 매일 새벽: 2주 지난 알림 기록 정리

## 필수 8. 확인

1. 앱에서 설정 → 동기화 → 이메일 → 코드로 로그인
2. 설정 → 알림 → **이 기기 등록** → **서버 푸시 테스트** → 알림이 오면 성공
3. 2분 뒤 시작하는 일정을 만들고 **앱(탭)을 닫기** → 정각에 시스템 알림이 오면 서버 푸시까지 완성
4. 폰에서도 같은 이메일로 로그인 → 노트북에서 일정을 끌어 옮기면 폰 화면이 바로 바뀜

---

## 선택 A. 배포 (Vercel — 폰에서 쓰려면 HTTPS 주소가 필요)

1. https://vercel.com → Add New → Project → GitHub 저장소 선택
2. Environment Variables 에 `.env.local` 의 세 값 입력 → Deploy
3. 나온 주소(`https://xxx.vercel.app`)를 Supabase **Authentication → URL Configuration** 의 Site URL 에 넣기

정적 빌드(`out/`)라 Netlify · Cloudflare Pages · GitHub Pages 어디에 올려도 됩니다.

## 선택 B. 더 촘촘한 정각 알림

크론이 1분 단위라 정각 알림은 그 분의 0~수 초 안에 나갑니다. 더 촘촘히 하려면 cron.sql 의 `'* * * * *'` 를 `'20 seconds'` 로 바꿔 다시 실행(pg_cron 1.5+). 앱이 열려 있을 땐 어차피 앱 엔진이 초 단위로 울립니다.

## 문제 해결

| 증상 | 확인할 곳 |
|---|---|
| 서버 푸시가 안 옴 | `select * from notification_jobs order by fire_at desc limit 20;` 의 `sent_at` · `last_error` |
| 크론이 함수를 못 부름 | `select * from cron.job_run_details order by start_time desc limit 10;` · `select * from net._http_response order by created desc limit 10;` |
| 함수 오류 | Dashboard → Edge Functions → send-due-notifications → Logs |
| `no subscriptions` | 그 기기에서 설정 → 알림 → 이 기기 등록을 안 했음 |
| `401 unauthorized` | Vault 의 `must_cron_secret` 과 함수 secrets 의 `CRON_SECRET` 이 다름 |
| 로그인 메일에 코드가 없음 | 필수 3-2 의 템플릿에 `{{ .Token }}` 이 빠짐 |
| 다른 기기에 반영이 늦음 | 설정 → 동기화 상태 → “실시간 연결: 연결됨” 인지. 아니면 “지금 동기화” |
