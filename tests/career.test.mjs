// 커리어 기록 공용·한 번에 넣기(미리보기). npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { careerPeriod, normText, toDrafts, unusedLines } from "../src/lib/career.ts";

test("기간 글자 — 하루·달·해·범위·진행 중", () => {
  const p = (start_day, end_day) => careerPeriod({ start_day, end_day });
  assert.equal(p("2025-09-09", "2025-09-09"), "2025.09.09");
  assert.equal(p("2026-03-01", "2026-03-31"), "2026.03");
  assert.equal(p("2024-02-01", "2024-02-29"), "2024.02");
  assert.equal(p("2026-03-01", "2026-06-30"), "2026.03 ~ 2026.06");
  assert.equal(p("2025-01-01", "2025-12-31"), "2025");
  assert.equal(p("2024-01-01", "2025-12-31"), "2024 ~ 2025");
  assert.equal(p("2025-07-22", "2025-08-11"), "2025.07.22 ~ 2025.08.11");
  assert.equal(p("2025-09-01", "2025-09-25"), "2025.09.01 ~ 2025.09.25");
  assert.equal(p("2025-07-01", null), "2025.07 ~ 진행 중");
  assert.equal(p("2025-07-15", null), "2025.07.15 ~ 진행 중");
});

const TEXT = `커리어 정리 (2024.03 ~ 2026.10)

한빛대학교 컴퓨터공학과 3학년 · 관심 분야: 백엔드, 데이터 엔지니어링

프로젝트
캠퍼스 중고거래 앱, 2025.03 ~ 2025.06
Spring Boot와 MySQL로 거래 API 구현, 사용자 120명
자격증
시기\t항목\t결과
2025.08\t정보처리기사\t합격
2026.01\tTOEIC\t880점
|---|---|---|
학생 활동
학과 학생회: 2024.03~`;

const entries = [
  { title: "캠퍼스 중고거래 앱", raw: "캠퍼스 중고거래 앱, 2025.03 ~ 2025.06\nSpring Boot와 MySQL로 거래 API 구현, 사용자 120명", skills: ["Spring Boot", "MySQL"] },
  { title: "정보처리기사", raw: "2025.08 · 정보처리기사 · 합격", skills: [] },
  { title: "TOEIC 880점", raw: "2026.01 · TOEIC · 880점", skills: [] },
  { title: "학과 학생회", raw: "학과 학생회: 2024.03~", skills: [] },
];

test("빠진 줄 — 머리글·표 머리·구분선은 빼고, 아무 항목에도 없는 줄만", () => {
  assert.deepEqual(unusedLines(TEXT, entries), ["한빛대학교 컴퓨터공학과 3학년 · 관심 분야: 백엔드, 데이터 엔지니어링"]);
});

test("빠진 줄 — AI 가 항목 하나를 통째로 빠뜨리면 그 줄들이 나온다", () => {
  const out = unusedLines(TEXT, entries.slice(1));
  assert.ok(out.includes("캠퍼스 중고거래 앱, 2025.03 ~ 2025.06"));
  assert.ok(out.includes("Spring Boot와 MySQL로 거래 API 구현, 사용자 120명"));
});

test("빠진 줄 — 마크다운 머리글·글머리표", () => {
  const md = "# 이력\n## 경력\n- 2024.03 ~ 2025.02 ABC 백엔드 인턴\n  - 결제 API 개발\n### 수상\n* 2025 해커톤 대상";
  const got = [
    { title: "ABC 백엔드 인턴", raw: "- 2024.03 ~ 2025.02 ABC 백엔드 인턴\n  - 결제 API 개발", skills: [] },
    { title: "2025 해커톤 대상", raw: "* 2025 해커톤 대상", skills: [] },
  ];
  assert.deepEqual(unusedLines(md, got), []);
  assert.deepEqual(unusedLines(md, got.slice(0, 1)), ["* 2025 해커톤 대상"]);
});

test("빠진 줄 — 표 칸을 ' · ' 로 이어 붙여도 들어간 것으로 본다", () => {
  assert.deepEqual(unusedLines("2025.08\t정보처리기사\t합격", [{ title: "정보처리기사", raw: "정보처리기사 · 합격", skills: [] }]), []);
});

test("비교용 글자 — 띄어쓰기·문장부호·대소문자 무시", () => {
  assert.equal(normText("TOEIC  880점 (2026.01)"), normText("toeic 880점 2026 01"));
});

test("초안 — 같은 제목·시작일이나 같은 내용의 기록이 있으면 '이미 있음'으로 빼 둠", () => {
  const existing = [
    { id: "a", title: "정보처리기사", start_day: "2025-08-01", raw: "", deleted_at: null },
    { id: "b", title: "다른 제목", start_day: "2024-01-01", raw: "학과 학생회: 2024.03~", deleted_at: null },
    { id: "c", title: "TOEIC 880점", start_day: "2026-01-01", raw: "", deleted_at: "2026-10-01T00:00:00Z" },
  ];
  const list = [
    { title: "정보처리기사", kind: "cert", start_day: "2025-08-01", end_day: "2025-08-31", raw: "2025.08 · 정보처리기사 · 합격", skills: [], date_guess: false },
    { title: "학과 학생회", kind: "activity", start_day: "2024-03-01", end_day: null, raw: "학과 학생회: 2024.03~", skills: [], date_guess: false },
    { title: "TOEIC 880점", kind: "cert", start_day: "2026-01-01", end_day: "2026-01-31", raw: "2026.01 · TOEIC · 880점", skills: [], date_guess: false },
  ];
  const d = toDrafts(list, existing);
  assert.deepEqual(d.map((x) => [x.dup, x.on]), [[true, false], [true, false], [false, true]]);
  assert.equal(new Set(d.map((x) => x.key)).size, 3);
});
