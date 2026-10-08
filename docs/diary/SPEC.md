# DREAM 일기: final implementation spec (v2)

This spec merges the three reviews into one design that can be built in one pass. I checked the reviewers' claims against the code and tested the migration and crypto parts. Two things in the design itself changed:
- **Entries:** a random id per entry, so a day can have several entries. Conflicts are caught by a `base_ver` check on the server, and when two devices clash, both texts are kept as separate entries. Timestamp last-write-wins is no longer used for the diary.
- **Storage:** the diary lives in IndexedDB, encrypted at rest. Plaintext exists only in memory. The diary has its own sync path, separate from `TABLES` and the localStorage outbox.

Ready-to-copy files, all tested:
- `/tmp/claude-0/-home-user-schedule-app/70800e21-0e27-5afe-af20-d3d229b80a9b/scratchpad/20261011000000_diary.sql` is the migration. It was run twice on PGlite.
- `/tmp/claude-0/-home-user-schedule-app/70800e21-0e27-5afe-af20-d3d229b80a9b/scratchpad/diarytest.mjs` holds 27 PGlite assertions. All pass.
- `/tmp/claude-0/-home-user-schedule-app/70800e21-0e27-5afe-af20-d3d229b80a9b/scratchpad/tt/diaryCrypto.ts` is the crypto module.
- `.../scratchpad/tt/c.test.mjs`, `register.mjs` and `hooks.mjs` run the crypto test under Node 22.22 with built-in type stripping. It passes.
  - Measured sizes: the shortest entry and any entry under 512 bytes seal to exactly 747 characters. 20,000 Korean characters seal to 87,446 characters. A wrapped key is 81 characters. PBKDF2 with 600k iterations takes 94 ms in Node.

The working tree has someone else's uncommitted edits: `Sheet` already includes `"diary"` and `"write"`, there is a new `WriteAdd.tsx`, and Header and Shell have changes. Merge with these; don't overwrite them.

---

## 0. Threat model and honest limits

**Goal.** Diary text and mood must be unreadable to anyone with database, dashboard, backup, SQL or MCP access, including the operator and Claude. There is no extra diary password.

**Limits.** Show these in the docs; the lock line in the UI states them in short form.
1. **Offline guessing.** Both `diary_keys.wrapped` (PBKDF2 at 600k iterations, about 15k guesses/s per GPU) and `auth.users` bcrypt allow offline guessing of the login password. The diary is only as strong as the login password. Mitigations:
   - New passwords need at least 8 characters.
   - The diary shows a nudge when the password is weak (under 10 characters, or only one character type).
   - The UI copy is honest about this.
2. **Password in transit.** The login password goes to Supabase Auth and, at signup, to the `signup` Edge Function. Whoever deploys the JS or the functions could steal it. This is inherent to E2E encryption in a web app.
3. **Metadata stays visible.** The server sees which days have entries, entry counts, timestamps, and size rounded up to a power of two (at least 512 bytes).
4. **The device is trusted.** Anyone who can use the unlocked browser profile can read the diary. On a shared PC, use the wipe option at logout.

Lock line (diary sheet footer):
> 🔒 이 기기에서 잠근 뒤 올려요. 서버·운영자는 내용을 볼 수 없고, 로그인 비밀번호로만 열려요.

---

## 1. Files

**New**
- `supabase/migrations/20261011000000_diary.sql`
- `src/lib/diaryCrypto.ts` (pure, no imports)
- `src/lib/diaryStorage.ts`
- `src/lib/diaryRemote.ts`
- `src/lib/diaryKeys.ts`
- `src/lib/diary.ts` (DiaryEngine, types, selectors)
- `src/components/DiarySheet.tsx`
- `tests/register.mjs`, `tests/hooks.mjs`, `tests/pgliteRemote.mjs`, `tests/diary-crypto.test.mjs`, `tests/diary-sync.test.mjs`

**Changed**
- `src/lib/store.ts`
- `src/components/PlannerProvider.tsx`, `Shell.tsx`, `AuthForm.tsx`, `SettingsSheet.tsx`, `AdminSheet.tsx`
- `supabase/functions/signup/logic.ts` and `logic.test.ts`
- `supabase/tests/schema.test.mjs`
- `package.json`

**Constraint.** All `src/lib/diary*.ts` files must be strippable by Node's type stripping:
- No parameter properties, enums or namespaces.
- Only relative, extensionless imports between themselves and `./time`.
- `import type` for supabase-js.
- No `@/` alias.

---

## 2. Migration: `20261011000000_diary.sql`

Copy the tested scratch file verbatim. Key points:

```sql
create table if not exists public.diary_entries (
  id uuid primary key,                                   -- client random UUID, no default
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  sealed text not null,
  ver int not null default 1,                            -- server-maintained version
  base_ver int,                                          -- write-only "the version I edited"
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, synced_at timestamptz not null default now(),
  constraint diary_entries_sealed_shape check (
    sealed ~ '^v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$'
    and char_length(sealed) between 740 and 100000));    -- PG regex {n} max 255, so length is a separate check
-- indexes (user_id, synced_at), (user_id, day). NO unique(user_id, day).

create or replace function public.diary_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.base_ver is distinct from old.ver or new.day is distinct from old.day then
      return null;                                       -- conflict: silently skipped, RETURNING is empty
    end if;
    new.user_id := old.user_id; new.created_at := old.created_at;
    new.ver := old.ver + 1; new.base_ver := null;
  else
    new.ver := 1;   -- do NOT clear base_ver here: EXCLUDED carries BEFORE INSERT changes into DO UPDATE
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;
-- revoke on the function; create or replace trigger diary_entries_guard before insert or update
-- RLS "own diary entries" for all to authenticated using/with check user_id = auth.uid()
-- revoke all from anon, authenticated; grant select, insert, update to authenticated  (no delete)

create table if not exists public.diary_keys (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  kid text not null check (kid ~ '^[A-Za-z0-9_-]{22}$'),
  salt text not null check (salt ~ '^[A-Za-z0-9_-]{22}$'),
  iterations int not null check (iterations between 600000 and 5000000),
  wrapped text not null check (wrapped ~ '^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$'),
  ring jsonb not null default '[]' check (jsonb_typeof(ring)='array' and jsonb_array_length(ring) <= 100),
  needs_rewrap boolean not null default false,
  rev int not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
-- diary_keys_guard: on UPDATE keep user_id/created_at, rev := old.rev + 1; on INSERT rev := 1; updated_at := clock_timestamp()
-- RLS "own diary key"; revoke all from anon, authenticated; grant select, insert, update (no delete)
-- add diary_entries and diary_keys to the supabase_realtime publication (idempotent DO block)
```

