import { expect, test } from "vite-plus/test";
import { decodeAiff } from "../src/aiff.ts";

function writeFourCC(bytes: Uint8Array, offset: number, code: string): void {
  for (let i = 0; i < 4; i++) bytes[offset + i] = code.charCodeAt(i);
}

// 8000 Hz as an 80-bit IEEE-754 extended float (exp 0x400B, mantissa 0xFA000000_00000000).
const RATE_8000 = [0x40, 0x0b, 0xfa, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
const RATE_ZERO = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// COMM payload: channels(2) frames(4) bits(2) sampleRate(10-byte extended), plus
// an optional 4CC compression type (present only in AIFF-C).
function commData(
  channels: number,
  frames: number,
  bits: number,
  rate80: number[],
  compression?: string,
): Uint8Array {
  const d = new Uint8Array(18 + (compression ? 4 : 0));
  const v = new DataView(d.buffer);

  v.setUint16(0, channels);
  v.setUint32(2, frames);
  v.setUint16(6, bits);
  d.set(rate80, 8);
  if (compression) writeFourCC(d, 18, compression);

  return d;
}

// SSND payload: offset(4)=0, blockSize(4)=0, then the raw sample frames.
function ssndData(samples: Uint8Array): Uint8Array {
  const d = new Uint8Array(8 + samples.length);
  d.set(samples, 8);
  return d;
}

function chunk(id: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2;
  const c = new Uint8Array(8 + data.length + pad);

  writeFourCC(c, 0, id);
  new DataView(c.buffer).setUint32(4, data.length);
  c.set(data, 8);

  return c;
}

function buildForm(formType: string, chunks: Uint8Array[]): Uint8Array {
  const body = chunks.reduce((n, c) => n + c.length, 0);
  const form = new Uint8Array(12 + body);

  writeFourCC(form, 0, "FORM");
  new DataView(form.buffer).setUint32(4, 4 + body);
  writeFourCC(form, 8, formType);

  let off = 12;
  for (const c of chunks) {
    form.set(c, off);
    off += c.length;
  }

  return form;
}

function aiff(comm: Uint8Array, ssnd: Uint8Array, formType = "AIFF"): Uint8Array {
  return buildForm(formType, [chunk("COMM", comm), chunk("SSND", ssnd)]);
}

test("decodeAiff returns null for non-FORM bytes", () => {
  expect(decodeAiff(new Uint8Array(20).fill(0x42))).toBeNull();
});

test("decodeAiff returns null for a FORM that is not AIFF/AIFC", () => {
  const bytes = buildForm("WAVE", [chunk("COMM", commData(1, 0, 8, RATE_8000))]);

  expect(decodeAiff(bytes)).toBeNull();
});

test("decodeAiff decodes 8-bit signed mono PCM to [-1, 1)", () => {
  // 0 -> 0, 64 -> 0.5, 192 (signed -64) -> -0.5
  const bytes = aiff(commData(1, 3, 8, RATE_8000), ssndData(new Uint8Array([0, 64, 192])));
  const d = decodeAiff(bytes);

  expect(d?.sampleRate).toBe(8000);
  expect(d?.channels).toBe(1);
  expect(d?.frames).toBe(3);
  expect(Array.from(d?.samples ?? [])).toEqual([0, 0.5, -0.5]);
});

test("decodeAiff decodes 16-bit big-endian signed PCM", () => {
  // 0x4000 = 16384 -> 0.5 ; 0xC000 = -16384 -> -0.5
  const bytes = aiff(
    commData(1, 2, 16, RATE_8000),
    ssndData(new Uint8Array([0x40, 0x00, 0xc0, 0x00])),
  );

  expect(Array.from(decodeAiff(bytes)?.samples ?? [])).toEqual([0.5, -0.5]);
});

test("decodeAiff returns null for a compressed AIFF-C", () => {
  const bytes = aiff(commData(1, 1, 8, RATE_8000, "sowt"), ssndData(new Uint8Array([1])), "AIFC");

  expect(decodeAiff(bytes)).toBeNull();
});

test("decodeAiff returns null when the sample rate is zero", () => {
  const bytes = aiff(commData(1, 1, 8, RATE_ZERO), ssndData(new Uint8Array([1])));

  expect(decodeAiff(bytes)).toBeNull();
});

test("decodeAiff returns null for an unsupported bit depth", () => {
  const bytes = aiff(commData(1, 1, 24, RATE_8000), ssndData(new Uint8Array([1, 2, 3])));

  expect(decodeAiff(bytes)).toBeNull();
});
