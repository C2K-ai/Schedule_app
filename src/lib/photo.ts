// 일정 사진(시간표·공지 등)을 AI 에 보내기 전에 줄인다 — 긴 변 1568px(Claude 가 그대로 읽는 최대 크기), JPEG.
// 폰 사진(4~12MB)이 보통 0.3~0.6MB 가 되어 빨리 올라가고 비용도 적다.

const MAX_EDGE = 1568;

export interface Photo {
  media_type: "image/jpeg";
  /** base64(머리말 data:… 없이) */
  data: string;
  /** 미리보기용 data URL */
  preview: string;
}

export async function shrinkPhoto(file: File): Promise<Photo> {
  if (!file.type.startsWith("image/")) throw new Error("사진 파일만 넣을 수 있어요.");
  // 폰 사진의 가로·세로 방향(EXIF)도 맞춰서 읽는다
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("사진을 읽지 못했어요. 다른 사진으로 해 보세요.");
  });
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)),
    h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("사진을 줄이지 못했어요.");
  g.fillStyle = "#fff"; // 투명 PNG 도 흰 바탕으로
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const preview = c.toDataURL("image/jpeg", 0.85);
  return { media_type: "image/jpeg", data: preview.slice(preview.indexOf(",") + 1), preview };
}