Verified in PGlite (`diarytest.mjs`):
- A stale or null `base_ver` on an existing id is skipped and `RETURNING` comes back empty.
- A matching `base_ver` increments `ver` and stores `base_ver` as null.
- A day change is skipped.
- An old-build stub without `sealed` on an existing id fails with a NOT NULL error.
- Plaintext, too-short and too-long values are rejected by the CHECK.
- The table has no body or mood columns.
- RLS isolates users, owners can't be changed, hard delete is denied, and anon is denied.
- The key insert-ignore and the CAS on `rev` both work, and `rev` and `user_id` are controlled by the server.
- The realtime publication includes both tables, and deleting a user cascades to both.

---

## 3. Crypto: `src/lib/diaryCrypto.ts`

Use the scratch file as is, with one change: `supported()` should test only `crypto?.subtle`, because IndexedDB failures are reported by the storage layer.

| Item | Value |
|---|---|
| DEK | AES-GCM-256, `generateKey(extractable=true)` |
| `kid`, `salt` | 16 random bytes, base64url (22 characters) |
| KEK | PBKDF2-SHA256 over `password.normalize("NFC")`. `ITERATIONS=600000`. `deriveKek` throws `WrongKey` if iterations fall outside [600000, 5000000], which blocks a downgrade. |
| Wrap | `<iv16>.<ct64>`, AAD `DREAM-diary-wrap-v1\|uid\|kid\|salt\|iterations` (parameters are authenticated) |
| Ring entry | `{kid, w}`, the old DEK wrapped under the current DEK, AAD `DREAM-diary-ring-v1\|uid\|kid\|currentKid` |
| Entry | `v1.<kid>.<iv>.<ct>`, AAD `DREAM-diary-entry-v1\|uid\|id\|day\|kid` |
| Plaintext | `{"b":body,"m":0..5,"p":"<spaces>"}`. UTF-8 is padded to 512, 1K, … 64K. Mood is one digit. `TooLong` above 65,536 bytes. The textarea also gets `maxLength=20000`. |
| `open()` | Picks the key by the envelope's kid. Any problem throws `WrongKey`, and the caller turns it into a locked entry. |
| `weakPassword(pw)` | `pw.length < 10` or fewer than 2 of the classes [a-z], [A-Z], [0-9], other |

---

## 4. Storage: `src/lib/diaryStorage.ts`

```ts
export interface StoredRow { id; day; sealed; created_at; updated_at; deleted_at: string|null;
  ver: number|null;        // server version this content is based on (base_ver when dirty); null = never on server
  synced_at: string|null; dirty: boolean; err?: string|null; tries?: number }
export interface Pending { fromKid; kid; dek: CryptoKey; salt; iterations; wrapped; confirmed: boolean }
export interface Keyring { current: string|null; keys: Record<string, CryptoKey>; weak: boolean; pending: Pending|null }
export interface DiaryStorage {
  getKeyring(uid): Promise<Keyring|null>; putKeyring(uid, k): Promise<void>;
  rows(uid): Promise<StoredRow[]>; getRow(uid, id): Promise<StoredRow|null>;
  /** one readwrite transaction; fn MUST be synchronous (do crypto before); null = no change; returns the resulting row */
  updateRow(uid, id, fn: (cur: StoredRow|null) => StoredRow|null): Promise<StoredRow|null>;
  getMeta(uid, name): Promise<string|null>; putMeta(uid, name, v): Promise<void>;
  wipe(uid): Promise<void>;
}
export function idbDiaryStorage(): DiaryStorage   // DB "must-diary" v1: stores "keys" (key=uid), "rows" (keyPath ["uid","id"], index "by_uid"), "meta" (key=`${uid}:${name}`); CryptoKey is structured-cloned
export function memoryDiaryStorage(): DiaryStorage // Map-based, same semantics (tests)
```

If opening IndexedDB throws (Firefox private mode, storage blocked), the engine state is `unsupported`.

---

## 5. Remote: `src/lib/diaryRemote.ts`

```ts
export interface KeyRow { kid; salt; iterations: number; wrapped; ring: {kid: string; w: string}[]; needs_rewrap: boolean; rev: number }
export interface ServerEntry { id; day; sealed; ver: number; created_at; updated_at; deleted_at: string|null; synced_at }
export class NetworkError extends Error {}
export interface DiaryRemote {
  verifyPassword(pw): Promise<"ok"|"wrong">;                    // throws NetworkError
  getKeyRow(): Promise<KeyRow|null>;
  insertKeyRow(r: {kid,salt,iterations,wrapped,ring}): Promise<boolean>;  // false = row already exists
  casKeyRow(rev: number, patch: Partial<Omit<KeyRow,"rev">>): Promise<KeyRow|null>; // null = rev changed
  setNeedsRewrap(): Promise<void>;
  pushEntry(r: {id,day,sealed,created_at,updated_at,deleted_at,base_ver: number|null}): Promise<{ver,synced_at}|null>; // null = skipped by guard
  getEntry(id): Promise<ServerEntry|null>;
  pullEntries(after: string|null, limit: number): Promise<ServerEntry[]>;
}
export function supabaseDiaryRemote(sb: SupabaseClient, uid: string): DiaryRemote
```

How each method maps to Supabase. A supabase-js error whose message matches `/fetch|network|Failed|timeout/i` (the same regex `store.ts` uses) is thrown as `NetworkError`.

| Method | Supabase call |
|---|---|
| `verifyPassword` | Read the email from `(await sb.auth.getSession()).data.session.user.email`, then `sb.auth.signInWithPassword({email, password})`. An `invalid login credentials` error returns `"wrong"`. Side effect: this creates an extra session for the same uid. `boot()` ignores it because the uid is unchanged. |
| `getKeyRow` | `from('diary_keys').select('kid,salt,iterations,wrapped,ring,needs_rewrap,rev').maybeSingle()` |
| `insertKeyRow` | `.upsert(r, {onConflict:'user_id', ignoreDuplicates:true}).select('rev')`. Returns `data.length === 1`. |
| `casKeyRow` | `.update(patch).eq('user_id',uid).eq('rev',rev).select(cols)`. Returns `data[0] ?? null`. |
| `setNeedsRewrap` | `.update({needs_rewrap:true}).eq('user_id',uid)` |
| `pushEntry` | `from('diary_entries').upsert(r, {onConflict:'id'}).select('ver,synced_at')`. Returns `data[0] ?? null`. |
| `getEntry` | `.select(cols).eq('id',id).maybeSingle()` |
| `pullEntries` | `.select(cols).order('synced_at').limit(n)`, plus `.gt('synced_at', after)` when `after` is set |

---

## 6. Key lifecycle: `src/lib/diaryKeys.ts`

