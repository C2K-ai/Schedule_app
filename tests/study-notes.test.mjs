// 공부 노트 — 이 기기 먼저 저장 → 드라이브 Study 폴더와 맞추기. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { NoteConflict, NotesStore, defaultTitle, isUntouched, noteFileName, titleOf } from "../src/lib/studyNotes.ts";

/** 가짜 드라이브(Study 폴더) — 판이 바뀔 때마다 시각이 1초씩 간다 */
function fakeDrive() {
  const files = new Map();
  let clock = Date.parse("2026-10-09T01:00:00.000Z");
  let n = 0;
  const tick = () => new Date((clock += 1000)).toISOString();
  const calls = [];
  let failNext = null;
  const guard = (m) => {
    calls.push(m);
    if (failNext) {
      const e = failNext;
      failNext = null;
      throw e;
    }
  };
  const api = {
    async list() {
      guard("list");
      return [...files.entries()].map(([id, f]) => ({ id, name: f.name, at: f.at }));
    },
    async read(id) {
      guard("read");
      if (!files.has(id)) throw new Error("드라이브에서 지워진 파일이에요.");
      return files.get(id).text;
    },
    async create(name, text) {
      guard("create");
      const id = `f${++n}`;
      files.set(id, { name, text, at: tick() });
      return { id, name, at: files.get(id).at };
    },
    async update(id, name, text, base) {
      guard("update");
      if (!files.has(id)) throw new Error("드라이브에서 지워진 파일이에요.");
      if (base !== undefined && Date.parse(files.get(id).at) !== Date.parse(base)) throw new NoteConflict();
      files.set(id, { name, text, at: tick() });
      return { id, name, at: files.get(id).at };
    },
    async remove(id) {
      guard("remove");
      files.delete(id);
    },
  };
  return {
    api,
    files,
    calls,
    failOnce: (e) => (failNext = e),
    /** 다른 기기(노트북)가 직접 고침 */
    otherDevice: {
      write: (id, name, text) => files.set(id, { name, text, at: tick() }),
      /** 시각만 바뀜(올리다 끊긴 판 등) */
      touch: (id) => files.set(id, { ...files.get(id), at: tick() }),
      add: (name, text) => {
        const id = `f${++n}`;
        files.set(id, { name, text, at: tick() });
        return id;
      },
    },
  };
}

function memStorage(init = null) {
  let saved = init;
  return { load: () => saved, save: (v) => (saved = JSON.parse(JSON.stringify(v))), peek: () => saved };
}

let ids = 0;
function newStore({ storage = memStorage(), online = { v: true } } = {}) {
  const s = new NotesStore(storage, {
    isOnline: () => online.v,
    uuid: () => `n${++ids}`,
    delay: 5,
    now: () => new Date("2026-10-09T09:00:00+09:00"),
  });
  return { s, storage, online };
}

test("제목·파일 이름", () => {
  assert.equal(defaultTitle(new Date(2026, 9, 9)), "10월 9일 공부 노트");
  assert.equal(noteFileName(" 영어/단어 정리 "), "영어 단어 정리.txt");
  assert.equal(noteFileName("   "), "제목 없는 노트.txt");
  assert.equal(titleOf("수학 오답.txt"), "수학 오답");
});

test("인터넷이 없으면 이 기기에만 — 돌아오면 올라간다", async () => {
  const d = fakeDrive();
  const { s, online } = newStore({ online: { v: false } });
  const n = s.create();
  s.edit(n.id, { body: "관계대명사 정리" });
  s.setBackend(d.api);
  await s.sync();
  assert.equal(s.getSnapshot().status, "offline");
  assert.equal(d.files.size, 0);
  assert.equal(s.getSnapshot().pending, 1);
  online.v = true;
  await s.sync();
  assert.equal(s.getSnapshot().status, "idle");
  assert.equal(d.files.size, 1);
  const [f] = [...d.files.values()];
  assert.equal(f.name, "10월 9일 공부 노트.txt");
  assert.equal(f.text, "관계대명사 정리");
  assert.equal(s.getSnapshot().pending, 0);
  assert.equal(s.get(n.id).dirty, false);
});

