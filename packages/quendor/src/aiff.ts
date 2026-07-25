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

interface AiffFormat {
  channels: number;
  frames: number;
  bits: number;
  sampleRate: number;
  /** Byte offset of the first sample frame, or -1 if there was no SSND chunk. */
  ssndData: number;
  compressed: boolean;
}

/** Read the COMM (format) and SSND (samples) chunks from an AIFF FORM body. */
function readAiffChunks(bytes: Uint8Array, view: DataView): AiffFormat {
  const fmt: AiffFormat = {
    channels: 1,
    frames: 0,
    bits: 8,
    sampleRate: 8000,
    ssndData: -1,
    compressed: false,
  };

  const end = Math.min(bytes.length, 8 + view.getUint32(4));
  let p = 12;

  while (p + 8 <= end) {
    const id = fourCC(bytes, p);
    const len = view.getUint32(p + 4);

    if (id === "COMM") {
      fmt.channels = view.getUint16(p + 8);
      fmt.frames = view.getUint32(p + 10);
      fmt.bits = view.getUint16(p + 14);
      fmt.sampleRate = extended80(view, p + 16);
      if (len > 18 && fourCC(bytes, p + 26) !== "NONE") fmt.compressed = true;
    } else if (id === "SSND") {
      // SSND: offset(4) + blockSize(4), then the frames.
      fmt.ssndData = p + 8 + 8 + view.getUint32(p + 8);
    }

    p += 8 + len + (len % 2); // chunks are word-aligned
  }

  return fmt;
}

/** Decode `total` interleaved PCM samples to floats in [-1, 1); null if unusual bit depth. */
function decodeSamples(
  bytes: Uint8Array,
  view: DataView,
  ssndData: number,
  total: number,
  bits: number,
): Float32Array | null {
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

  return out;
}

export function decodeAiff(bytes: Uint8Array): DecodedAudio | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (fourCC(bytes, 0) !== "FORM") return null;

  const formType = fourCC(bytes, 8);

  if (formType !== "AIFF" && formType !== "AIFC") return null;

  const { channels, frames, bits, sampleRate, ssndData, compressed } = readAiffChunks(bytes, view);

  if (compressed || ssndData < 0 || sampleRate <= 0) return null;

  const samples = decodeSamples(bytes, view, ssndData, channels * frames, bits);

  if (!samples) return null;

  return { sampleRate, channels, samples, frames };
}