```ts
type Ctx = { uid: string; storage: DiaryStorage; remote: DiaryRemote };
export type UnlockResult = "ok" | "wrong_password" | "old_password" | "old_wrong" | "network";
```

**Helpers**
- `announce(uid, msg)` creates a `BroadcastChannel("must-diary:"+uid)`, posts `msg`, then closes it. Messages are `{t:"keys"}`, `{t:"rows",ids}` or `{t:"wipe"}`. They carry no plaintext. The same document receives them through the engine's own channel instance (verified in Node).
- `saveRing(ctx, ring)` calls `putKeyring` and then `announce({t:"keys"})`.
- `openRing(uid, row, dek)` returns `{[row.kid]: dek}` plus every `row.ring` entry it can unwrap with `dek`. Entries that fail are skipped.
- `rotation(uid, all, pw)` generates a new kid, DEK and salt. It wraps the new DEK under `deriveKek(pw, salt, ITERATIONS)` and wraps every other key in `all` under the new DEK. It returns `{kid, dek, patch: {kid, salt, iterations: ITERATIONS, wrapped, ring, needs_rewrap: false}}`.
  - It always uses the client's constant parameters and a fresh salt. It never reuses `row.salt` or `row.iterations`.
- `mergePatch(uid, row, rowDek, keys)`: if `keys` contains kids that are neither `row.kid` nor in `row.ring`, it returns `{ring: row.ring ∪ wrap(missing under rowDek)}`. Otherwise it returns null.

### `unlockWithPassword(ctx, pw, {verified, oldPassword?})`

```
if !verified: r = verifyPassword(pw) → "wrong" ⇒ return "wrong_password"; NetworkError ⇒ "network"
repeat up to 3 (on CAS/insert race):
  row = getKeyRow()  (NetworkError ⇒ "network");  ring = loadRing()
  if row == null:
     (kid, dek) = ring.current && ring.keys[ring.current] ? (ring.current, that key)   // re-publish this device's key
                                                            : (newKid(), generateDek())
     build wrap with fresh salt; ring entries = other held keys under dek
     if !insertKeyRow(...) continue          // another device created it first → loop and unwrap theirs
     saveRing({current: kid, keys: {...ring.keys, [kid]: dek}, weak: weakPassword(pw), pending: null}); return "ok"
  dek = tryUnwrap(row, pw)                   // deriveKek throws WrongKey for bad params, counted as failure
  viaOld = false
  if !dek && oldPassword: dek = tryUnwrap(row, oldPassword); viaOld = !!dek; if !dek return "old_wrong"
  if dek:
     keys = {...ring.keys, ...openRing(row, dek)}
     if viaOld:  {kid,dek2,patch} = rotation(keys, pw)          // move the wrap onto the current password
     else:       patch = mergePatch(row, dek, keys) ∪ (row.needs_rewrap ? {needs_rewrap:false} : {})
     if patch: res = casKeyRow(row.rev, patch); if !res continue
     saveRing({current: viaOld ? kid : row.kid, keys: viaOld ? {...keys,[kid]:dek2} : keys, weak: weakPassword(pw), pending: ring.pending}); return "ok"
  if ring.keys[row.kid]:                     // we hold the server's current key, so the password changed elsewhere
     all = {...ring.keys, ...openRing(row, ring.keys[row.kid])}
     {kid, dek2, patch} = rotation(all, pw); if !casKeyRow(row.rev, patch) continue
     saveRing({current: kid, keys: {...all, [kid]: dek2}, weak: weakPassword(pw), pending: null}); return "ok"
  return "old_password"
return "network"
```

The only path that writes a wrap without the password having just been verified is `oldPassword`. That path first requires a successful unwrap, and the current password is verified at the start of the call. This prevents a typo from being saved as the wrap.

### `changePassword(ctx, newPw, update: () => Promise<{error}>)`

`PasswordSection` uses this for both a normal change and recovery.

```
prepared = false
try { row = getKeyRow(); ring = loadRing()
      if row && ring.keys[row.kid]:
        all = {...ring.keys, ...openRing(row, ring.keys[row.kid])}
        {kid, dek, patch} = rotation(all, newPw)
        putKeyring({...ring, pending: {fromKid: row.kid, kid, dek, salt: patch.salt, iterations, wrapped: patch.wrapped, confirmed: false}})
        prepared = true } catch {}
res = await update()
if res.error: if prepared clear pending; return res
if prepared: set pending.confirmed = true; void commitPending(ctx)
else void afterPasswordSet(ctx, newPw)   // = unlockWithPassword(newPw,{verified:true}); if "old_password" ⇒ remote.setNeedsRewrap()
return res
```

### `commitPending(ctx)`

Runs at boot, on `online`, and from `checkServerKey`.
- An unconfirmed pending is dropped at boot, because we can't know whether `updateUser` succeeded.
- A confirmed pending runs this loop (3 tries):

```
row = getKeyRow() (NetworkError ⇒ keep pending, retry later)
if !row || row.kid !== p.fromKid: drop pending; return      // someone else changed the key; normal checks take over
all = {...ring.keys, ...openRing(row, ring.keys[row.kid])}
ringEntries = wrap every k≠p.kid of all under p.dek (AAD ringAad(uid,k,p.kid))
casKeyRow(row.rev, {kid:p.kid, salt:p.salt, iterations:p.iterations, wrapped:p.wrapped, ring:ringEntries, needs_rewrap:false})
   ok ⇒ saveRing({current:p.kid, keys:{...all,[p.kid]:p.dek}, weak:weakPassword-at-prepare, pending:null})
   null ⇒ retry
```

### `checkServerKey(ctx)` (returns `KeyRow | null | undefined`, where undefined means offline)

Runs at engine boot, on `online`, on visibility after 20 s or more, on a realtime event for `diary_keys`, and when the sheet opens while not ready.
1. If a confirmed pending exists, call `commitPending` first.
2. If the server row's `kid` is held, unwrap the ring entries this device lacks and save them.
3. If there are local extra keys, call `mergePatch` and CAS it.
4. Set `ring.current = row.kid`.
5. If any keys were added, the engine reopens locked entries.

### `resetKey(ctx, pw)` ("새로 시작")
1. Verify the password.
2. Build a rotation from whatever keys this device holds.
3. CAS it onto the row (or insert if there is no row).
   - If the refetched row's kid turns out to be held, run a plain unlock instead.

It never deletes entries. Entries sealed with keys nobody holds stay locked. If another device that still holds the old key later unlocks, its key is merged into the ring and those entries open everywhere.

### `diaryAfterLogin(sb, uid, pw)`

Called from AuthForm. It returns immediately if `!supported()`. Otherwise it runs `unlockWithPassword({uid, storage: idbDiaryStorage(), remote: supabaseDiaryRemote(sb, uid)}, pw, {verified: true})`, catching and logging any error.

