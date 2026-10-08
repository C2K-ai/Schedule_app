# Diary engine — exact UI API (from the core builder)

IMPORTS
- `import { diaryOn, diaryList, diaryLockedCount, diaryAfterLogin, weakPassword, type DiarySnap, type DiaryEntry, type DiaryState, type DiaryMode, type UnlockResult, type SaveResult } from "@/lib/diary"`
- `diaryAfterLogin` also lives in "@/lib/diaryKeys"; `weakPassword` also in "@/lib/diaryCrypto". For pre-generated editor ids use `uuid()` from "@/lib/time".

PlannerProvider boot
- `new PlannerStore(userId ?? "local", userId, userId ? getSupabase() : null, userId ? "cloud" : cloudEnabled ? "off" : "device")`
- Signature: `(scope, userId, remote, diaryMode: "cloud"|"device"|"off" = "off", diaryStorage?)`. Without the 4th argument the diary is "off".
- The store wires everything else: start, dispose, online, visibility, realtime, flush, pull.
- Do nothing for the diary on SIGNED_OUT.

AuthForm
- After a successful signInWithPassword (login and post-signup): `if (data.user) void diaryAfterLogin(sb, data.user.id, password)`.
- Returns `Promise<UnlockResult|null>` and never throws.

SNAPSHOT: `snap.diary: DiarySnap` (from the store's useSyncExternalStore snapshot; `store.diary.snapshot()` is the same thing, synchronously)
- `DiarySnap = { mode: "cloud"|"device"|"off"; state: DiaryState; entries: Record<string, DiaryEntry>; pending: number; error: string|null }`
- `entries` includes tombstones. Use `diaryOn(snap.diary, day)` (live, sorted by created_at) and `diaryList(snap.diary)` (live, newest day first). `diaryLockedCount(snap.diary)` gives N for the 새로 시작 copy.
- `DiaryState = {kind:"off"} | {kind:"unsupported"} | {kind:"loading"} | {kind:"ready"; weak: boolean; repair: null|"rewrap"|"publish"} | {kind:"locked"; why: "first_time"|"need_password"|"key_changed"|"old_password"}`
- `DiaryEntry = { id; day; body; mood: number|null (1-5); created_at; updated_at; deleted_at: string|null; locked: boolean; dirty: boolean; err: string|null }`
- Entry status: dirty && !err → 올리는 중; err → 못 올림 — {err}; !dirty → 저장됨. 입력 중… is the UI's own draft state.
- A key row exists iff `state.kind === "locked" && state.why !== "first_time"`, or `state.kind === "ready" && state.repair !== "publish"`.

METHODS on `store.diary`
- `save({ id?, day, body?, mood?, base?: { body } }): { ok: true; id } | { ok: false; error: "locked"|"too_long" }`
  - Synchronous.
  - Only works when state is ready and the entry is not locked.
  - A caller-supplied id that doesn't exist creates that entry. Pre-generate it with `useState(() => uuid())`.
  - Mood buttons: `save({ id, day, mood })`.
  - Textarea: `save({ id, day, body: draft, base: baseRef.current })`. `base` = the body the editor saw at its first keystroke (either keep it fixed, or update it to the saved draft after each save — both work).
  - The returned `id` can differ from the input id. That happens when the entry changed under the draft (another device or tab) or was deleted remotely: the draft went into a copy or new entry. The editor should keep using the returned id, but repeated saves with the original id are also redirected to the same copy.
  - Returns ok without writing when nothing changed, or when it would create an empty new entry.
  - `too_long`: keep the draft and show 너무 길어요. Also put `maxLength=20000` on the textarea.
- `remove(id): boolean` — only for live, unlocked entries while ready. Saves to that id within 5 s are ignored. After a delete, give the 'new' editor a fresh uuid.
- `unlock(pw, { oldPassword? }): Promise<UnlockResult>` (`"ok"|"wrong_password"|"old_password"|"old_wrong"|"network"`). Use it for first_time ([일기 켜기]), need_password and key_changed ([열기]), repair rewrap/publish ([비밀번호 넣기]), and the two-field old_password card (`unlock(current, { oldPassword: previous })`). It resolves after keys are synced and locked entries are reopened.
- `reset(pw): Promise<UnlockResult>` — 새로 시작. Only after the typed confirmation '새로 시작'.
- `changePassword(pw, () => sb.auth.updateUser({ password: pw })): Promise<{ error: unknown }>` — for PasswordSection and the 비밀번호가 기억 안 나요 inline form. The error is updateUser's. The key re-wrap runs in the background.
- `refresh(): Promise<void>` — call on sheet open when state is not ready.
- `flushSoon(): void` — on editor blur, sheet close.
- `flush()` / `pull()` return promises.
- `wipe(): Promise<boolean>` — logout with '이 기기에서 일기도 지우기'. false means unsent entries remain: show the error and don't sign out. true means wiped: then call signOut().
- `snapshot(): DiarySnap`.
- `start`, `dispose`, `onOnline`, `onVisible` and `attachRealtime(ch)` are called by PlannerStore; the UI never calls them.
- Strings shown in the UI: `snap.diary.error` (일기 올리기 실패: … / 일기 받기 실패: … / 이 기기에 일기를 저장하지 못했어요 …); `weakPassword(pw)` for the signup / password nudge.
- The diary is never in `snap.db`, TABLES or exportJson.

## Builder deviations from spec (already implemented)
- Storage: DiaryStorage gained updateKeyring(uid, fn), an atomic read-modify-write in one IDB transaction, plus an optional `scope`. The spec's get-then-put let concurrent tabs overwrite each other's keys; Chromium reproduced this as data loss in device mode. saveRing (which merges and never drops a key), the pending updates and the boot-time device key / unconfirmed-pending handling now all go through updateKeyring.
- Broadcast: the helper is announce(chan, msg) with channelName(uid, storage), not announce(uid, msg). The real channel is still 'must-diary:'+uid; the extra suffix is used only for memory storage, so separate test 'devices' don't hear each other.
- Pending has an extra field `weak` (weakPassword at prepare time), which commitPending needs.
- diaryKeys.changePassword returns {error, next}. `next` is the follow-up (commitPending or afterPasswordSet). The engine runs it in the background under its key lock, and engine.changePassword still returns {error} as specced. This keeps the UI fast and avoids races with other key operations.
- unlockWithPassword checks 'held row.kid' before the oldPassword path, so a held key never returns old_wrong. If the mergePatch CAS fails on the network, the device still unlocks locally and the merge happens at the next checkServerKey. The viaOld rotation returns 'network' when offline.
- resetKey falls back to a plain unlock when the row's kid is held or when the password actually opens the row; otherwise a typed password that already works would needlessly create a new key.
- Fork reuse: the spec's condition (copy body === base) would fork a new copy on every autosave. Instead, a change is treated as a conflict only if cur.body differs from both base.body and this engine's own last write (mine[id]), and the copy is reused when its body equals what this engine last wrote into it or equals base.body. This works whether the editor keeps the first-keystroke base or updates base after each save. The same forkOf redirect is used for saves on entries that were deleted remotely (a new entry is made; deleted text is never revived).
- A save to an id this engine removed less than 5 s earlier is ignored and returns {ok:true, id}, so a late unmount/blur save doesn't bring the entry back. After 5 s such a save goes to a new entry. Saves that change nothing, and empty brand-new entries (body '' and mood null), are no-ops.
- flush()/pull() return the in-flight promise and schedule one more pass, instead of skipping, so `await flush()` is deterministic. One flush call loops up to 10 rounds for conflict follow-ups (copies, rebases, batches over 50) and never retries a row that already failed in the same call.
- Extra behaviour: after unlock returns old_password, the engine keeps the verified password in memory only and retries once (re-verifying via signInWithPassword) when the server key row's rev changes. This is what makes the copy '여기서도 자동으로 열려요' true. It is cleared on ok, wrong_password or dispose.
- State details: with no key and no server check done yet the state is `loading`, not need_password (avoids a flicker). When a 'keys' broadcast changes the ring, the known row is reset to unknown before re-checking (avoids a brief 'publish'). Device mode persists rows with dirty:false, so pending counts only unsaved local edits.
- store.ts: an optional 5th constructor parameter `diaryStorage?: DiaryStorage` lets tests inject memory storage; the default is idbDiaryStorage(). scheduleFlush now calls flushOutbox only, so planner edits don't defeat the diary's 5 s upload throttle. onVisible keeps the old 20 s pull guard when visible and calls diary.onVisible(); when hidden it calls diary.flushSoon().
- The engine also has snapshot() (synchronous current DiarySnap) and settle() (test helper that waits for queued work). New selector diaryLockedCount(d). diary.ts re-exports diaryAfterLogin and weakPassword.
- diaryAfterLogin(sb, uid, pw, deps?) takes an optional deps {storage, remote} for tests and returns Promise<UnlockResult|null>.
- Test harness: tests/hooks.mjs also has a load hook that falls back to stripTypeScriptTypes transform mode only for non-diary .ts files, because store.ts uses constructor parameter properties. diary*.ts must still strip natively, and diary-crypto.test.mjs asserts that. Node prints a one-time MODULE_TYPELESS / ExperimentalWarning; it is harmless.
- Test 14: even a superuser cannot set iterations=1000 because of the CHECK constraint, so the test drops diary_keys_iterations_check, tampers, and re-adds it in `finally`. Test 15: the guard trigger blocks day changes even for a superuser, so the test uses session_replication_role=replica and bumps ver and synced_at by hand.
- schema.test.mjs: signups are closed by the time the diary block runs, so a new user can't be inserted. The cascade check uses the existing user D (dddddddd-…-0004, unused afterwards) instead of a fresh one; A is not touched.
- pgliteRemote has more than failNext/afterCommitThrow: fail(method, kind, {times, when}) for persistent per-id faults, setOffline, clearFaults, a calls/count spy, and keyRow/entries/sql superuser helpers. Its pushEntry rejects any column outside the 7 allowed (PostgREST-like), so extra payload fields would fail loudly.
- Repo note: someone else created WIP commit 5f51055 ('작업 중: 일기 암호화 코어…') during this task, containing an earlier snapshot of these files. I did not commit. My later changes are uncommitted: package.json, diary.ts, diaryKeys.ts, diaryStorage.ts, schema.test.mjs, diary-sync.test.mjs.