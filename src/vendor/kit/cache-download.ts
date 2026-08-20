// vendored from obsidian-kit@0.27.0, src/pure/cache-download.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Eine Datei gestreamt in die Cache API laden — speicherkonstant, abbrechbar, und mit der
 *  Zusicherung, dass nach einem Fehlschlag KEIN Teil-Eintrag im Cache zurückbleibt.
 *
 *  Kanonische Quelle: `local-image-generator/src/obsidian/model-store.ts` (`ModelStore.downloadOne`,
 *  Stand 2026-08-19) und `audio-interface/src/obsidian/asset-store.ts` (Pro-Datei-Block in
 *  `AssetStore.download`, Stand 2026-08-15). Beide sind dieselbe 12-Schritt-Sequenz; audio ist die
 *  Kopie („uebernommen (Muster) aus …, Stand vor 05b3c20"), local-image-generator hat sie am
 *  2026-08-19 aus 0.4.4 zurückgeholt. Beim Heben ins Kit (2026-08-19) wurden beide Fassungen
 *  zusammengeführt; die Store-Klassen drumherum bleiben in den Repos (Key-Ableitung, Manifest,
 *  Refcount beim Entfernen, Hash-Prüfung — alles domäneneigen).
 *
 *  ── Die teure Erkenntnis, wegen der es dieses Modul gibt (LIG-0.4-Befund) ────────────────────
 *  `res.body.tee()`: ein Zweig läuft in `cache.put`, der andere durch Zähler/Digest. Der `put`
 *  MUSS NEBEN der Leseschleife anlaufen — wer `await putDone` vor die Schleife setzt, staut den
 *  ungelesenen Fortschritts-Zweig komplett im Speicher (bei 1,7 GB Modellgewichten tödlich).
 *  Der No-op-Catch auf `putDone` verhindert nur die `unhandledrejection`; das echte Ergebnis wird
 *  weiterhin per `await putDone` gesehen.
 *
 *  ── Der gemessene Bug, der hier repariert ist ────────────────────────────────────────────────
 *  Beide Kopien hatten zusammen die vollständige Lösung, jede aber nur ihre Hälfte: audio wartete
 *  auf dem Fehlerpfad `await putDone.catch(…)` AB, bevor es `cache.delete(key)` rief — LIG nicht
 *  (dessen Catch lag eine Ebene höher, wo `putDone` gar nicht sichtbar war). Ohne das Abwarten
 *  kann der laufende `put` NACH dem `delete` fertig werden und den Teil-Eintrag zurückschreiben.
 *  Erreichbar über den Abbruch- und den Stillstands-Pfad; in LIG unentdeckt, weil dessen Fake-`put`
 *  im Stall-Test nie auflöste — die Zusicherung war zufällig erfüllt, nicht erarbeitet.
 *  Hier gilt auf JEDEM Fehlerpfad: Pipe abbrechen → Reader canceln → `await putDone` → `delete`.
 *
 *  ── Warum der Cache-Zweig durch einen `TransformStream` läuft ────────────────────────────────
 *  „Erst `putDone` abwarten, dann löschen" ist für sich genommen eine Aufhäng-Falle: ein Stillstand
 *  ist per Definition ein Stream, der nichts mehr liefert und auch nicht scheitert — `await putDone`
 *  liefe dort ewig, also genau in dem Fall, den die Stall-Frist verhindern soll. Dasselbe gilt, wenn
 *  `onChunk`/`onProgress` werfen: der Cache-Zweig würde die Datei sonst brav zu Ende laden.
 *  Deshalb bekommt der Cache-Zweig eine Abbruchkante: `pipeThrough(new TransformStream(), { signal })`.
 *  Ein `abort()` darauf errort die Ziel-Seite sofort → `cache.put` scheitert → `putDone` ist settled,
 *  unabhängig von der Quelle. (Den Zweig direkt zu canceln geht nicht: sobald `cache.put` den Body
 *  liest, ist er gelockt.) Kosten: eine Identitäts-Transformation mit `highWaterMark 1` — die
 *  Rückstau-Eigenschaft und damit die Speicherkonstanz bleiben erhalten.
 *
 *  ── Beim Übernehmen beachten ─────────────────────────────────────────────────────────────────
 *  • Die Fehlertexte sind load-bearing: die Tests beider Quell-Repos matchen auf
 *    `/HTTP 404/`, `/incomplete/` und `/stalled/`, und der HTTP-Text nennt `label`, nicht die URL.
 *  • `putHeaders` steht per Default auf `{"content-type": "application/octet-stream"}` (LIGs
 *    Fassung) und NICHT auf `res.headers`: die Antwort-Header können ein `content-encoding` tragen,
 *    das dann über schon dekodierten Bytes im Cache-Eintrag steht. audio kopiert die Header bewusst
 *    (`requestUrl` liefert dort nur `content-length`) und setzt die Option.
 *  • Timer und `fetch` sind injiziert, nicht importiert: vendorierter Kit-Code wird vom Lint des
 *    Consumers erfasst, und `obsidianmd/prefer-window-timers` bzw. `no-restricted-globals` verlangen
 *    dort `window.setTimeout` / `activeWindow.fetch`. Die Bindung ans Fenster gehört in die
 *    obsidian-Schicht des Consumers (gleiche Begründung wie bei `pure/timeout.ts`).
 *  • Ohne `stallMs` UND `timer` wird gar nicht auf Stillstand geprüft — dann läuft kein Race.
 *  • `reader.cancel()` eines `tee()`-Zweigs wird bewusst NICHT awaited — es löst erst auf, wenn
 *    auch der andere Zweig gecancelt ist (gemessen 2026-08-19, Node 24). Beide Quell-Fassungen
 *    warteten dort; das ist eine Aufhäng-Falle auf dem Fehlerpfad.
 *  • Hash/Digest bleibt draußen: `onChunk` reicht jeden Chunk durch (LIG hängt dort seinen
 *    Streaming-SHA-256 ein, weil 1,7 GB nicht in `crypto.subtle` passen), die Bewertung des
 *    Ergebnisses ist Sache des Aufrufers. Dieses Modul ist hash-agnostisch. */

/** Cache-API-Port. Strukturell erfüllt vom echten `Cache` und von einem Map-Fake im Test —
 *  beide Quell-Repos hatten dafür byte-gleiche Interfaces und je einen eigenen Fake. */
export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
}