### State machine (engine state)

`DiaryState` is one of:
- `off` (cloud build, logged out)
- `unsupported`
- `loading`
- `ready{weak, repair: null|"rewrap"|"publish"}`
- `locked{why: "first_time"|"need_password"|"key_changed"|"old_password"}`

`computeState(ring, row)`:
- Cloud mode:
  - No held current key → `first_time` if `row === null`, otherwise `need_password`.
  - `row === undefined` (offline) → `ready`, optimistically.
  - `row === null` → `ready{repair: "publish"}`.
  - `row.kid` not held → `key_changed`.
  - Otherwise → `ready{repair: row.needs_rewrap ? "rewrap" : null}`.
- `old_password` is a transient state, set when unlock returns `"old_password"`. It clears when the keyring changes.
- Device mode (no Supabase build): generate a local key if there is none; the state is always `ready`.

| Event | Result |
|---|---|
| Logout (default) | Nothing is deleted. The engine is disposed and the state becomes `off`. Keys and rows stay in IndexedDB. |
| Logout with "이 기기에서 일기도 지우기" checked | Wipe (see the engine API); refused while entries are still unsent. |
| SIGNED_OUT from any cause (global signOut, admin, password change elsewhere) | The engine is disposed. **Nothing is deleted.** |
| Account deletion | `on delete cascade` removes keys and entries. |

Supabase Auth normally ends other sessions when the password changes (I did not verify this). In that case other devices log in again, and a password login unlocks them automatically.

---

## 7. Entry engine: `src/lib/diary.ts`

```ts
export interface DiaryEntry { id; day; body: string; mood: number|null; created_at; updated_at; deleted_at: string|null;
  locked: boolean; dirty: boolean; err: string|null }
export interface DiarySnap { mode: "cloud"|"device"|"off"; state: DiaryState; entries: Record<string, DiaryEntry>; pending: number; error: string|null }
export function emptyDiarySnap(mode): DiarySnap
export function diaryOn(d: DiarySnap, day): DiaryEntry[]   // !deleted_at, sort created_at
export function diaryList(d: DiarySnap): DiaryEntry[]       // live, newest day first
export class DiaryEngine {
  constructor(o: { uid: string; mode: "cloud"|"device"|"off"; remote: DiaryRemote|null; storage?: DiaryStorage;
                   onChange: (s: DiarySnap) => void; uploadDelayMs?: number /*5000*/ })
  start(): void; dispose(): void
  save(i: { id?: string; day: string; body?: string; mood?: number|null; base?: { body: string } })
       : { ok: true; id: string } | { ok: false; error: "locked"|"too_long" }
  remove(id): boolean
  unlock(pw, o?: { oldPassword?: string }): Promise<UnlockResult>
  reset(pw): Promise<UnlockResult>
  changePassword(pw, update): Promise<{ error: unknown }>
  refresh(): Promise<void>; flushSoon(): void; onOnline(): void; onVisible(): void
  flush(): Promise<void>; pull(): Promise<void>; attachRealtime(ch: RealtimeChannel): void
  wipe(): Promise<boolean>
}
```

### Internals
- `entries` is the plaintext held in memory.
- `stored` mirrors the IndexedDB rows.
- `seq` and `persistedSeq` are per-id counters.
- `chains: Map<id, Promise>` is a per-id serial queue. `queue(id, fn)` chains `fn`, catches errors and logs them.
- `emit()` builds the `DiarySnap`:
  - `dirty = stored[id]?.dirty || seq[id] !== persistedSeq[id]`
  - `pending` is the number of dirty entries.
- `derive(row, keys)` returns `{...row, ...open(...)}` with `locked: false`. Any error gives `{body: "", mood: null, locked: true}`, and `open` is total.

### `start()`
1. Synchronously open `BroadcastChannel("must-diary:"+uid)` **before** any IndexedDB read:
   - `keys` → reload the ring, recompute state, reopen locked entries.
   - `rows` → queue a reload of those ids from storage, but only if this tab has no queued work for that id.
   - `wipe` → reset to empty.
2. Then call `void boot()`:
   - If `mode === "off"`, set state `off` and stop.
   - If unsupported, set state `unsupported`.
   - Otherwise set `loading`, load the ring and rows, run `derive` on all of them, compute the state, and emit.
   - Then, if remote: drop any unconfirmed pending, call `commitPending`, `checkServerKey`, `pull`, `flush`.

### `save()`
1. Requires state `ready`. A locked entry returns `"locked"`.
2. If `cur` is deleted, treat the save as a new entry: never revive deleted text.
3. **Fork on a draft conflict.** If `i.base` is given and `cur.body !== i.base.body`, the entry changed under the draft (another device or tab).
   - If `forkOf[id]` exists and that copy's body equals `i.base.body`, write into the existing copy.
   - Otherwise create a new id with the draft body and the mood (from the input, otherwise null), and set `forkOf[id] = newId`.
4. A caller-supplied id that doesn't exist yet creates that entry. The editor pre-generates ids so React keys stay stable.
5. If `plainBytes > 65536`, return `"too_long"`.
6. Update memory with `updated_at = nowIso()` and `seq++`, emit, call `queue(id, persist)`, then `scheduleUpload()`.

### `remove(id)`
Only for a live, unlocked entry. Sets `{body: "", mood: null, deleted_at: now}` (a tombstone, so the old text is not kept), then follows the same path as `save`.

### `persist(id)` (runs in the queue)
1. `e = entries[id]`. If not dirty, return. Capture `s = seq[id]`.
2. Seal with `keys[ring.current]`.
   - This runs even if the state has turned locked meanwhile. The current kid is still held, and keeping the data safe comes first.
3. `updateRow(id, cur => ({id, day, sealed, created_at, updated_at, deleted_at, ver: cur?.ver ?? null, synced_at: cur?.synced_at ?? null, dirty: true, err: null, tries: 0}))`.
   - The base `ver` is always taken from storage, never from memory.
4. `persistedSeq[id] = s`, then `announce({t: "rows", ids: [id]})`.

### `flush()`
- Skips if there is no remote, the device is offline, or a flush is already running.
- Does not require the key, because rows are sealed already.

```
await Promise.all(chains.values())                     // drain persists
rows = stored dirty && (tries ?? 0) < 5, sort updated_at, take 50
for r: try res = pushEntry({id,day,sealed,created_at,updated_at,deleted_at, base_ver: r.ver})
       NetworkError ⇒ stop, backoff 2s→60s
       other Error ⇒ updateRow(r.id, c => c?.sealed === r.sealed ? {...c, err: msg, tries: (c.tries??0)+1} : null); continue
          (never dropped; error shown on that entry; other rows continue)
       res ⇒ markUploaded(r, res)
       null ⇒ resolveConflict(r)
reschedule if dirty rows remain; error = last non-network message ("일기 올리기 실패: …")
```

