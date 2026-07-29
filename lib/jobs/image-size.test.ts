import { describe, expect, it } from "vitest";
import { imageSize } from "./image-size";

/** 최소 PNG 헤더 (시그니처 + IHDR). */
function png(w: number, h: number): Buffer {
  const buf = Buffer.alloc(24);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  buf.writeUInt32BE(13, 8);
  buf.writeUInt32BE(0x49484452, 12);
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

/** SOI + APP0(JFIF) + SOF0. */
function jpeg(w: number, h: number): Buffer {
  const app0 = Buffer.alloc(2 + 16);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2);
  app0.write("JFIF\0", 4, "ascii");
  const sof = Buffer.alloc(2 + 17);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

function gif(w: number, h: number): Buffer {
  const buf = Buffer.alloc(13);
  buf.write("GIF89a", 0, "ascii");
  buf.writeUInt16LE(w, 6);
  buf.writeUInt16LE(h, 8);
  return buf;
}

/** RIFF/WEBP VP8X (확장 청크). */
function webp(w: number, h: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "ascii");
  buf.write("WEBP", 8, "ascii");
  buf.write("VP8X", 12, "ascii");
  buf.writeUIntLE(w - 1, 24, 3);
  buf.writeUIntLE(h - 1, 27, 3);
  return buf;
}

describe("imageSize", () => {
  it("reads PNG · JPEG · GIF · WEBP headers", () => {
    expect(imageSize(png(700, 2207))).toEqual({ w: 700, h: 2207 });
    expect(imageSize(jpeg(1400, 770))).toEqual({ w: 1400, h: 770 });
    expect(imageSize(gif(1, 1))).toEqual({ w: 1, h: 1 });
    expect(imageSize(webp(640, 480))).toEqual({ w: 640, h: 480 });
  });

  it("skips JPEG segments before the frame header", () => {
    // EXIF(APP1) 같은 앞선 세그먼트를 길이만큼 건너뛰어야 SOF에 닿는다.
    const app1 = Buffer.alloc(2 + 40);
    app1.writeUInt16BE(0xffe1, 0);
    app1.writeUInt16BE(40, 2);
    const j = jpeg(300, 200);
    expect(imageSize(Buffer.concat([j.subarray(0, 2), app1, j.subarray(2)]))).toEqual({
      w: 300,
      h: 200,
    });
  });

  it("returns null for junk, truncated, or zero-sized data", () => {
    expect(imageSize(Buffer.from("not an image at all"))).toBeNull();
    expect(imageSize(Buffer.alloc(0))).toBeNull();
    expect(imageSize(png(700, 2207).subarray(0, 16))).toBeNull();
    expect(imageSize(png(0, 0))).toBeNull();
  });
});
