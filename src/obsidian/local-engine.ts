// Eingebautes Backend (Spec 0.6 §2/§5): SD-Turbo im Renderer über onnxruntime-web/WebGPU.
// Implementiert dasselbe ImageBackend wie der A1111Client — der Router in main.ts sieht keinen
// Unterschied. Alles Schwere ist injiziert (Store, Session-Fabrik, Runtime-Init, GPU-Check,
// PNG-Encoder), damit die Ladeschritte in Node testbar sind. Kein obsidian-Import nötig.
import { SdTurboEngine, type BuiltinEngine, type Session } from "../core/engine";
import { SdxlTurboEngine } from "../core/engine-sdxl";
import { RUNTIME_WASM, type BuiltinModel, type ModelPart } from "../core/model-manifest";
import type { TokenizerData } from "../core/pipeline/tokenizer";
import type { ImageBackend, ImageRequest } from "../core/txt2img";
import { withTimeout, type TimeoutTimers } from "../vendor/kit/timeout";
import type { ModelStore } from "./model-store";

// Wachhund um den Session-Aufbau (Spec §8 Punkt 2 — im Code-Stand vor diesem Fix nicht
// vorhanden, obwohl die Plan-Selbstpruefung "keine Luecke" behauptete: geschrieben am
// 2026-07-18, aber ueber zwei Engine-Umbauten (0.5-Thin-Client-Entfernung, 0.6-Rueckholung)
// verlorengegangen. ORT bietet KEIN Abort fuer `InferenceSession.create` — ein Timeout kann
// den Aufruf nicht wirklich abbrechen, nur der UI nach Ablauf eine lesbare Meldung geben und
// die haengende Promise im Hintergrund verwaisen lassen (derselbe Kompromiss wie im
// verworfenen 0.4-Entwurf). Deadline **5 Minuten**: deutlich ueber der als normal
// dokumentierten "minutenlang"-Ladezeit auf Apple Silicon (AGENTS.md, ort-host.ts-Kopf) —
// SDXL-Turbos ~13-GB-Spitzenlast macht einen legitim langsamen, aber funktionierenden Lauf
// wahrscheinlicher, und ein zu frueh feuernder Wachhund waere selbst ein Defekt (ein
// erfolgreicher, nur langsamer Ladevorgang wuerde als Fehlschlag gemeldet). Generous beats
// clever. Grund fuer die Wahl VOR Ort statt in `ort-host.ts`: die Injektionsstelle
// (`LocalEngineDeps.createSession`) ist bereits per Fake in Node testbar, `ort-host.ts` ruft
// echtes ORT und ist es nicht.
export const SESSION_BUILD_TIMEOUT_MS = 5 * 60_000;

/** Wirft `loadPart()`, wenn `deps.createSession()` innerhalb von `SESSION_BUILD_TIMEOUT_MS`
 *  weder aufloest noch verwirft — der stille Ewig-Haenger, den dieser Punkt der Spec
 *  verhindern soll (historischer Vorfall: jsep/asyncify-WASM-Fehlpaarung, `create()` resolved
 *  nie). Eigene Klasse statt generischer `Error`, damit `main.ts` sie von einem
 *  Speicherfehler unterscheiden und eine eigene Statuszeile zeigen kann. */
export class SessionBuildTimeout extends Error {
  constructor(ms: number) {
    super(`session build timed out after ${ms} ms`);
    this.name = "SessionBuildTimeout";
  }
}

export type EnginePhase = "loading-model" | "generating";

export interface LocalEngineDeps {
  store: Pick<ModelStore, "getBuffer" | "getText">;
  createSession: (buf: ArrayBuffer, externalData?: readonly { path: string; data: ArrayBuffer }[]) => Promise<Session>;
  initRuntime: (wasm: ArrayBuffer) => void;
  checkGpu: () => Promise<"ok" | "no-webgpu" | "no-f16">;
  /** RGBA → PNG-Data-URL (Canvas im Renderer, Fake im Test). */
  encodePng: (rgba: Uint8ClampedArray, w: number, h: number) => string;
  /** Timer-Port für den Session-Build-Wachhund (`SESSION_BUILD_TIMEOUT_MS`). Default
   *  `window.setTimeout`/`clearTimeout` (Store-Regel prefer-window-timers, Muster wie
   *  `StoreDeps.timer` in model-store.ts) — ein Test kann hier einen Fake einsetzen, der
   *  sofort feuert, um den Wachhund ohne echte 5 Minuten Wartezeit auszulösen. */
  timers?: TimeoutTimers;
}