`markUploaded(r, {ver, synced_at})`, in `queue(r.id)`:
- If the stored row's `sealed === r.sealed`, set `{dirty: false, ver, synced_at, err: null, tries: 0}`.
- Otherwise set only `ver`, so the newer local edit is now based on the version we just uploaded.

`resolveConflict(r)`, in `queue(r.id)`:

```
s = getEntry(r.id)  (NetworkError ⇒ stop);  if !s ⇒ mark err "missing"
if s.sealed === r.sealed && s.deleted_at == r.deleted_at ⇒ markUploaded(r, s)     // our earlier try landed (lost response)
L = entries[r.id] (latest memory); S = derive(s, keys)
if L.deleted_at                         ⇒ apply s (drop our delete; the other device's text survives)
else if s.deleted_at                    ⇒ updateRow: ver = s.ver, keep dirty  (rebase; our text comes back on the next flush)
else if !S.locked && S.body===L.body && S.mood===L.mood ⇒ apply s
else ⇒ copyId = uuid(); entries[copyId] = {...L, id: copyId, created_at: now, updated_at: now}; seq++;
       await persist(copyId)  (must succeed before the next step);  forkOf[r.id] = copyId; apply s
apply s = updateRow(r.id, () => fromServer(s, dirty:false)); entries[r.id] = S; emit; scheduleUpload(0)
```

### `pull()`
- The cursor is `meta "cursor"`.
- `after` = cursor minus 2 minutes (as ISO), or null for the first pull, which fetches all history with no window.
- Up to 20 pages of 500. For each row, `await applyRemote(row)`, and only then advance the cursor by `Date.parse` maximum.
- Save the cursor, then call `checkServerKey()`.

### `applyRemote(s)`
1. If `!SEALED_RE.test(s.sealed)`, fetch the row with `getEntry(s.id)`. This covers a realtime payload with a missing or truncated `sealed`.
2. Then, in `queue(s.id)`:
   - If `stored.dirty`, return; flush will resolve it.
   - If `stored.ver != null && s.ver <= stored.ver`, return. This drops out-of-order and overlap rows.
   - Otherwise `plain = derive`, then `updateRow` with the same checks repeated inside the transaction, write `fromServer(s)`, set `entries[s.id]`, and emit.

### Realtime
`attachRealtime(ch)` adds two handlers before `subscribe`:
- `diary_entries` filtered by `user_id=eq.uid`: `void applyRemote(new).then(bump cursor)`. The cursor advances only after the row is applied.
- `diary_keys` filtered by `user_id=eq.uid`: `void checkServerKey()`.

### `reopenLocked()`
For each locked entry, in `queue(id)`: re-read the stored row, `derive` it, and update memory only if the stored `sealed` is unchanged. This is a compare-and-set, so a newer row is never overwritten.

### Scheduling
- `scheduleUpload(ms = uploadDelayMs)` is a debounce.
- `flushSoon()` uploads immediately. It is called on editor blur, on sheet close and on `visibilitychange: hidden`.
- Local autosave stays at 700 ms. Uploads go out at most every 5 s while typing, which leaks less of the typing timeline.

### `wipe()`
`await flush()`. If `pending > 0`, return false. Otherwise `storage.wipe(uid)`, `announce({t: "wipe"})` and return true.

### Never
- Never add the diary to `TABLES`, `DB`, `emptyDb`, `importDb`, `exportJson` or `careerMaterial`.
- Never call `PlannerStore.put`.
- Never send any field other than the 7 columns in the push payload.

---

## 8. `src/lib/store.ts`: exact changes

1. Imports: `DiaryEngine, emptyDiarySnap, type DiarySnap` from `./diary`; `idbDiaryStorage` from `./diaryStorage`; `supabaseDiaryRemote` from `./diaryRemote`.
2. `Snapshot`: add `diary: DiarySnap`.
3. Constructor gets a 4th parameter, `diaryMode: "cloud"|"device"|"off" = "off"`. Do not make it a parameter property.
   - Add a field `readonly diary: DiaryEngine` and build it as `new DiaryEngine({uid: userId ?? "local", mode: diaryMode, remote: remote && userId ? supabaseDiaryRemote(remote, userId) : null, storage: idbDiaryStorage(), onChange: (d) => this.emit({diary: d})})`.
   - The initial snapshot gets `diary: emptyDiarySnap(diaryMode)`.
4. `start()`:
   - The first line is `this.diary.start()`.
   - `onOnline`: add `this.diary.onOnline()`.
   - `onVisible`: if hidden, `this.diary.flushSoon()`; if visible, `this.diary.onVisible()`.
5. `dispose()`: `this.diary.dispose()`.
6. Rename the current `flush` body to `private async flushOutbox()`. New: `async flush() { await Promise.all([this.flushOutbox(), this.diary.flush()]); }`.
   - The existing early return on an empty outbox must stay inside `flushOutbox`.
7. Rename the current `pull` body to `private async pullTables()`. New: `async pull() { await Promise.all([this.pullTables(), this.diary.pull()]); }`.
8. `subscribeRealtime()`: call `this.diary.attachRealtime(ch)` immediately before `ch.subscribe(...)`.
9. Optional, small, fixes the silent localStorage quota failure:
   - `writeJson` returns a boolean.
   - `persist()` on failure emits `{error: "이 기기 저장 공간이 꽉 찼어요 — 지금 바꾼 내용이 저장되지 않았어요"}`.
10. Unchanged: `TABLES`, `emptyDb`, `applyRemote`, `importDb`, `exportJson`, `put`.

---

## 9. Other code changes

### PlannerProvider.tsx
- `Sheet` already has `"diary"` in the working tree.
- `boot()`: `new PlannerStore(userId ?? "local", userId, userId ? getSupabase() : null, userId ? "cloud" : cloudEnabled ? "off" : "device")`.
- No diary action on SIGNED_OUT.

### AuthForm.tsx
- After a successful `signInWithPassword`, in both the login and post-signup branches: `const { data, error } = …; if (data.user) void diaryAfterLogin(sb, data.user.id, password)`.
- Signup:
  - Password `minLength={mode === "signup" ? 8 : 6}`. Existing short passwords must still log in.
  - Placeholder "새 비밀번호 (8자 이상)".
  - `SIGNUP_ERRORS.weak_password` = "비밀번호는 8자 이상이어야 해요."
- `friendly()`: replace the `"6"` special case with `/at least (\d+)/` → `` `비밀번호는 ${n}자 이상이어야 해요.` ``

