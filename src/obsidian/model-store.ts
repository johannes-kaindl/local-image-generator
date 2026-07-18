// Modell-Ablage über die Cache API (Spec §4/§8): liegt im Electron-Profil AUSSERHALB
// des Vaults (wird nie gesynct), überlebt Neustarts, Datei-Granularität beim Retry.
// Deps injizierbar → in Node testbar. Kein obsidian-Import.
import {
  isDownloadComplete,
  MODEL_FILES,
  missingFiles,
  totalApproxBytes,
  type ModelFile,
  type ModelFileKey,
} from "../core/model-manifest";

export const MODEL_CACHE_NAME = "local-image-generator-models";

export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, res: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
}

export interface StoreDeps {
  openCache: () => Promise<CacheLike>;
  fetchFn: (url: string) => Promise<Response>;
}

const realDeps: StoreDeps = {
  openCache: () => caches.open(MODEL_CACHE_NAME) as Promise<CacheLike>,
  fetchFn: (url) => fetch(url),
};

/** Fortschritt eines download()-Aufrufs — Datei-Detail (Spec 2026-07-18-robustheits-
 *  block-design.md §2.2) plus der bisherige Gesamt-%-Wert. */
export interface DownloadProgress {
  overallPct: number;
  fileKey: ModelFileKey;
  fileIndex: number;
  totalFiles: number;
  receivedBytes: number;
  totalBytes: number;
}

export class ModelStore {
  constructor(private readonly deps: StoreDeps = realDeps) {}

  async cachedKeys(): Promise<ModelFileKey[]> {
    const cache = await this.deps.openCache();
    const keys: ModelFileKey[] = [];
    for (const f of MODEL_FILES) if (await cache.match(f.url)) keys.push(f.key);
    return keys;
  }

  async isComplete(): Promise<boolean> {
    return (await this.cachedKeys()).length === MODEL_FILES.length;
  }

  async download(onProgress: (p: DownloadProgress) => void): Promise<void> {
    const cache = await this.deps.openCache();
    const todo = missingFiles(await this.cachedKeys());
    const grandTotal = totalApproxBytes(todo);
    const totalFiles = todo.length;
    let receivedTotal = 0;
    let fileIndex = 0;
    let lastFileTotalBytes = 0;
    for (const file of todo) {
      fileIndex += 1;
      const res = await this.deps.fetchFn(file.url);
      if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status} for ${file.key}`);
      const contentLength = res.headers.get("content-length");
      const expected = contentLength === null ? null : Number(contentLength);
      const totalBytes = expected ?? file.approxBytes;
      lastFileTotalBytes = totalBytes;
      const [progressBranch, cacheBranch] = res.body.tee();
      const putDone = cache.put(file.url, new Response(cacheBranch, { headers: res.headers }));
      // Separater No-op-Catch: putDone läuft NEBEN der Leseschleife an; scheitert
      // der cacheBranch-Reader mitten im Stream, während noch niemand putDone
      // awaited, gäbe es sonst eine unhandledrejection. Das echte Ergebnis wird
      // weiterhin unten via `await putDone` gesehen (dieser Catch ändert es nicht).
      putDone.catch(() => {});
      let received = 0;
      const reader = progressBranch.getReader();
      // WICHTIG: reader.read()-Schleife läuft NEBEN putDone, nicht danach.
      // Kein Deadlock-Risiko (tee()-Branches puffern unabhängig — verifiziert:
      // `await putDone` vor der Leseschleife löst sich ebenfalls auf), aber
      // bei Multi-Gigabyte-Modelldateien (unet ~1.7GB) würde `await putDone`
      // zuerst den kompletten progressBranch ungelesen im Speicher aufstauen,
      // bevor überhaupt ein Fortschritt gemeldet wird — das Streaming-Ziel
      // (konstanter Speicherbedarf, laufendes onProgress) wäre dahin.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        receivedTotal += value.byteLength;
        onProgress({
          overallPct: Math.min(99, Math.round((receivedTotal / grandTotal) * 100)),
          fileKey: file.key,
          fileIndex,
          totalFiles,
          receivedBytes: received,
          totalBytes,
        });
      }
      await putDone;
      if (!isDownloadComplete(received, expected)) {
        await cache.delete(file.url);
        throw new Error(`download incomplete for ${file.key} (${received}/${expected ?? "?"} bytes)`);
      }
    }
    // Garantierter Abschluss-Callback bei genau 100%: die approxBytes-Schätzungen im
    // Manifest können von echten content-length-Werten abweichen, receivedTotal/
    // grandTotal würde daher nicht zuverlässig exakt 100 erreichen (Math.min-Deckel
    // oben verhindert das sogar bewusst vor Abschluss). Nur wenn wirklich etwas
    // geladen wurde (todo nicht leer) — sonst gibt es kein "letztes" File zu melden.
    const lastFile = todo[todo.length - 1];
    if (lastFile) {
      onProgress({
        overallPct: 100,
        fileKey: lastFile.key,
        fileIndex: totalFiles,
        totalFiles,
        receivedBytes: lastFileTotalBytes,
        totalBytes: lastFileTotalBytes,
      });
    }
  }

  private fileFor(key: ModelFileKey): ModelFile {
    const f = MODEL_FILES.find((m) => m.key === key);
    if (!f) throw new Error(`unknown model file: ${key}`);
    return f;
  }

  private async matchOrThrow(key: ModelFileKey): Promise<Response> {
    const cache = await this.deps.openCache();
    const res = await cache.match(this.fileFor(key).url);
    if (!res) throw new Error(`model file not downloaded: ${key}`);
    return res;
  }

  async getBuffer(key: ModelFileKey): Promise<ArrayBuffer> {
    return (await this.matchOrThrow(key)).arrayBuffer();
  }

  async getText(key: ModelFileKey): Promise<string> {
    return (await this.matchOrThrow(key)).text();
  }

  async deleteAll(): Promise<void> {
    const cache = await this.deps.openCache();
    for (const f of MODEL_FILES) await cache.delete(f.url);
  }
}
