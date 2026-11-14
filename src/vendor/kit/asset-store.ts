// vendored from code-kit@0.68.0, src/ts/web/asset-store.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Lifted into code-kit (2026-11-03) from audio-interface/src/obsidian/asset-store.ts (Stand Tag 0.7.4), which in turn
// took the pattern from local-image-generator/src/obsidian/model-store.ts. Second consumer: protocol-droid (Plan 2).
// Differences from the original, all deliberate:
//  - no `obsidian` import: transport (`fetchFn`), digest, URL building and cache are injected; the plugin wraps
//    `requestUrl` into a `Response` itself (see `FetchLike` in cache-download.ts);
//  - the cache key is content-addressed (`contentKey`: namespace + SHA-256 + file name), so a plugin update that
//    changes the release URL or version does not make unchanged models look missing; `keyFor` overrides it for a
//    consumer that must keep an older key scheme (audio-interface keeps its version-based keys);
//  - sets of files (`AssetSet`) replace the engine descriptors; the set id is the only identity.
// Asset storage over the Cache API: lives in the Electron profile OUTSIDE the vault (never synced), survives
// restarts, per-file granularity on retry. Integrity is checked against SHA-256 digests the caller embeds.
import { streamIntoCache, type CacheLike, type CancellableTimer, type FetchLike } from "./cache-download";

export interface AssetFile {
  /** Stable key inside a set, e.g. "worker", "model". */
  key: string;
  fileName: string;
  bytes: number;
  /** Hex SHA-256 of the file. */
  sha256: string;
  license: string;
}

export interface AssetSet {
  id: string;
  assets: readonly AssetFile[];
}

/** The download URL of a file below a base URL: `base` without trailing slashes, `/`, `relPath` (a file name, or a path inside the release/bucket).
 *  For `AssetStoreDeps.urlFor`. The same line stood in protocol-droid, audio-interface (with a version segment) and local-image-generator,
 *  two of them stripping trailing slashes and one not. */
export function joinAssetUrl(base: string, relPath: string): string {
  return `${base.replace(/\/+$/, "")}/${relPath}`;
}

/** The summed `bytes` of a set (for the download size shown before the download). */
export function totalBytes(set: AssetSet): number {
  return set.assets.reduce((n, f) => n + f.bytes, 0);
}

export type AssetStatus = "missing" | "partial" | "complete";

export interface AssetProgress {
  fileIndex: number;
  totalFiles: number;
  fileName: string;
  receivedBytes: number;
  overallReceived: number;
  overallTotal: number;
}

export type VerifyResult = { ok: true } | { ok: false; fileName: string; expected: string; actual: string };

export interface AssetStoreDeps {
  openCache(): Promise<CacheLike>;
  fetchFn: FetchLike;
  /** Hex SHA-256. */
  digest(buf: ArrayBuffer): Promise<string>;
  /** Where the file is fetched from. */
  urlFor(file: AssetFile): string;
  /** Cache key; default `contentKey(namespace, file)`. */
  keyFor?(file: AssetFile): string;
  namespace: string;
  stallMs?: number;
  timer?: CancellableTimer;
}

/** Cache API needs an http(s) URL as key; `.invalid` can never be a real host. The SHA-256 binds the key to the bytes. */
export function contentKey(namespace: string, file: AssetFile): string {
  return `https://${namespace}.invalid/${file.sha256}/${file.fileName}`;
}