### signup/logic.ts
- `password.length < 8`.
- Update the test fixtures from "secret1" to "secret12", and add a 7-character weak case.
- Redeploy `signup`.
- Optionally set the Supabase dashboard minimum password length to 8.

### SettingsSheet.tsx
- **PasswordSection**
  - Minimum 8. The placeholder reads "새 비밀번호 (8자 이상)".
  - Submit through `store.diary.changePassword(pw, () => sb.auth.updateUser({ password: pw }))`.
  - Description when not in recovery: "비밀번호는 암호화돼 저장돼서 운영자도 볼 수 없어요. 일기 열쇠도 새 비밀번호로 같이 바뀌어요."
  - When `snap.diary.state` is `locked` and `why !== "first_time"`, show a hint above 저장: "이 기기에선 일기가 아직 잠겨 있어요. 일기가 열리는 기기(폰 등)에서 비밀번호를 바꾸면 모든 기기에서 그대로 열려요."
- **Account logout**
  - Unchecked checkbox "이 기기에서 일기도 지우기 (같이 쓰는 컴퓨터일 때만)".
  - If checked: `if (!(await store.diary.wipe())) setErr("아직 안 올라간 일기가 있어요 — 인터넷에 연결된 뒤 다시 해 주세요.")`, otherwise `signOut()`.
- **Backup section**: add "일기는 백업 파일에 들어가지 않아요 — 계정에 잠긴 채로 저장돼요."

### AdminSheet.tsx
After the line-360 paragraph, add: "일기는 그 사람만 열 수 있어요. 재설정 링크는 그 사람이 일기를 쓰던 기기(폰/PC)에서 열게 하세요 — 그래야 일기도 새 비밀번호로 바로 열려요."

### Shell.tsx
- Under 기록, as the first item: `<MenuItem icon={<BookHeart size={17}/>} label="일기" onClick={() => p.openSheet("diary")} />`. `BookHeart` exists in the installed lucide.
- Render `<DiarySheet />`.

### DiarySheet.tsx (Modal size `lg`)
- **Date nav:** "‹ 10월 8일 (수) ›" and [오늘].
- **Body** depends on the state (copy in §10).
- **"그날 기록"** (read-only):
  - Done tasks: `status === "done"` and `dayKey(completed_at) === day`.
  - `activitiesOnDay`.
  - Missed or skipped tasks: by `starts_at` day, excluding someday tasks.
- **Past list:** month nav, search box (`includes` over decrypted bodies), newest first. Each row shows the date, the mood emoji (from `MOODS` in CalendarTab) and the first line. Locked rows show "🔒 아직 못 여는 글". Tap to jump to that day.
- **Footer:** the lock line, the weak nudge, and the day-note line.
- **On open:** if not ready, call `store.diary.refresh()`. **On close:** `flushSoon()`.
- **EntryEditor**, one per entry; when the day has none, a single "new" editor with an id pre-generated by `useState(() => uuid())`:
  - Mood buttons call `save({ id, day, mood })` directly.
  - The textarea follows the DayNote draft pattern. On the first keystroke, capture `baseRef = { body: entry?.body ?? "" }`; autosave after 700 ms; on blur and unmount call `save({ id, day, body: draft, base: baseRef })` and then `flushSoon()`.
  - `too_long` keeps the draft and shows an error.
- Do not wire VoiceAdd or `speech.ts` in here: dictation sends audio to Google. Leave a comment in the file saying so.
- No success toasts anywhere in the diary flows.

---

## 10. UI states and Korean copy

| State | Shown |
|---|---|
| `off` | **로그인하면 일기를 쓸 수 있어요** / 일기는 폰·PC 어디서나 이어서 쓰도록 계정에 잠가서 저장해요. [로그인하러 가기] → `openSheet("settings","account")` |
| `unsupported` | 이 브라우저에선 일기를 잠글 수 없어요. 주소가 https:// 로 시작하는지, 시크릿 창이 아닌지 확인해 주세요. |
| `loading` / unlocking | 일기 여는 중… |
| `locked first_time` | **일기를 처음 켜요** / 로그인 비밀번호를 한 번 넣으면 일기 열쇠를 만들어 잠가 둬요. 다른 기기에서도 같은 비밀번호로 로그인하면 바로 열려요. [일기 켜기] |
| `locked need_password` | **일기를 열려면 로그인 비밀번호를 한 번 넣어 주세요** / 이 기기에서 한 번만 넣으면 돼요. 일기는 이 비밀번호로 잠겨 있어서 서버·운영자는 못 읽어요. [열기] |
| `locked key_changed` | **다른 기기에서 일기 열쇠가 바뀌었어요** / 지금 로그인 비밀번호를 한 번 넣으면 새 열쇠를 받아 와요. 그 전에 쓴 글은 그대로 읽을 수 있어요. [열기] |
| `locked old_password` | **일기 열쇠가 예전 비밀번호로 잠겨 있어요** / 일기가 열리는 기기(폰·PC)에서 일기를 한 번 열면 여기서도 자동으로 열려요. 아니면 아래에 두 비밀번호를 넣어 주세요. Fields: "지금 로그인 비밀번호", "바꾸기 전 비밀번호". [열기] |
| `ready repair:"rewrap"` (card on top) | **다른 기기에서 일기가 안 열려요** / 다른 기기에서 비밀번호를 새로 정해서 그래요. 지금 로그인 비밀번호를 한 번 넣으면 폰·PC 모두 열려요. [비밀번호 넣기] |
| `ready repair:"publish"` | 다른 기기에서도 열리게 하려면 로그인 비밀번호를 한 번 넣어 주세요. [비밀번호 넣기] |
| `ready weak` (footer) | 로그인 비밀번호가 짧으면 시간을 들여 풀어낼 수도 있어요. 10자 이상(글자+숫자)으로 바꾸면 더 안전해요. [비밀번호 바꾸기] |

**Password field.**
- `<form>` with `<input type="email" autoComplete="username" value={email} readOnly hidden>` and a password input with `autoComplete="current-password"`, so the password manager fills it in one tap.
- Errors:
  - `wrong_password`: "비밀번호가 틀렸어요. 앱에 로그인할 때 쓰는 비밀번호예요."
  - `old_wrong`: "바꾸기 전 비밀번호가 맞지 않아요."
  - `network`: "인터넷에 연결된 뒤 다시 해 주세요."

**Link: 비밀번호가 기억 안 나요** opens a panel.
- Always: an inline "새 비밀번호 정하기" form (two fields, minimum 8). It calls `store.diary.changePassword(pw, () => sb.auth.updateUser({password: pw}))`.
  - Copy: "일기는 로그인 비밀번호로 잠가요. 기억이 안 나면 여기서 새로 정하세요 — 다음부터 로그인도 이 비밀번호로 해요."
