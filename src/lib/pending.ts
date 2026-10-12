// 화면 사이에 '이걸 열어 줘' 부탁을 넘긴다 — 사진 버튼·공유받은 사진 → Write, Write·메뉴 → 캘린더 '시간표'.
// 받는 쪽은 처음 그릴 때 peek 으로 보고, 다 쓰면 clear 한다(이미 떠 있는 화면은 이벤트를 듣는다).

import type { Photo } from "./photo";

let writePhoto: Photo | null = null;

/** Write 창이 열리면서 채울 사진 */
export const pendingWritePhoto = {
  set: (p: Photo) => void (writePhoto = p),
  peek: () => writePhoto,
  clear: () => void (writePhoto = null),
};

export interface TimetableRequest {
  /** 사진으로 넣기 창까지 열지(사진이 있으면 그 사진으로) */
  import: boolean;
  photo: Photo | null;
}
let timetable: TimetableRequest | null = null;

/** 캘린더 탭 → 시간표 보기로 가라는 이벤트(Shell·CalendarTab·TimetableView 가 듣는다) */
export const OPEN_TIMETABLE = "dream:open-timetable";

export const pendingTimetable = {
  peek: () => timetable,
  clear: () => void (timetable = null),
};

/** 캘린더 '시간표'를 연다 — import 면 '사진으로 넣기'까지(사진이 있으면 그 사진으로 바로) */
export function openTimetable(req: TimetableRequest) {
  timetable = req;
  window.dispatchEvent(new Event(OPEN_TIMETABLE));
}
