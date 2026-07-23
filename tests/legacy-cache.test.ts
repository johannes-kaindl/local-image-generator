// legacy-cache.ts wrapt die globale Cache API best-effort (try/catch). Da sie nicht
// deps-injectable ist (bewusst simpel gehalten, siehe Kommentar dort), wird hier
// globalThis.caches gemockt statt eine eigene Abstraktion einzuführen.
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteLegacyCache, hasLegacyCache } from "../src/obsidian/legacy-cache";

describe("legacy-cache", () => {
  const originalCaches = globalThis.caches;

  afterEach(() => {
    globalThis.caches = originalCaches;
  });

  it("hasLegacyCache meldet true, wenn der alte Cache existiert", async () => {
    globalThis.caches = { has: vi.fn().mockResolvedValue(true) } as unknown as CacheStorage;
    await expect(hasLegacyCache()).resolves.toBe(true);
    expect(globalThis.caches.has).toHaveBeenCalledWith("local-image-generator-models");
  });

  it("hasLegacyCache meldet false, wenn kein alter Cache existiert", async () => {
    globalThis.caches = { has: vi.fn().mockResolvedValue(false) } as unknown as CacheStorage;
    await expect(hasLegacyCache()).resolves.toBe(false);
  });

  it("hasLegacyCache fängt Fehler ab und meldet false (Cache API kann fehlen)", async () => {
    globalThis.caches = {
      has: vi.fn().mockRejectedValue(new Error("no cache api")),
    } as unknown as CacheStorage;
    await expect(hasLegacyCache()).resolves.toBe(false);
  });

  it("deleteLegacyCache löscht den alten Cache", async () => {
    const del = vi.fn().mockResolvedValue(true);
    globalThis.caches = { delete: del } as unknown as CacheStorage;
    await deleteLegacyCache();
    expect(del).toHaveBeenCalledWith("local-image-generator-models");
  });

  it("deleteLegacyCache ist best-effort und wirft bei Fehlern nicht", async () => {
    globalThis.caches = {
      delete: vi.fn().mockRejectedValue(new Error("no cache api")),
    } as unknown as CacheStorage;
    await expect(deleteLegacyCache()).resolves.toBeUndefined();
  });
});