- If a key row exists:
  - "일기가 열리는 기기(폰·PC)에서 설정 → 계정 → 비밀번호 바꾸기로 새 비밀번호를 정한 뒤, 여기에 그 비밀번호를 넣으세요."
  - At the bottom, **새로 시작**: "지금 열 수 없는 글 {N}개는 이 기기에서 계속 잠겨 있어요. 나중에 그 글을 열 수 있는 기기에서 일기를 한 번 열면 다시 열려요."
  - It needs the current password and the typed word "새로 시작" ("확인하려면 ‘새로 시작’이라고 적어 주세요"). Red button [새로 시작].

**Entry**
- Status: 입력 중… / 저장됨 / 올리는 중 / 못 올림 — {err}.
- Too long: "너무 길어요 — 2만 자까지 쓸 수 있어요."
- Two or more entries on a day: "이 날 글이 {n}개예요 — 두 기기에서 따로 써서 둘 다 남겼어요. 필요하면 합치고 하나를 지우세요."
- Locked entry: "🔒 이 기기에서 아직 못 여는 글이에요. 이 글을 쓴 기기에서 일기를 한 번 열면 여기서도 열려요." The entry is read-only and cannot be deleted.
- Delete: "이 글 지우기", then a confirm titled "일기를 지울까요?" with "모든 기기에서 사라지고 되돌릴 수 없어요." [지우기] [취소].
- Empty list: "아직 쓴 일기가 없어요." Search placeholder: "일기에서 찾기".

**Footer**
- The lock line from §0.
- "캘린더의 ‘하루 노트’와 기분은 잠기지 않는 따로 된 메모예요."

---

## 11. Test plan

### DB: `supabase/tests/schema.test.mjs`
- Add `"20261011000000_diary.sql"` to the twice-run migration list.
- Add a "── 일기 ──" block before the summary, using the activities-block `as`/`throws` helpers. Port the assertions from `diarytest.mjs`:
  - Insert gives `ver` 1 and the default `user_id`.
  - Matching base gives `ver` 2 and `base_ver` null.
  - Stale base, null base on an existing id, and a day change are each skipped with an empty `RETURNING` and unchanged content.
  - A stub without `sealed` gets a NOT NULL error.
  - Plaintext, short and over-100k `sealed` values hit the CHECK.
  - `information_schema` shows no body or mood column.
  - RLS read and write isolation; `user_id` can't change; delete is denied; anon is denied.
  - Keys: insert-ignore, the iteration floor, CAS with current and stale `rev`, server-controlled `rev` and `user_id`, delete denied, RLS.
  - The publication contains both tables.
  - Deleting a fresh user D cascades to both tables. Don't delete A; later blocks use A.

### Unit tests: `npm run test:unit`
- Script: `"test:unit": "node --import ./tests/register.mjs --test \"tests/*.test.mjs\""`.
- Node 22.22 strips types natively. `hooks.mjs` adds `.ts` to relative extensionless imports (copy from scratch `tt/`). No new dependencies. The `.mjs` tests fall outside the tsconfig `include`.

`tests/diary-crypto.test.mjs` (extend `c.test.mjs`):
- Round trip.
- The AAD binds uid, id, day and kid. Changing any of them gives `WrongKey`. Flipping one character also gives `WrongKey`.
- A short entry and a mood-only entry have equal length (747). The 512 and 1024 boundaries hold.
- 20k Korean characters stay at or under 100,000. Control-character spam gives `TooLong`.
- The wrapped key matches the DB regex. The wrap AAD binds salt and iterations.
- `deriveKek` rejects 1000 and 6,000,000 iterations.
- `weakPassword` cases.
- base64url round trip for lengths 0 to 70.

`tests/pgliteRemote.mjs`:
- Boots PGlite with the minimal auth stub from `diarytest.mjs`, `init.sql` and the diary migration.
- `remote(uid, passwords)` implements `DiaryRemote`. Each call runs in `db.transaction(tx => { set local role authenticated; set_config('request.jwt.claim.sub', uid, true); … })`.
- `verifyPassword` checks a JS map.
- It has fault injection: `failNext(method, "network" | "error")` and `afterCommitThrow(method)` (simulates a lost response).

`tests/diary-sync.test.mjs`. Devices are `DiaryEngine({mode: "cloud", storage: memoryDiaryStorage(), uploadDelayMs: 0})`, always disposed at the end:
1. A logs in, which creates the key. B unlocks and gets the same kid. A's entry reaches B through pull and decrypts.
2. A wrong password in unlock returns `wrong_password`; `rev` is unchanged and no row is inserted when none existed (typo guard).
3. Two devices call `unlockWithPassword` concurrently with no row: exactly 1 row, same current kid on both.
4. Both write 2026-10-08 offline, then flush: the server has 2 rows, both devices show both texts.
5. Concurrent edit of entry X: A is accepted (`ver` 2). B is rejected, gets a copy, and X is replaced by A's text. After pulls, both devices show X and the copy.
6. Lost response (`afterCommitThrow pushEntry`): the next flush sees its own `sealed`. The row becomes clean with no copy.
7. Draft fork: a remote change lands, then `save` with a stale base creates a copy. A second save with the same base reuses the copy through `forkOf`.
8. Delete against edit, both orders: B's text survives (rebase or keep the server version). A tombstone opens as `{body: "", mood: null}`.
9. Poisoned row (`failNext pushEntry "error"` for one id): the other rows upload; the bad row keeps dirty with `err` and is never dropped. After 5 tries it stops retrying automatically.
10. `changePassword` with the key: the row's kid changes and the ring holds the old kid. B (old key only) checks the server and becomes `key_changed`. B unlocks with the new password and reads old and new entries.
11. Commit failure (`failNext casKeyRow network`): the pending stays confirmed, and after `onOnline` the commit succeeds.
12. Password change on a device without the key: C ends with `needs_rewrap = true`. A is `ready{repair: "rewrap"}`. A unlocks with the new password, which rotates and clears the flag. C unlocks and reads everything.
13. `reset` on C (no keys) gives K2 with an empty ring. A (K1) unlocks with the current password; the row kid is still K2 and K1 is merged into the ring. C runs `checkServerKey`, learns K1, and A's old entries open. A never overwrites K2.
14. Downgrade: `update diary_keys set iterations = 1000` as superuser. A (holds the key) unlocks, the row is rotated back to 600000 iterations and a fresh salt. A keyless device gets `old_password` with no write.
15. Swapping `sealed` between rows, or changing `day` by SQL, makes those entries locked. They are never uploaded.
16. A keyless device pulls: entries are locked, `save` returns `"locked"`, `remove` returns false, and nothing becomes dirty.
17. Cross-tab: two engines share one storage. `diaryAfterLogin` runs in tab 1; tab 2 becomes ready and decrypts.
18. Out-of-order realtime: apply `ver` 3, then `ver` 2; the entry stays at `ver` 3. A payload without `sealed` makes the engine call `getEntry`.
19. `wipe()` with dirty rows returns false. After a flush it returns true and the storage for that uid is empty.
20. Spy on `pushEntry`: the payload keys are exactly the 7 columns, and `JSON.stringify(payload)` contains no body text.
21. Static check: `src/lib/store.ts` `TABLES` and `src/lib/types.ts` `DB` contain no "diary". `exportJson()` of a store holding diary entries contains no diary text.

