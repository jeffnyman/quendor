/**
 * Minimal AIFF decoder for Blorb sound resources.
 *
 * Infocom's sound Blorbs (The Lurking Horror, Sherlock) store each effect as an
 * uncompressed AIFF (`FORM`/`AIFF`) — mono, 8- or 16-bit signed PCM. This decodes
 * one into normalized float samples plus its sample rate, ready to drop into a
 * Web Audio `AudioBuffer`. Compressed AIFF-C (`AIFC`) is not handled (these files
 * don't use it); such input yields `null`.
 */

export interface DecodedAudio {
  sampleRate: number;
  channels: number;
  /** Interleaved samples in [-1, 1). */
  samples: Float32Array;
  frames: number;
}

function fourCC(b: Uint8Array, p: number): string {
  return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
}

/** Decode an 80-bit IEEE 754 extended float (AIFF sample rate) to a number. */
function extended80(view: DataView, p: number): number {
  const exp = ((view.getUint8(p) & 0x7f) << 8) | view.getUint8(p + 1);
  const hi = view.getUint32(p + 2);
  const lo = view.getUint32(p + 6);
  const mantissa = hi * 2 ** 32 + lo; // 64-bit integer mantissa (with integer bit)

  if (exp === 0 && mantissa === 0) return 0;

  const sign = view.getUint8(p) & 0x80 ? -1 : 1;

  return sign * mantissa * 2 ** (exp - 16383 - 63);
}

export function decodeAiff(bytes: Uint8Array): DecodedAudio | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (fourCC(bytes, 0) !== "FORM") return null;

  const formType = fourCC(bytes, 8);

  if (formType !== "AIFF" && formType !== "AIFC") return null;

  let channels = 1,
    frames = 0,
    bits = 8,
    sampleRate = 8000;
  let ssndData = -1,
    ssndBytes = 0,
    compressed = false;

  const end = Math.min(bytes.length, 8 + view.getUint32(4));
  let p = 12;

  while (p + 8 <= end) {
    const id = fourCC(bytes, p);
    const len = view.getUint32(p + 4);

    if (id === "COMM") {
      channels = view.getUint16(p + 8);
      frames = view.getUint32(p + 10);
      bits = view.getUint16(p + 14);
      sampleRate = extended80(view, p + 16);
      if (len > 18 && fourCC(bytes, p + 26) !== "NONE") compressed = true;
    } else if (id === "SSND") {
      // SSND: offset(4) + blockSize(4), then the frames.
      const offset = view.getUint32(p + 8);
      ssndData = p + 8 + 8 + offset;
      ssndBytes = len - 8 - offset;
    }

    p += 8 + len + (len % 2); // chunks are word-aligned
  }

  if (compressed || ssndData < 0 || sampleRate <= 0) return null;

  const total = channels * frames;
  const out = new Float32Array(total);

  if (bits === 8) {
    for (let i = 0; i < total && ssndData + i < bytes.length; i++) {
      out[i] = ((bytes[ssndData + i] << 24) >> 24) / 128; // signed 8-bit → [-1,1)
    }
  } else if (bits === 16) {
    for (let i = 0; i < total && ssndData + i * 2 + 1 < bytes.length; i++) {
      out[i] = view.getInt16(ssndData + i * 2) / 32768; // big-endian signed 16-bit
    }
  } else {
    return null; // unusual bit depth
  }

  void ssndBytes;

  return { sampleRate, channels, samples: out, frames };
}