/** Transport-Port. Erfüllt von `activeWindow.fetch` (echtes Streaming) und ebenso von einem
 *  `requestUrl`-Wrapper, der den ganzen Körper am Stück in eine `Response` wickelt — auch die
 *  hat einen Body-Stream, `tee()` und Leseschleife laufen unverändert, nur springt der
 *  Fortschritt dann je Datei statt je Chunk. */
export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** Timer-Port: stellt `fn` in `ms` ms ein und liefert die Cancel-Funktion. */
export type CancellableTimer = (fn: () => void, ms: number) => () => void;

export interface StreamIntoCacheOptions {
  cache: CacheLike;
  fetchFn: FetchLike;
  /** Bezugs-URL (woher geladen wird). */
  url: string;
  /** Cache-Schlüssel. Wie er entsteht, entscheidet der Consumer (hash- oder versionsgebunden);
   *  er muss nicht die Bezugs-URL sein. */
  key: string;
  signal: AbortSignal;
  /** Nur für Fehlertexte: der Name, unter dem der Nutzer die Datei kennt (Pfad oder Dateiname). */
  label: string;
  /** Erwartete Größe aus dem Manifest. Fehlt sie (oder ist `null`), wird nicht dagegen geprüft.
   *  Unabhängig davon wird immer gegen einen vorhandenen `content-length`-Header geprüft. */
  expectedBytes?: number | null;
  /** Bytes je Chunk — für einen Streaming-Digest. Wird nach dem Hochzählen und VOR `onProgress`
   *  gerufen. Wirft der Callback, gilt der Download als gescheitert (Eintrag wird verworfen). */
  onChunk?: (chunk: Uint8Array) => void;
  /** Bytes DIESER Datei nach jedem Chunk; zweites Argument ist der `content-length`-Header
   *  (`null`, wenn er fehlt oder unbrauchbar ist), damit der Aufrufer seine Gesamtanzeige
   *  stellen kann, ohne den Header selbst zu lesen. */
  onProgress?: (received: number, contentLength: number | null) => void;
  /** Frist ohne ein einziges Byte, nach der der Download als hängend gilt. Kein Gesamt-Timeout:
   *  große Dateien dürfen so lange dauern, wie die Leitung braucht. Wirkt nur zusammen mit `timer`. */
  stallMs?: number;
  timer?: CancellableTimer;
  /** Welche Antwort gilt als brauchbar? Default `res.ok` (200–299). LIG übergibt
   *  `(r) => r.status === 200`, weil ein 206 dort ein halber Bereich wäre, kein Erfolg. */
  accept?: (res: Response) => boolean;
  /** Header des Cache-Eintrags. Default `{"content-type": "application/octet-stream"}`. */
  putHeaders?: (res: Response) => HeadersInit;
  /** Fehler für den Abbruchpfad; Default `new DOMException("aborted", "AbortError")`.
   *  LIG übergibt hier seine eigene `DownloadAborted`-Klasse. */
  abortError?: () => Error;
}

export interface StreamIntoCacheResult {
  /** Tatsächlich gelesene Bytes. */
  received: number;
  /** `content-length` der Antwort, oder `null` wenn der Header fehlte/unbrauchbar war. */
  contentLength: number | null;
}

/** Liest den Header defensiv: `null` bei fehlendem, leerem, nicht-numerischem oder negativem
 *  Wert — sonst würde aus `Number("")` eine erwartete Größe von 0 und jeder Download „incomplete". */