### Manual (phone and PC)
- Password login on both devices unlocks with no prompt.
- An OTP-login device shows the unlock card, and autofill works.
- Writing on the phone shows up on the PC within about 6 s.
- Airplane-mode edits on both devices survive as two entries.
- Changing the password on the phone means the PC logs in again and opens the diary.
- Logout without the wipe option, then login, keeps the diary readable.
- Run `npm run lint`, `npm run typecheck`, `npm run test:db`, `npm run test:unit`.

---

## 12. Reviewer findings

### Accepted (some with a different fix)

**Security**
- **S1:** honest copy, 8-character minimum for new passwords, weak nudge.
- **S2:** kid plus a flat ring, a new DEK on every wrap change, and delete writes a sealed empty tombstone.
- **S3:** no plaintext outbox. Sealed rows live in IndexedDB, which old builds never read. NOT NULL plus CHECK, and a schema test that there are no body or mood columns.
- **S4:** partly. The diary is sealed at rest, with an opt-in wipe at logout.
- **S5:** partly. Every typed password is checked with `signInWithPassword` before it is used for a wrap.
- **S6:** constant parameters, an iteration floor and cap, the parameters inside the wrap AAD, and an automatic re-wrap only after a verified password and only when the server's kid is one the device holds.
- **S7:** padding to power-of-two buckets of at least 512 bytes, a one-digit mood, uploads at most every 5 s.
- **S8:** the diary is not in the export, the copy notes that day notes are not locked, and VoiceAdd stays out of the diary.

**Sync**
- **F1:** random ids, no `unique(user_id, day)`, a server-side `base_ver` check, and conflict copies.
- **F2:** single-row uploads, never auto-dropped, size limits made consistent (65,536 padded bytes against the 100,000-character DB cap).
- **F3:** kid, CAS on `rev`, `key_changed` detection.
- **F4:** stored rows always hold the real `sealed`, and locked entries are read-only.
- **F5:** `base_ver` decides conflicts instead of timestamps, and a rejected write is detected because `.select()` comes back empty.
- **F6:** per-id queue with compare-and-set on the stored `sealed`.
- **F7:** IndexedDB storage, plus the optional `writeJson` error.
- **F8:** BroadcastChannel, and storage that is never downgraded.
- **F9:** flush doesn't need the key, keys are kept at logout, a separate pending count.
- **F10:** `open()` never throws, the cursor advances after apply, and a missing `sealed` is fetched.
- **F11:** a deleted entry is never revived.

**Flows**
- **F1:** keys are kept on logout and SIGNED_OUT, with an opt-in wipe that flushes first and refuses while entries are unsent.
- **F2:** password verification and distinct error messages.
- **F3:** `changePassword` covers both normal change and recovery, with a crash-safe pending rotation.
- **F4:** `needs_rewrap` flag, repair card, PasswordSection hint, and the two-field `old_password` card.
- **F5:** the "비밀번호가 기억 안 나요" path and autofill.
- **F6:** keyring, merge, and 새로 시작 behind a typed confirmation.
- **F8:** admin copy and FK cascade.
- **F9:** synchronous listener and BroadcastChannel.

### Rejected

1. **Mandatory strong password before the diary turns on (S1a).** It contradicts "비밀번호고 자시고". Replaced by the 8-character minimum for new passwords, the weak nudge and honest copy.
2. **ECDH device linking and a recovery key (S1b, also the security verdict).** It needs both devices online together and a recovery key for non-technical users, and it means a much larger change. Password wrapping already unlocks automatically at login. Possible later version.
3. **Background re-seal of old entries after rotation (S2).** It re-uploads the whole history and races with edits from other devices. The gain is small, because whoever holds an old key usually holds the old ciphertext too.
4. **Purge the DEK or diary on SIGNED_OUT (S4).** Flows F1 is right. Global signOut (verified as the default in `GoTrueClient.js`), password changes and admin sign-outs all fan out to other devices, so this would destroy the only copies of the key.
5. **Require the current password in PasswordSection, or enable Supabase "secure password change" (S5).** It blocks users who log in with a code. The attack needs both the unlocked device and database access, and the visible result is that the owner's login password changes.
6. **"Only auto-rewrap with evidence of a password change, else error" (S6, in part).** Once the server has verified the password and the server kid is one the device holds, a tampered row gains an attacker nothing. The kid condition stays.
7. **Export the diary sealed by default, and warn on Drive upload (S8).** Moot: the diary is not in the JSON export at all.
8. **Text-merge by concatenating bodies with a separator (sync F1c and F1d).** It duplicates shared text. Keeping both versions as separate entries is lossless and simpler.
9. **Fetch the day from the server before the first write to it (sync F1e).** Not needed: with random ids, new entries never collide.
10. **`importDb` id remapping and adding `diary_entries` to the flush order (sync F2.3, F2.4; flows F7).** Not applicable. The diary is not in `TABLES`, `importDb` or `exportJson`, and cloud builds need a login to use it.
11. **Monotonic `updated_at = max(now, cur + 1ms)` (sync F5).** Not needed: conflicts are decided by `ver`, not timestamps.
12. **"Don't persist `sealed` for locked rows; reset the cursor on key arrival" (sync F7).** Keeping sealed rows in IndexedDB is what lets a locked device open them later without downloading them again.
13. **Separate diary password or diary DB policies tied to approval.** Not proposed by any reviewer. Listed only to confirm the RLS ignores approval status, as in the original design.

All reviewer code references I checked were accurate. Flows F1's claim that a password change ends other sessions comes from Supabase server behavior, which I could not verify locally, so the design does not depend on it.

---

The English labels the user asked for were already committed in caa886b: Header "Live sync", "Voice" and the other status labels, and Shell "Voice". Three Korean strings remain:
- the PWA shortcut `short_name: "말로 추가"` in `src/app/manifest.ts:28`
- the explanatory paragraph at `SettingsSheet.tsx:692`
- a code comment at `Header.tsx:188`

They are outside this spec.