/** Hex SHA-256 through `crypto.subtle` (async, native; the sync JS variant in `sha256` blocks the main thread). */
export async function subtleSha256Hex(buf: ArrayBuffer, subtle: Pick<SubtleCrypto, "digest">): Promise<string> {
  const h = await subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A stored or fetched file does not match its digest. Carries the file name and both digests (shortened in the message). */
export class AssetIntegrityError extends Error {
  constructor(
    readonly fileName: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`checksum mismatch: ${fileName} (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
    this.name = "AssetIntegrityError";
  }
}

function abortError(): Error {
  return new DOMException("aborted", "AbortError");
}

export class AssetStore {
  /** One running download per cache key: two callers fetching the same file share one transfer (P1 review W1). */
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly deps: AssetStoreDeps) {}

  private keyFor(file: AssetFile): string {
    return this.deps.keyFor ? this.deps.keyFor(file) : contentKey(this.deps.namespace, file);
  }

  private fileFor(set: AssetSet, key: string): AssetFile {
    const f = set.assets.find((a) => a.key === key);
    if (!f) throw new Error(`unknown asset key: ${key}`);
    return f;
  }

  private async cachedFiles(set: AssetSet): Promise<AssetFile[]> {
    const cache = await this.deps.openCache();
    const out: AssetFile[] = [];
    for (const f of set.assets) if (await cache.match(this.keyFor(f))) out.push(f);
    return out;
  }

  /** File names of these sets that are in the cache; a file shared by several sets appears once. */
  async cachedFileNames(sets: readonly AssetSet[]): Promise<Set<string>> {
    const cache = await this.deps.openCache();
    const out = new Set<string>();
    for (const s of sets) {
      for (const f of s.assets) {
        if (out.has(f.fileName)) continue;
        if (await cache.match(this.keyFor(f))) out.add(f.fileName);
      }
    }
    return out;
  }

  async status(set: AssetSet): Promise<AssetStatus> {
    const n = (await this.cachedFiles(set)).length;
    if (n === 0) return "missing";
    return n === set.assets.length ? "complete" : "partial";
  }

  /** Fetches only missing files. On abort the finished files stay, the unfinished one is discarded. Every fetched file is hashed
   *  after it was stored; a file that does not match its digest is removed again (no entry survives that `verify` would reject). */
  async download(set: AssetSet, onProgress: (p: AssetProgress) => void, signal: AbortSignal): Promise<void> {
    const cache = await this.deps.openCache();
    const have = new Set((await this.cachedFiles(set)).map((f) => f.key));
    const todo = set.assets.filter((f) => !have.has(f.key));
    const overallTotal = todo.reduce((n, f) => n + f.bytes, 0);
    let overallReceived = 0;
    for (let i = 0; i < todo.length; i++) {
      const file = todo[i];
      if (!file) continue;
      const overallBefore = overallReceived;
      const k = this.keyFor(file);
      for (;;) {
        const running = this.inflight.get(k);
        if (running) {
          // Someone else is already fetching this file: wait for that transfer instead of starting a second one.
          try {
            await running;
          } catch (e) {
            // The other caller was aborted (not us): take over; any other failure is ours as well.
            if (e instanceof DOMException && e.name === "AbortError" && !signal.aborted) continue;
            throw e;
          }
          if (signal.aborted) throw abortError();
          overallReceived = overallBefore + file.bytes;
          onProgress({ fileIndex: i + 1, totalFiles: todo.length, fileName: file.fileName, receivedBytes: file.bytes, overallReceived, overallTotal });
          break;
        }
        // The claim on this key is registered synchronously (no await before `inflight.set`), so two callers cannot both start.
        // A download that finished this file while we were busy with an earlier one leaves nothing to fetch.
        const transfer = (async (): Promise<void> => {
          if (await cache.match(k)) return;
          await this.fetchOne(cache, file, signal, (received) => {
            overallReceived = overallBefore + received;
            onProgress({ fileIndex: i + 1, totalFiles: todo.length, fileName: file.fileName, receivedBytes: received, overallReceived, overallTotal });
          });
        })();
        this.inflight.set(k, transfer);
        try {
          await transfer;
        } finally {
          this.inflight.delete(k);
        }
        overallReceived = overallBefore + file.bytes;
        break;
      }
    }
  }

  private async fetchOne(cache: CacheLike, file: AssetFile, signal: AbortSignal, onReceived: (received: number) => void): Promise<void> {
    const k = this.keyFor(file);
    await streamIntoCache({
      cache,
      fetchFn: (u, init) => this.deps.fetchFn(u, init),
      url: this.deps.urlFor(file),
      key: k,
      signal,
      label: file.fileName,
      expectedBytes: file.bytes,
      ...(this.deps.stallMs !== undefined ? { stallMs: this.deps.stallMs } : {}),
      ...(this.deps.timer ? { timer: this.deps.timer } : {}),
      abortError,
      onProgress: (received) => onReceived(received),
    });
    const stored = await cache.match(k);
    const actual = stored ? await this.deps.digest(await stored.arrayBuffer()) : "";
    if (actual !== file.sha256) {
      await cache.delete(k).catch(() => false);
      throw new AssetIntegrityError(file.fileName, file.sha256, actual);
    }
  }

  /** Re-hashes every file. A missing file is reported like a wrong one (`actual: ""`), it does not throw. */
  async verify(set: AssetSet): Promise<VerifyResult> {
    const cache = await this.deps.openCache();
    for (const f of set.assets) {
      const res = await cache.match(this.keyFor(f));
      if (!res) return { ok: false, fileName: f.fileName, expected: f.sha256, actual: "" };
      const actual = await this.deps.digest(await res.arrayBuffer());
      if (actual !== f.sha256) return { ok: false, fileName: f.fileName, expected: f.sha256, actual };
    }
    return { ok: true };
  }

  private async matchOrThrow(set: AssetSet, key: string): Promise<Response> {
    const cache = await this.deps.openCache();
    const res = await cache.match(this.keyFor(this.fileFor(set, key)));
    if (!res) throw new Error(`asset not downloaded: ${key}`);
    return res;
  }

  async getBuffer(set: AssetSet, key: string): Promise<ArrayBuffer> {
    return (await this.matchOrThrow(set, key)).arrayBuffer();
  }

  async getText(set: AssetSet, key: string): Promise<string> {
    return (await this.matchOrThrow(set, key)).text();
  }

  /** Reads one file, hashes exactly the bytes it returns and compares them with the manifest digest. The caller uses THESE
   *  bytes (not a second read of the cache), so what was checked is what is used. Throws `AssetIntegrityError` on mismatch. */
  async getVerified(set: AssetSet, key: string): Promise<ArrayBuffer> {
    const file = this.fileFor(set, key);
    const buf = await (await this.matchOrThrow(set, key)).arrayBuffer();
    const actual = await this.deps.digest(buf);
    if (actual !== file.sha256) throw new AssetIntegrityError(file.fileName, file.sha256, actual);
    return buf;
  }

  /** Removes one file of a set (a file that failed its check, so the next download fetches it again). */
  async discard(set: AssetSet, key: string): Promise<void> {
    const cache = await this.deps.openCache();
    await cache.delete(this.keyFor(this.fileFor(set, key)));
  }

  /** Removes the files of this set. `keepAlive` names the other sets: a file that a still complete set needs stays,
   *  otherwise removing one set would pull the runtime from under the other. */
  async remove(set: AssetSet, keepAlive: readonly AssetSet[] = []): Promise<void> {
    const cache = await this.deps.openCache();
    const keep = new Set<string>();
    for (const other of keepAlive) {
      if (other.id === set.id) continue;
      if ((await this.status(other)) === "complete") for (const a of other.assets) keep.add(this.keyFor(a));
    }
    for (const f of set.assets) {
      const k = this.keyFor(f);
      if (!keep.has(k)) await cache.delete(k);
    }
  }
}
