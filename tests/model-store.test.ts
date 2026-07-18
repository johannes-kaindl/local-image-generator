import { describe, expect, it } from "vitest";
import { MODEL_FILES } from "../src/core/model-manifest";
import { ModelStore, type CacheLike, type DownloadProgress } from "../src/obsidian/model-store";

function fakeCache(): { cache: CacheLike; store: Map<string, Response> } {
  const store = new Map<string, Response>();
  return {
    store,
    cache: {
      match: async (url) => store.get(url)?.clone(),
      put: async (url, res) => {
        // Konsumieren wie die echte Cache API (streamt den Body)
        const buf = await res.arrayBuffer();
        store.set(url, new Response(buf, { headers: res.headers }));
      },
      delete: async (url) => store.delete(url),
    },
  };
}

function okResponse(body: string, contentLength?: number): Response {
  return new Response(body, {
    status: 200,
    headers: contentLength !== undefined ? { "content-length": String(contentLength) } : {},
  });
}

describe("ModelStore", () => {
  it("download lädt nur fehlende Dateien und meldet Fortschritt bis 100", async () => {
    const { cache, store } = fakeCache();
    const fetched: string[] = [];
    const s = new ModelStore({
      openCache: async () => cache,
      fetchFn: async (url) => {
        fetched.push(url);
        return okResponse("x".repeat(10), 10);
      },
    });
    // eine Datei vor-cachen
    store.set(MODEL_FILES[0]!.url, okResponse("cached", 6));
    const progress: DownloadProgress[] = [];
    await s.download((p) => progress.push(p));
    expect(fetched.length).toBe(MODEL_FILES.length - 1);
    const last = progress[progress.length - 1]!;
    expect(last.overallPct).toBe(100);
    expect(last.fileKey).toBe(MODEL_FILES[MODEL_FILES.length - 1]!.key);
    expect(last.totalFiles).toBe(MODEL_FILES.length - 1);
    expect(await s.isComplete()).toBe(true);
  });
  it("meldet Datei-Index/Gesamtzahl/Bytes pro Chunk korrekt", async () => {
    const { cache, store } = fakeCache();
    const s = new ModelStore({
      openCache: async () => cache,
      fetchFn: async () => okResponse("x".repeat(10), 10),
    });
    store.set(MODEL_FILES[0]!.url, okResponse("cached", 6));
    const progress: DownloadProgress[] = [];
    await s.download((p) => progress.push(p));
    const first = progress[0]!;
    expect(first.fileIndex).toBe(1);
    expect(first.totalFiles).toBe(MODEL_FILES.length - 1);
    expect(first.receivedBytes).toBe(10);
    expect(first.totalBytes).toBe(10);
  });
  it("Größen-Mismatch: Datei wird verworfen und Fehler geworfen (Spec §8)", async () => {
    const { cache, store } = fakeCache();
    const s = new ModelStore({
      openCache: async () => cache,
      fetchFn: async () => okResponse("short", 999), // content-length passt nicht
    });
    await expect(s.download(() => {})).rejects.toThrow(/incomplete/i);
    expect(store.size).toBe(0);
  });
  it("HTTP-Fehler wirft mit Status", async () => {
    const { cache } = fakeCache();
    const s = new ModelStore({
      openCache: async () => cache,
      fetchFn: async () => new Response("nope", { status: 503 }),
    });
    await expect(s.download(() => {})).rejects.toThrow(/503/);
  });
  it("getText/getBuffer liefern Inhalte, deleteAll räumt auf", async () => {
    const { cache } = fakeCache();
    const s = new ModelStore({ openCache: async () => cache, fetchFn: async () => okResponse("hello", 5) });
    await s.download(() => {});
    expect(await s.getText("vocab")).toBe("hello");
    expect((await s.getBuffer("unet")).byteLength).toBe(5);
    await s.deleteAll();
    expect(await s.cachedKeys()).toEqual([]);
    await expect(s.getBuffer("unet")).rejects.toThrow(/not downloaded/i);
  });
});
