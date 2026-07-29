/**
 * 이미지 파일 헤더에서 픽셀 크기를 읽는다 — 품질 게이트의 이미지 검사가
 * 마크업에 의존하지 않게 하기 위한 최소 구현.
 *
 * 이메일 HTML의 전폭 이미지는 보통 `width="700" style="height:auto"` 형태라
 * height 속성이 없다(실측: 레퍼런스 발송본의 히어로·배너). 태그만 보면 세로비를
 * 알 수 없어 슬라이스 검사가 통째로 무력화되므로, 파일에서 직접 읽는다.
 */

export interface ImageSize {
  w: number;
  h: number;
}

/** PNG/JPEG/GIF/WEBP 헤더에서 크기를 읽는다. 해석 불가면 null. */
export function imageSize(buf: Buffer): ImageSize | null {
  return png(buf) ?? jpeg(buf) ?? gif(buf) ?? webp(buf);
}

function ok(w: number, h: number): ImageSize | null {
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
}

/** 시그니처 8B + 길이/타입 8B + W4B + H4B. */
function png(buf: Buffer): ImageSize | null {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return ok(buf.readUInt32BE(16), buf.readUInt32BE(20));
}

/** SOF 세그먼트(0xC0~0xCF, DHT/JPG/DAC 제외)의 프레임 헤더에서 크기를 읽는다. */
function jpeg(buf: Buffer): ImageSize | null {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1; // 패딩(0xFF 반복)·손상 구간 건너뛰기
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // 길이 없는 마커: 시작/끝(D8·D9)과 리스타트(D0~D7).
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) return ok(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5));
    if (marker === 0xda) return null; // 스캔 시작 — 이후엔 헤더가 없다
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** "GIF8" + 논리 화면 폭/높이 (리틀엔디언 16bit). */
function gif(buf: Buffer): ImageSize | null {
  if (buf.length < 10 || buf.toString("ascii", 0, 4) !== "GIF8") return null;
  return ok(buf.readUInt16LE(6), buf.readUInt16LE(8));
}

/** RIFF/WEBP — VP8X(확장) · VP8(손실) · VP8L(무손실) 세 형태. */
function webp(buf: Buffer): ImageSize | null {
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") return ok(1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3));
  if (chunk === "VP8 ") return ok(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
  if (chunk === "VP8L" && buf[20] === 0x2f) {
    const bits = buf.readUInt32LE(21);
    return ok(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff));
  }
  return null;
}