test("로그인 전엔 'local', 로그인하면 올라간다", async () => {
  const d = fakeDrive();
  const { s } = newStore();
  const n = s.create("수학");
  s.edit(n.id, { body: "미분" });
  await s.sync();
  assert.equal(s.getSnapshot().status, "local");
  s.setBackend(d.api);
  await s.sync();
  assert.equal(d.files.size, 1);
});

test("아무것도 안 쓴 새 노트는 안 올리고, 닫으면 치운다", async () => {
  const d = fakeDrive();
  const { s } = newStore();
  s.setBackend(d.api);
  const n = s.create();
  await s.sync();
  assert.equal(d.files.size, 0);
  assert.equal(s.getSnapshot().pending, 0, "빈 노트는 '못 올림'으로 안 셈");
  s.discardIfEmpty(n.id);
  assert.equal(s.getSnapshot().notes.length, 0);
});

test("올리는 사이에 또 고치면 다음에 마저 올린다", async () => {
  const d = fakeDrive();
  const { s } = newStore();
  s.setBackend(d.api);
  const n = s.create();
  s.edit(n.id, { body: "1" });
  const orig = d.api.create;
  d.api.create = async (name, text) => {
    s.edit(n.id, { body: "12" }); // 올리는 도중에 고침
    return orig(name, text);
  };
  await s.sync();
  d.api.create = orig;
  assert.equal(s.get(n.id).dirty, true, "고친 게 남아 있음");
  await s.sync();
  assert.equal([...d.files.values()][0].text, "12");
  assert.equal(d.files.size, 1, "새로 만들지 않고 같은 파일을 고침");
  assert.equal(s.get(n.id).dirty, false);
});

test("다른 기기에서 쓴 노트가 목록에 뜨고, 열 때 내용을 받는다", async () => {
  const d = fakeDrive();
  d.otherDevice.add("노트북에서 쓴 노트.txt", "노트북 내용");
  const { s } = newStore();
  s.setBackend(d.api);
  await s.sync();
  const [n] = s.getSnapshot().notes;
  assert.equal(n.title, "노트북에서 쓴 노트");
  assert.equal(n.body, null);
  assert.equal(await s.load(n.id), "노트북 내용");
  assert.equal(s.get(n.id).body, "노트북 내용");
});

test("이 기기에서 안 고쳤으면 다른 기기 판으로 바뀐다", async () => {
  const d = fakeDrive();
  const { s } = newStore();
  s.setBackend(d.api);
  const n = s.create("영어");
  s.edit(n.id, { body: "v1" });
  await s.sync();
  const rid = s.get(n.id).remote.id;
  d.otherDevice.write(rid, "영어 단어.txt", "v2(노트북)");
  await s.sync();
  assert.equal(s.get(n.id).title, "영어 단어");
  assert.equal(s.get(n.id).body, null, "다시 받게 비움");
  assert.equal(await s.load(n.id), "v2(노트북)");
});

test("두 기기에서 같이 고쳤으면 둘 다 남긴다", async () => {
  const d = fakeDrive();
  const { s } = newStore();
  s.setBackend(d.api);
  const n = s.create("국어");
  s.edit(n.id, { body: "처음" });
  await s.sync();
  const rid = s.get(n.id).remote.id;
  d.otherDevice.write(rid, "국어.txt", "노트북에서 고침");
  s.edit(n.id, { body: "폰에서 고침" });
  await s.sync();
  const notes = s.getSnapshot().notes;
  assert.equal(notes.length, 2);
  assert.equal(d.files.size, 2, "서버에도 둘 다");
  const texts = [...d.files.values()].map((f) => f.text).sort();
  assert.deepEqual(texts, ["노트북에서 고침", "폰에서 고침"]);
  assert.ok(s.get(n.id).title.endsWith("(이 기기)"));
});

test("드라이브에서 지운 노트 — 안 고쳤으면 사라지고, 고친 게 있으면 다시 올린다", async () => {
  const d = fakeDrive();
  const { s } = newStore();
  s.setBackend(d.api);
  const a = s.create("A");
  s.edit(a.id, { body: "a" });
  const b = s.create("B");
  s.edit(b.id, { body: "b" });
  await s.sync();
  d.files.clear();
  s.edit(b.id, { body: "b 고침" });
  await s.sync();
  assert.equal(s.get(a.id), undefined);
  assert.equal(s.get(b.id).body, "b 고침");
  assert.equal(d.files.size, 1);
  assert.equal([...d.files.values()][0].text, "b 고침");
});