function parseContentLength(header: string | null): number | null {
  if (header === null || header.trim() === "") return null;
  const n = Number(header);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Lädt EINE Datei gestreamt in den Cache.
 *
 *  Ablauf: Abbruch-Vorprüfung → `fetchFn` → `accept`-Prüfung → `body.tee()` → `cache.put` läuft
 *  NEBEN der Leseschleife an → Leseschleife mit optionaler Stall-Frist, `onChunk`, `onProgress`
 *  und Abbruch-Prüfung vor UND nach jedem Chunk → `await putDone` → Größenprüfung.
 *
 *  Zusicherung bei Fehler, Abbruch, Stillstand oder Größen-Mismatch: der Cache-Eintrag ist beim
 *  Verlassen gelöscht — und zwar erst, NACHDEM der laufende `put` abgeschlossen (oder abgebrochen)
 *  ist. Der ursprüngliche Fehler wird unverändert weitergeworfen.
 *
 *  Die Abbruch-Prüfung steht bewusst an BEIDEN Stellen: audio prüfte nur vor `reader.read()` und
 *  sah damit einen Abbruch nicht mehr, der während des letzten `read()` eintraf; LIG prüfte nur
 *  nach `onProgress` und fing dafür den Abbruch, den der Fortschritts-Callback selbst auslöst. */
export async function streamIntoCache(o: StreamIntoCacheOptions): Promise<StreamIntoCacheResult> {
  const accept = o.accept ?? ((r: Response): boolean => r.ok);
  const putHeaders = o.putHeaders ?? ((): HeadersInit => ({ "content-type": "application/octet-stream" }));
  const makeAbortError = o.abortError ?? ((): Error => new DOMException("aborted", "AbortError"));

  if (o.signal.aborted) throw makeAbortError();

  const res = await o.fetchFn(o.url, { signal: o.signal });
  if (!accept(res) || !res.body) throw new Error(`download failed: HTTP ${res.status} for ${o.label}`);

  const contentLength = parseContentLength(res.headers.get("content-length"));

  const [progressBranch, cacheBranch] = res.body.tee();
  // Abbruchkante für den Cache-Zweig (s. Modulkopf): macht `putDone` auch dann settle-bar,
  // wenn die Quelle steht und nie scheitert.
  const pipeAbort = new AbortController();
  const cacheStream = cacheBranch.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), { signal: pipeAbort.signal });
  const putDone = o.cache.put(o.key, new Response(cacheStream, { headers: putHeaders(res) }));
  putDone.catch(() => {}); // nur gegen unhandledrejection; das Ergebnis sieht unten `await putDone`

  const reader = progressBranch.getReader();

  // EIN Stall-Timer je Datei, nach jedem Chunk neu gestellt und am Ende abgeräumt. Ein Timer
  // pro Chunk ohne Cancel wäre ein Leak (Review 2026-08-19: tausende offene Handles bei 1,7 GB).
  const useStall = o.stallMs !== undefined && o.timer !== undefined;
  let cancelStall: () => void = () => {};
  let rejectStall: (e: Error) => void = () => {};
  const stalled = new Promise<never>((_resolve, reject) => { rejectStall = reject; });
  stalled.catch(() => {}); // wird nur im Race beobachtet; nie als unhandledrejection melden
  const armStall = (): void => {
    const { stallMs, timer } = o;
    if (stallMs === undefined || timer === undefined) return;
    cancelStall();
    cancelStall = timer(() => rejectStall(new Error(`download stalled: no data for ${stallMs / 1000}s (${o.label})`)), stallMs);
  };

  let received = 0;
  try {
    try {
      armStall();
      for (;;) {
        if (o.signal.aborted) throw makeAbortError();
        const next = useStall ? await Promise.race([reader.read(), stalled]) : await reader.read();
        if (next.done) break;
        armStall();
        received += next.value.byteLength;
        o.onChunk?.(next.value);
        o.onProgress?.(received, contentLength);
        if (o.signal.aborted) throw makeAbortError();
      }
    } finally {
      cancelStall();
    }
    await putDone;
    if (contentLength !== null && received !== contentLength) {
      throw new Error(`download incomplete for ${o.label} (${received}/${contentLength} bytes)`);
    }
    const expected = o.expectedBytes ?? null;
    if (expected !== null && received !== expected) {
      throw new Error(`download incomplete for ${o.label} (${received}/${expected} bytes)`);
    }
    return { received, contentLength };
  } catch (e) {
    pipeAbort.abort();
    // NICHT awaiten: der Cancel eines `tee()`-Zweigs löst erst auf, wenn AUCH der andere Zweig
    // gecancelt ist (gemessen 2026-08-19 in Node 24) — beide Quell-Repos warteten hier und hätten
    // sich damit genau auf dem Fehlerpfad aufhängen können. Der Cancel ist reine Aufräumarbeit;
    // die Zusicherung „kein Teil-Eintrag" haengt allein an `putDone` vor dem `delete`.
    reader.cancel().catch(() => undefined);
    await putDone.catch(() => undefined);
    await o.cache.delete(o.key).catch(() => false);
    throw e;
  }
}
