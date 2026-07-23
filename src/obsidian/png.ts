// Base64-PNG-DataURL → Bytes für vault.createBinary (Spec §6-Abweichung: der Server
// liefert bereits fertiges PNG, ein Encoder entfällt — nur dieser Decode bleibt nötig).
export function dataUrlToBytes(dataUrl: string): ArrayBuffer {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