const REAL_TIMERS: TimeoutTimers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

export class LocalEngineBackend implements ImageBackend {
  /** Phasen-Meldung an den Host: „loading-model" einmal je Sitzung vor dem ersten Bild
   *  (Weight-Upload + Shader-Compile, minutenlang möglich), „generating" je UNet-Schritt. */
  onPhase?: (phase: EnginePhase, step?: number, total?: number) => void;

  private engine: BuiltinEngine | null = null;
  private loading: Promise<BuiltinEngine> | null = null;
  /** Laufender generate()-Aufruf — dispose() wartet darauf, statt die GPU-Sessions unter einem
   *  aktiven UNet-Schritt wegzuziehen (Review 2026-08-19). */
  private running: Promise<unknown> | null = null;
  private runtimeReady = false;
  private readonly timers: TimeoutTimers;

  constructor(
    private readonly deps: LocalEngineDeps,
    private readonly model: BuiltinModel,
  ) {
    this.timers = deps.timers ?? REAL_TIMERS;
  }

  get loaded(): boolean {
    return this.engine !== null;
  }

  async generate(req: ImageRequest): Promise<string> {
    const run = this.run(req);
    this.running = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      this.running = null;
    }
  }

  private async run(req: ImageRequest): Promise<string> {
    const engine = await this.ensureLoaded();
    const steps = Math.min(this.model.steps.max, Math.max(this.model.steps.min, Math.round(req.steps)));
    const size = this.pickSize(req);
    const res = await engine.generate({ prompt: req.prompt, steps, seed: req.seed, size }, (s, t) => this.onPhase?.("generating", s, t));
    const dataUrl = this.deps.encodePng(res.rgba, res.width, res.height);
    // Wie A1111Client: nackte Base64 — main.ts hängt das data:-Präfix selbst an.
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  }

  /** `req.width`/`req.height` gegen `model.sizes` validieren (C1-Fix, 2026-08-24): vorher wurde
   *  hier gar nichts an `engine.generate()` uebergeben, obwohl `hardenParams` die angeforderte
   *  Groesse laengst korrekt durchgereicht hatte — SDXL-Turbo rechnete deshalb IMMER auf
   *  `model.sizes[0]` (512), egal was Notiz/Dateiname/Provider-API behaupteten. Ein Treffer im
   *  Katalog gewinnt; sonst (fremder/kaputter Wert, z. B. ein API-Aufrufer an `hardenParams`
   *  vorbei) faellt es auf die erste erlaubte Groesse zurueck statt zu werfen — dieselbe
   *  Groesse, die vorher hart verdrahtet war. */
  private pickSize(req: ImageRequest): number {
    const match = this.model.sizes.find((s) => s.width === req.width && s.height === req.height);
    return (match ?? this.model.sizes[0]!).width;
  }

  /** Sessions freigeben (GPU-Speicher, 0.1-Leak-Befund). Idempotent; ein laufendes Laden oder
   *  Generieren wird abgewartet und dann freigegeben — nie mitten im UNet-Schritt. */
  async dispose(): Promise<void> {
    if (this.loading) {
      try { await this.loading; } catch { /* Ladefehler ist hier egal — es gibt nichts freizugeben */ }
    }
    if (this.running) await this.running;
    const e = this.engine;
    this.engine = null;
    this.loading = null;
    if (e) await e.dispose();
  }

  private ensureLoaded(): Promise<BuiltinEngine> {
    if (this.engine) return Promise.resolve(this.engine);
    if (!this.loading) {
      this.onPhase?.("loading-model");
      this.loading = this.load()
        .then((e) => { this.engine = e; return e; })
        .finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  /** Ein Modellteil samt seiner External-Data-Buckets laden (SDXL-Turbos UNet: 13 Stueck,
   *  alles andere: leere Liste). Reihenfolge ist tragend — `p.data` steht in Manifest-
   *  Reihenfolge (`_000`, `_001`, …), und `ext[i]` muss zu `data[i]` passen; deshalb hier
   *  ein Promise.all ueber ein ARRAY statt ueber ein Objekt (dessen Key-Reihenfolge nicht
   *  zugesichert waere). `path` MUSS der reine location-Dateiname sein, nicht der Cache-
   *  Schluessel aus `d.key` und nicht der HF-Pfad aus `d.path` — sonst findet ORT die
   *  Daten nicht. */
  private async loadPart(p: ModelPart): Promise<Session> {
    const [buf, ...data] = await Promise.all([
      this.deps.store.getBuffer(p.file),
      ...p.data.map((d) => this.deps.store.getBuffer(d)),
    ]);
    const ext = p.data.map((d, i) => {
      const bytes = data[i];
      if (bytes === undefined) throw new Error(`loadPart: fehlender Bucket-Puffer fuer "${d.path}"`);
      return { path: d.path.split("/").pop() ?? d.path, data: bytes };
    });
    // Wachhund (Spec §8 Punkt 2): `deps.createSession()` bekommt hoechstens
    // `SESSION_BUILD_TIMEOUT_MS`, bevor der Aufruf als haengend gilt. Ein spaetes Aufloesen
    // nach Ablauf wird nicht mehr abgewartet (ORT bietet kein Abort) — die Session bleibt dann
    // unreleased im Hintergrund verwaist, dieselbe Abwaegung wie im verworfenen 0.4-Entwurf.
    const sessionPromise = this.deps.createSession(buf, ext);
    // Review-Fund: `withTimeout` haengt intern `work.then(...)` an — nur den Erfolgsfall, kein
    // `onRejected`. Verwirft `sessionPromise` NACH Ablauf der Frist (die Race also schon per
    // Timeout entschieden ist), waere das genau die Art `unhandledrejection`, die die eigene
    // Geschichte dieses Repos schon einmal produziert hat (jsep/asyncify-Fehlpaarung). Der
    // No-op-Catch HIER, auf dem Original-Promise, macht sie explizit behandelt — `withTimeout`
    // liest denselben `sessionPromise` weiterhin ganz normal ueber sein eigenes `.then()`, das
    // Ergebnis unten aendert sich dadurch nicht.
    sessionPromise.catch(() => { /* nur gegen unhandledrejection nach einem Timeout */ });
    const raced = await withTimeout(sessionPromise, SESSION_BUILD_TIMEOUT_MS, this.timers);
    if (raced.timedOut) throw new SessionBuildTimeout(SESSION_BUILD_TIMEOUT_MS);
    return raced.value;
  }

  // Welche Pipeline entsteht, entscheidet der Katalog (`model.kind`) — nicht eine
  // Zeichenkette im Code. `model.sizes[0]` ist hier nur der Konstruktor-Default fuer
  // SdxlTurboEngine (falls je ohne `size` aufgerufen); `run()`/`pickSize()` uebergeben die
  // pro Anfrage gueltige Groesse explizit (C1-Fix).
  private async load(): Promise<BuiltinEngine> {
    const { store, initRuntime } = this.deps;
    if (!this.runtimeReady) {
      initRuntime(await store.getBuffer(RUNTIME_WASM));
      this.runtimeReady = true;
    }
    if (this.model.kind === "sdxl") {
      const { textEncoder, textEncoder2, unet, vaeDecoder, tokenizer, tokenizer2 } = this.model.parts;
      const [textEncoderSession, textEncoder2Session, unetSession, vaeDecoderSession, vocabText, mergesText, vocab2Text, merges2Text] =
        await Promise.all([
          this.loadPart(textEncoder),
          this.loadPart(textEncoder2),
          this.loadPart(unet),
          this.loadPart(vaeDecoder),
          store.getText(tokenizer.vocab),
          store.getText(tokenizer.merges),
          store.getText(tokenizer2.vocab),
          store.getText(tokenizer2.merges),
        ]);
      return new SdxlTurboEngine(
        { textEncoder: textEncoderSession, textEncoder2: textEncoder2Session, unet: unetSession, vaeDecoder: vaeDecoderSession },
        { primary: parseTokenizer(vocabText, mergesText), secondary: parseTokenizer(vocab2Text, merges2Text) },
        { vaeScaling: this.model.vaeScaling, size: this.model.sizes[0]!.width },
      );
    }
    const { textEncoder, unet, vaeDecoder, tokenizer } = this.model.parts;
    const [textEncoderSession, unetSession, vaeDecoderSession, vocabText, mergesText] = await Promise.all([
      this.loadPart(textEncoder),
      this.loadPart(unet),
      this.loadPart(vaeDecoder),
      store.getText(tokenizer.vocab),
      store.getText(tokenizer.merges),
    ]);
    return new SdTurboEngine(
      { textEncoder: textEncoderSession, unet: unetSession, vaeDecoder: vaeDecoderSession },
      parseTokenizer(vocabText, mergesText),
    );
  }
}

function parseTokenizer(vocabText: string, mergesText: string): TokenizerData {
  return {
    vocab: JSON.parse(vocabText) as Record<string, number>,
    merges: mergesText.split("\n").filter((l) => l.length > 0 && !l.startsWith("#")),
  };
}
