// zurueckgeholt aus local-image-generator@0.4.4, 2026-08-19 (Kern: Cache API + tee()-Streaming);
// erweitert um SHA-256 im Stream, Abbruch, Stall-Frist und URL-unabhängige Cache-Schlüssel.
//
// Asset-Ablage über die Cache API (Spec 0.6 §4): liegt im Electron-Profil AUSSERHALB des Vaults
// (wird nie gesynct), überlebt Neustarts, Datei-Granularität beim Retry. Deps injizierbar → in Node
// testbar. Kein obsidian-Import.
//
// Transport ist `activeWindow.fetch` als Member-Access — PROF-OBS-12 erlaubt das genau für den Fall
// „unvermeidbar": speicherkonstantes Streaming einer 1,7-GB-Datei in die Cache API geht nur mit
// einem ReadableStream (tee(): ein Zweig in cache.put, einer für Bytes/Fortschritt/Hash); XHR hielte
// die ganze Datei im Puffer. Globales `fetch` ist gebannt (no-restricted-globals) und bleibt es.
// Der Store-Linter (npm run lint) hat 2026-08-19 bestätigt: Member-Access ist sauber.
import { assetUrl, cacheKey, type AssetFile, type AssetKey } from "../core/model-manifest";
import { Sha256 } from "../core/sha256";

export const ASSET_CACHE_NAME = "local-image-generator-assets";

export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface StoreDeps {
  openCache: () => Promise<CacheLike>;
  fetchFn: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  /** Frist ohne ein einziges Byte, nach der ein Download als hängend gilt (Default 60 s). Kein
   *  Gesamt-Timeout: 2,6 GB dürfen so lange dauern, wie die Leitung braucht. */
  stallMs?: number;
  /** Timer für die Stall-Frist (Default window.setTimeout — Store-Regel prefer-window-timers). */
  timer?: (fn: () => void, ms: number) => void;
}

export interface DownloadProgress {
  file: AssetFile;
  fileIndex: number;
  fileCount: number;
  received: number;
  total: number;
  phase: "downloading" | "verifying";
}

export class DownloadAborted extends Error {
  constructor() {
    super("download aborted");
    this.name = "DownloadAborted";
  }
}

export class IntegrityError extends Error {
  constructor(
    public readonly file: AssetFile,
    expected: string,
    actual: string,
  ) {
    super(`integrity check failed for ${file.path}: expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…`);
    this.name = "IntegrityError";
  }
}

const realDeps: StoreDeps = {
  openCache: () => caches.open(ASSET_CACHE_NAME),
  fetchFn: (url, init) => activeWindow.fetch(url, init),
  timer: (fn, ms) => void window.setTimeout(fn, ms),
};

const DEFAULT_STALL_MS = 60_000;

export class ModelStore {
  constructor(private readonly deps: StoreDeps = realDeps) {}

  async cachedKeys(files: readonly AssetFile[]): Promise<AssetKey[]> {
    const cache = await this.deps.openCache();
    const keys: AssetKey[] = [];
    for (const f of files) if (await cache.match(cacheKey(f))) keys.push(f.key);
    return keys;
  }

  async isComplete(files: readonly AssetFile[]): Promise<boolean> {
    return (await this.cachedKeys(files)).length === files.length;
  }

  /** Lädt alle noch fehlenden Dateien der Liste. Fertige Dateien bleiben bei Abbruch/Fehler im
   *  Cache; die angefangene wird verworfen. Wirft DownloadAborted, IntegrityError oder Error. */
  async download(
    files: readonly AssetFile[],
    baseUrl: string,
    onProgress: (p: DownloadProgress) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const cache = await this.deps.openCache();
    const cached = new Set(await this.cachedKeys(files));
    const todo = files.filter((f) => !cached.has(f.key));
    const fileCount = todo.length;
    let fileIndex = 0;
    for (const file of todo) {
      fileIndex += 1;
      const key = cacheKey(file);
      try {
        await this.downloadOne(cache, file, assetUrl(baseUrl, file), key, signal, (received, phase) =>
          onProgress({ file, fileIndex, fileCount, received, total: file.bytes, phase }),
        );
      } catch (e) {
        await cache.delete(key).catch(() => false);
        if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) throw new DownloadAborted();
        throw e;
      }
    }
  }

  private async downloadOne(
    cache: CacheLike,
    file: AssetFile,
    url: string,
    key: string,
    signal: AbortSignal,
    report: (received: number, phase: DownloadProgress["phase"]) => void,
  ): Promise<void> {
    if (signal.aborted) throw new DownloadAborted();
    const res = await this.deps.fetchFn(url, { signal });
    if (res.status !== 200 || !res.body) throw new Error(`download failed: HTTP ${res.status} for ${file.path}`);
    const [progressBranch, cacheBranch] = res.body.tee();
    // Der Cache-Zweig läuft NEBEN der Leseschleife an (0.4-Befund: `await putDone` zuerst staut den
    // ganzen Fortschritts-Zweig ungelesen im Speicher). No-op-Catch, damit ein Stream-Abbruch keine
    // unhandledrejection erzeugt — das Ergebnis wird unten weiterhin per `await putDone` gesehen.
    const putDone = cache.put(key, new Response(cacheBranch, { headers: { "content-type": "application/octet-stream" } }));
    putDone.catch(() => {});
    const reader = progressBranch.getReader();
    const hasher = new Sha256();
    const stallMs = this.deps.stallMs ?? DEFAULT_STALL_MS;
    const timer = this.deps.timer ?? realDeps.timer!;
    let received = 0;
    for (;;) {
      const next = await Promise.race([reader.read(), stallAfter(timer, stallMs, file)]);
      if (next.done) break;
      received += next.value.byteLength;
      hasher.update(next.value);
      report(received, "downloading");
      if (signal.aborted) {
        await reader.cancel().catch(() => undefined);
        throw new DownloadAborted();
      }
    }
    report(received, "verifying");
    await putDone;
    const actual = hasher.digestHex();
    if (actual !== file.sha256) throw new IntegrityError(file, file.sha256, actual);
    if (received !== file.bytes) throw new Error(`download incomplete for ${file.path} (${received}/${file.bytes} bytes)`);
  }

  private async matchOrThrow(file: AssetFile): Promise<Response> {
    const cache = await this.deps.openCache();
    const res = await cache.match(cacheKey(file));
    if (!res) throw new Error(`asset not downloaded: ${file.path}`);
    return res;
  }

  async getBuffer(file: AssetFile): Promise<ArrayBuffer> {
    return (await this.matchOrThrow(file)).arrayBuffer();
  }

  async getText(file: AssetFile): Promise<string> {
    return (await this.matchOrThrow(file)).text();
  }

  async deleteAll(files: readonly AssetFile[]): Promise<void> {
    const cache = await this.deps.openCache();
    for (const f of files) await cache.delete(cacheKey(f));
  }
}

function stallAfter(timer: NonNullable<StoreDeps["timer"]>, ms: number, file: AssetFile): Promise<never> {
  return new Promise((_, reject) => {
    timer(() => reject(new Error(`download stalled: no data for ${ms / 1000}s (${file.path})`)), ms);
  });
}
