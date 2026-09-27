import { describe, expect, it, vi } from "vitest";
import { PlaygroundBackend } from "../src/obsidian/playground-backend";
import type { ImageRequest } from "../src/core/txt2img";

const BASE_REQUEST: ImageRequest = {
  prompt: "a red fox in the snow",
  negativePrompt: "blurry",
  width: 512,
  height: 512,
  steps: 20,
  seed: 12345,
  cfg: null,
  initImageData: null,
  denoising: null,
};

function makeBackend(overrides?: {
  run?: (req: { input: string }) => Promise<{ ok: boolean; file?: string; reason?: string; message?: string }>;
  readBinary?: (path: string) => Promise<ArrayBuffer>;
  deleteFile?: (path: string) => Promise<void>;
  arrayBufferToBase64?: (buf: ArrayBuffer) => string;
}) {
  const readBinary = overrides?.readBinary ?? (async () => new ArrayBuffer(4));
  const deleteFile = overrides?.deleteFile ?? (async () => {});
  const arrayBufferToBase64 = overrides?.arrayBufferToBase64 ?? (() => "cGx4");
  const run =
    overrides?.run ??
    (async () => ({ ok: true, file: "attachments/lig-playground-1.png", durationMs: 100 }));
  const backend = new PlaygroundBackend(
    "Generate Image (Obsidian)",
    "attachments",
    120_000,
    { bridge: { run: run as never }, readBinary, deleteFile, arrayBufferToBase64 },
  );
  return { backend, readBinary, deleteFile, arrayBufferToBase64, run };
}

describe("PlaygroundBackend", () => {
  it("ruft die Bruecke mit Kurzbefehl-Name, Prompt als Input und dem Zielordner als expectFile-Praefix auf", async () => {
    const run = vi.fn(async () => ({ ok: true, file: "attachments/lig-playground-1.png", durationMs: 100 }));
    const { backend } = makeBackend({ run });
    await backend.generate(BASE_REQUEST);
    expect(run).toHaveBeenCalledWith({
      shortcut: "Generate Image (Obsidian)",
      input: "a red fox in the snow",
      timeoutMs: 120_000,
      expectFile: { vaultPathPrefix: "attachments" },
    });
  });

  it("liest die gefundene Datei und liefert sie base64-kodiert zurueck", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const { backend, arrayBufferToBase64 } = makeBackend({
      readBinary: async () => bytes,
      arrayBufferToBase64: () => "AQIDBA==",
    });
    const result = await backend.generate(BASE_REQUEST);
    expect(result).toBe("AQIDBA==");
    expect(arrayBufferToBase64(bytes)).toBe("AQIDBA==");
  });

  it("raeumt die vom Kurzbefehl geschriebene Datei nach dem Lesen auf (kein Duplikat im Vault)", async () => {
    const deleteFile = vi.fn(async () => {});
    const { backend } = makeBackend({ deleteFile });
    await backend.generate(BASE_REQUEST);
    expect(deleteFile).toHaveBeenCalledWith("attachments/lig-playground-1.png");
  });

  it("wirft mit Klartext, wenn die Bruecke einen Fehlschlag meldet (kein Bild wird erfunden)", async () => {
    const { backend } = makeBackend({
      run: async () => ({ ok: false, reason: "timeout", message: "kein Callback nach 120000 ms" }),
    });
    await expect(backend.generate(BASE_REQUEST)).rejects.toThrow(/timeout/);
  });

  it("wirft, wenn die Bruecke ok meldet, aber keine Datei gefunden hat", async () => {
    const { backend } = makeBackend({ run: async () => ({ ok: true, durationMs: 5 }) });
    await expect(backend.generate(BASE_REQUEST)).rejects.toThrow(/kein Bild/);
  });

  it("bricht sofort ab, wenn das Signal schon abgebrochen ist (dieselbe Wache wie A1111Client)", async () => {
    const run = vi.fn();
    const { backend } = makeBackend({ run });
    await expect(backend.generate({ ...BASE_REQUEST, signal: AbortSignal.abort() })).rejects.toThrow(/abgebrochen/);
    expect(run).not.toHaveBeenCalled();
  });

  it("ignoriert negativePrompt/cfg/width/height/steps/denoising ehrlich (Rezept-Ehrlichkeit sitzt in backendCapabilities, nicht hier)", async () => {
    const run = vi.fn(async (_req: { input: string }) => ({ ok: true as const, file: "attachments/x.png", durationMs: 1 }));
    const { backend } = makeBackend({ run });
    await backend.generate({ ...BASE_REQUEST, negativePrompt: "sollte nie ankommen", cfg: 7, width: 1024, height: 1024, denoising: 0.5 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].input).toBe(BASE_REQUEST.prompt);
  });
});