test("지우면 드라이브에서도 지운다(인터넷 없을 땐 나중에)", async () => {
  const d = fakeDrive();
  const { s, online } = newStore();
  s.setBackend(d.api);
  const n = s.create("지울 노트");
  s.edit(n.id, { body: "x" });
  await s.sync();
  online.v = false;
  s.remove(n.id);
  await s.sync();
  assert.equal(s.getSnapshot().notes.length, 0, "화면에선 바로 사라짐");
  assert.equal(d.files.size, 1, "서버엔 아직");
  online.v = true;
  await s.sync();
  assert.equal(d.files.size, 0);
});

test("서버 오류는 상태로 알리고, 다음에 다시 하면 올라간다", async () => {
  const d = fakeDrive();
  const { s } = newStore();
  s.setBackend(d.api);
  const n = s.create();
  s.edit(n.id, { body: "x" });
  d.failOnce(new Error("드라이브 용량이 모자라요."));
  await s.sync();
  assert.equal(s.getSnapshot().status, "error");
  assert.equal(s.getSnapshot().message, "드라이브 용량이 모자라요.");
  await s.sync();
  assert.equal(s.getSnapshot().status, "idle");
  assert.equal(d.files.size, 1);
});

test("앱을 다시 열어도 이 기기에 저장한 노트가 남아 있다", async () => {
  const storage = memStorage();
  const { s } = newStore({ storage, online: { v: false } });
  const n = s.create("오프라인 노트");
  s.edit(n.id, { body: "비행기 안에서 씀" });
  s.dispose();
  const again = new NotesStore(storage, { isOnline: () => true });
  assert.equal(again.get(n.id).body, "비행기 안에서 씀");
  assert.equal(again.get(n.id).dirty, true);
  const d = fakeDrive();
  again.setBackend(d.api);
  await again.sync();
  assert.equal(d.files.size, 1);
});

test("저장된 값이 망가져 있어도 열린다", () => {
  const s = new NotesStore({ load: () => ({ nope: 1 }), save: () => {} });
  assert.equal(s.getSnapshot().notes.length, 0);
  const s2 = new NotesStore({ load: () => [{ id: "x", title: "t", body: 3 }, null, 5], save: () => {} });
  assert.equal(s2.getSnapshot().notes.length, 1);
  assert.equal(s2.get("x").body, null);
});

test("아무것도 안 쓴 새 노트 — 제목만 바꿨으면 남긴다", async () => {
  const d = fakeDrive();
  const { s } = newStore();
  s.setBackend(d.api);
  const n = s.create();
  assert.equal(isUntouched(s.get(n.id)), true);
  s.edit(n.id, { title: "단어장" });
  assert.equal(isUntouched(s.get(n.id)), false);
  s.discardIfEmpty(n.id);
  assert.ok(s.get(n.id), "제목만 쓴 노트는 안 치움");
  await s.sync();
  assert.equal([...d.files.values()][0]?.name, "단어장.txt");
});

test("로그인 전에 쓴 노트는 로그인한 계정으로 옮겨 올린다", async () => {
  const d = fakeDrive();
  const local = newStore().s;
  const a = local.create("비행기에서");
  local.edit(a.id, { body: "오프라인 노트" });
  local.create(); // 빈 새 노트는 안 옮김
  const { s: mine } = newStore();
  assert.equal(mine.importFrom(local), 1);
  assert.equal(local.getSnapshot().notes.length, 1, "옮긴 노트는 이 기기 칸에서 빠짐");
  mine.setBackend(d.api);
  await mine.sync();
  assert.equal([...d.files.values()][0]?.text, "오프라인 노트");
  assert.equal(mine.importFrom(local), 0, "두 번 옮기지 않음");
});

test("올리다 끊겨 시각만 바뀐 판은 가짜 충돌 사본을 안 만든다", async () => {
  const d = fakeDrive();
  const { s } = newStore();
  s.setBackend(d.api);
  const n = s.create("영어");
  s.edit(n.id, { body: "같은 내용" });
  await s.sync();
  const rid = s.get(n.id).remote.id;
  d.otherDevice.touch(rid); // 내용은 그대로, 시각만
  s.edit(n.id, { body: "같은 내용" }); // 이 기기에선 고친 걸로 남아 있음
  await s.sync();
  assert.equal(s.getSnapshot().notes.length, 1, "사본 없음");
  assert.equal(d.files.size, 1);
  assert.ok(!s.get(n.id).title.includes("(이 기기)"));
});

