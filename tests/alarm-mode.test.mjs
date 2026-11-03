// 알람 방식(소리 / 진동 / 무음) — 무엇을 낼지. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { alarmOutput, DEFAULT_SETTINGS, mergeSettings } from "../src/lib/settings.ts";

test("기본은 소리 — 예전과 같다(소리 + 읽어 주기 + 진동, 깜빡임 없음)", () => {
  assert.equal(DEFAULT_SETTINGS.alarmMode, "sound");
  assert.deepEqual(alarmOutput(DEFAULT_SETTINGS), { sound: true, voice: true, vibration: "heartbeat", flash: false });
  assert.equal(alarmOutput({ ...DEFAULT_SETTINGS, speak: false }).voice, false);
});

test("진동 — 소리·읽어 주기 없이 진동 + 화면 깜빡임, 진동 패턴이 '없음'이어도 진동", () => {
  assert.deepEqual(alarmOutput({ ...DEFAULT_SETTINGS, alarmMode: "vibrate" }), { sound: false, voice: false, vibration: "heartbeat", flash: true });
  assert.equal(alarmOutput({ ...DEFAULT_SETTINGS, alarmMode: "vibrate", vibration: "sos" }).vibration, "sos");
  assert.equal(alarmOutput({ ...DEFAULT_SETTINGS, alarmMode: "vibrate", vibration: "none" }).vibration, "heartbeat");
});

test("무음 — 소리·읽어 주기·진동 없이 화면만", () => {
  assert.deepEqual(alarmOutput({ ...DEFAULT_SETTINGS, alarmMode: "silent", speak: true }), { sound: false, voice: false, vibration: "none", flash: true });
});

test("계정에 저장된 설정을 읽을 때 — 없거나 이상한 값이면 소리", () => {
  assert.equal(mergeSettings({}).alarmMode, "sound");
  assert.equal(mergeSettings({ alarmMode: "silent" }).alarmMode, "silent");
  assert.equal(mergeSettings({ alarmMode: "loud" }).alarmMode, "sound");
});
