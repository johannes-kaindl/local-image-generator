import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Sha256, sha256Hex } from "../src/vendor/kit/sha256";

describe("Sha256", () => {
  it("leerer Input hat den bekannten Digest", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("'abc' stimmt mit dem NIST-Vektor überein", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("chunkweise == am Stück, auch über Blockgrenzen (1 MB, ungerade Chunks)", () => {
    const data = new Uint8Array(1_000_003);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 0xff;
    const h = new Sha256();
    for (let off = 0; off < data.length; off += 65_537) h.update(data.subarray(off, Math.min(off + 65_537, data.length)));
    expect(h.digestHex()).toBe(createHash("sha256").update(data).digest("hex"));
  });
  it("Länge ≥ 2^32 Bit wird korrekt in die 64-Bit-Länge kodiert (600 MB-Simulation über Länge)", () => {
    // 2^29 Bytes = 2^32 Bit — der Überlauf des unteren Längenworts. Statt 512 MB zu hashen wird der
    // Zähler direkt gesetzt: gleicher Codepfad wie ein echter Lauf, gleiche Erwartung wie node:crypto
    // für 2^29 Null-Bytes.
    const h = new Sha256();
    const chunk = new Uint8Array(1 << 20);
    for (let i = 0; i < 512; i++) h.update(chunk);
    const ref = createHash("sha256");
    for (let i = 0; i < 512; i++) ref.update(chunk);
    expect(h.digestHex()).toBe(ref.digest("hex"));
  });
  it("digestHex ist einmalig", () => {
    const h = new Sha256();
    h.digestHex();
    expect(() => h.digestHex()).toThrow();
  });
});
