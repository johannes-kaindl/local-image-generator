// f32↔f16-Konvertierung über DataView-Bit-Tricks — die fp16-ONNX-Tensoren sind
// Uint16Array; JS-seitige Mathematik läuft in f32 (Spec §5).
const buf = new ArrayBuffer(4);
const dv = new DataView(buf);

export function f32ToF16(x: number): number {
  dv.setFloat32(0, x);
  const bits = dv.getUint32(0);
  const sign = (bits >>> 16) & 0x8000;
  let exp = (bits >>> 23) & 0xff;
  let mant = bits & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // Inf/NaN
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00; // Überlauf → Inf
  if (e <= 0) {
    if (e < -10) return sign; // → 0
    mant |= 0x800000;
    const shift = 14 - e;
    const half = (mant >> shift) + ((mant >> (shift - 1)) & 1); // round-to-nearest
    return sign | half;
  }
  const half = (e << 10) | (mant >> 13);
  return sign | (half + ((mant >> 12) & 1)); // round-to-nearest
}

export function f16ToF32(h: number): number {
  const sign = (h & 0x8000) << 16;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  let bits: number;
  if (exp === 0) {
    if (mant === 0) bits = sign;
    else {
      // subnormal → normalisieren
      let e = -1;
      let m = mant;
      do { e++; m <<= 1; } while ((m & 0x400) === 0);
      bits = sign | ((127 - 15 - e) << 23) | ((m & 0x3ff) << 13);
    }
  } else if (exp === 0x1f) {
    bits = sign | 0x7f800000 | (mant << 13);
  } else {
    bits = sign | ((exp - 15 + 127) << 23) | (mant << 13);
  }
  dv.setUint32(0, bits);
  return dv.getFloat32(0);
}

export function f32ArrayToF16(a: Float32Array): Uint16Array {
  const out = new Uint16Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = f32ToF16(a[i]!);
  return out;
}

export function f16ArrayToF32(a: Uint16Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = f16ToF32(a[i]!);
  return out;
}