test("올리는 순간 다른 기기가 먼저 고쳤으면(서버가 거절) 둘 다 남긴다", async () => {
  const d = fakeDrive();
  const { s } = newStore();
  s.setBackend(d.api);
  const n = s.create("국어");
  s.edit(n.id, { body: "처음" });
  await s.sync();
  const rid = s.get(n.id).remote.id;
  s.edit(n.id, { body: "폰에서 고침" });
  // 목록을 받은 뒤, 올리기 직전에 노트북이 고친다
  const origList = d.api.list;
  d.api.list = async () => {
    const out = await origList();
    d.otherDevice.write(rid, "국어.txt", "노트북에서 고침");
    return out;
  };
  await s.sync();
  d.api.list = origList;
  await s.sync();
  const texts = [...d.files.values()].map((f) => f.text).sort();
  assert.deepEqual(texts, ["노트북에서 고침", "폰에서 고침"]);
  assert.equal(s.getSnapshot().notes.length, 2);
  assert.ok(s.get(n.id).title.endsWith("(이 기기)"));
});

test("내용을 아직 안 받은 노트는 서버 판으로 맞춘다(사본 안 만듦)", async () => {
  const d = fakeDrive();
  const rid = d.otherDevice.add("노트북.txt", "v1");
  const { s } = newStore();
  s.setBackend(d.api);
  await s.sync();
  const [n] = s.getSnapshot().notes;
  assert.equal(n.body, null);
  d.otherDevice.write(rid, "노트북 고침.txt", "v2");
  await s.sync();
  assert.equal(s.getSnapshot().notes.length, 1);
  assert.equal(s.get(n.id).title, "노트북 고침");
  assert.equal(s.getSnapshot().pending, 0);
});

test("드라이브 화면에서 열 때 더 새 판이면 다시 받는다", async () => {
  const d = fakeDrive();
  const { s } = newStore();
  s.setBackend(d.api);
  const n = s.create("수학");
  s.edit(n.id, { body: "v1" });
  await s.sync();
  const rid = s.get(n.id).remote.id;
  d.otherDevice.write(rid, "수학.txt", "v2");
  const f = d.files.get(rid);
  const got = s.adopt({ id: rid, name: f.name, at: f.at });
  assert.equal(got.id, n.id);
  assert.equal(s.get(n.id).body, null, "다시 받게 비움");
  assert.equal(await s.load(n.id), "v2");
});

test("다른 탭이 저장한 노트를 합친다(지운 건 안 살림)", async () => {
  const storage = memStorage();
  const { s: tab1 } = newStore({ storage });
  const { s: tab2 } = newStore({ storage });
  const a = tab1.create("탭1 노트");
  tab1.edit(a.id, { body: "1" });
  tab2.absorb(storage.peek());
  assert.equal(tab2.get(a.id)?.body, "1");
  tab2.edit(a.id, { body: "1+2" });
  tab1.absorb(storage.peek());
  assert.equal(tab1.get(a.id).body, "1+2", "더 많이 고친 쪽");
  const b = tab1.create("지울 노트");
  tab1.edit(b.id, { body: "x" });
  tab1.remove(b.id);
  tab1.absorb([...JSON.parse(JSON.stringify(storage.peek())), { ...tab1.getSnapshot().notes[0], id: b.id, title: "지울 노트", body: "x", rev: 9 }]);
  assert.equal(tab1.get(b.id), undefined, "이 탭에서 지운 건 안 살아남");
});

test("이 기기에 저장 못 하면(공간 부족) 알린다", () => {
  let full = false;
  const s = new NotesStore({ load: () => null, save: () => { if (full) throw new Error("QuotaExceededError"); } });
  const n = s.create();
  assert.equal(s.getSnapshot().saveFailed, false);
  full = true;
  s.edit(n.id, { body: "x" });
  assert.equal(s.getSnapshot().saveFailed, true);
  full = false;
  s.edit(n.id, { body: "xy" });
  assert.equal(s.getSnapshot().saveFailed, false);
});
