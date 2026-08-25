/**
 * GUI-Smoke-Treiber — fährt die Checkliste aus `docs/SMOKE.md` gegen ein **laufendes**
 * Obsidian statt von Hand.
 *
 * Herkunft: CDP-Brücke (Klasse `Cdp`, `waitFor`, `record`) unverändert vendored aus
 * `obsidian-plugins/3d-codeblocks/scripts/gui-smoke.ts` (Skill `gui-smoke-setup`, n=2).
 * Sie trägt teuer erkaufte Details — Fenster-Auswahl per Vault-Titel, Fokus-Erzwingung,
 * Renderer-Ausnahmen durchreichen. Alles ab „Prüfpunkte" ist plugin-eigen.
 *
 * Warum getrackt (CORE-TEST-02 b): Die Naht zum Host sieht kein Unit-Test. Der Bug, den
 * 0.5.0 zuletzt trug (`1d1c046`: Draw Things meldet das Modell als `model`, nicht
 * `sd_model_checkpoint`), war auf Protokollebene messbar — aber dass er als
 * `model: unknown` in JEDER Ergebnis-Notiz landete, zeigte erst der Blick auf das Produkt.
 * Genau diese Kette prüft Punkt 3 und 8.
 *
 * ## Voraussetzung
 *
 * Obsidian muss mit offenem Debug-Port laufen (der eine Handgriff, der Handarbeit bleibt —
 * die App muss dafür neu gestartet werden):
 *
 * ```bash
 * osascript -e 'quit app "Obsidian"'
 * open -a Obsidian --args --remote-debugging-port=9222
 * ```
 *
 * Dazu ein **laufender A1111-kompatibler Bildserver** (Draw Things, AUTOMATIC1111, Forge,
 * SD.Next) auf dem Endpunkt, der in den Plugin-Settings steht — ein fehlender Server ist kein
 * Plugin-Defekt, und der Treiber behandelt ihn auch nicht so: er prüft die Erreichbarkeit
 * vorab und sagt an, was fehlt. Ein vollständiger Lauf bricht dann ab (die Punkte 5–11
 * erzeugen ein echtes Bild); `--quick` läuft weiter und überspringt die Punkte 2, 3 und 4 —
 * sie vergleichen gegen den Server oder hängen an einer bestehenden Verbindung. Übersprungene
 * Punkte stehen in der Abschlusszeile, damit ein Teil-Lauf nicht als bestandener Smoke
 * zitiert wird.
 *
 * Antwortet der Server dagegen FALSCH (HTTP-Fehler, kein Modellname), bleibt es ein Abbruch:
 * das ist ein Befund, keine fehlende Umgebung.
 *
 * Dann, mit deployter Plugin-Version (`npm run deploy`):
 *
 * ```bash
 * npm run smoke:gui -- --vault <name>
 * npm run smoke:gui -- --vault <name> --port 9222 --steps 8 --keep
 * npm run smoke:gui -- --vault <name> --builtin                # + Punkte 13–16, 20–25 (eingebaute Engine)
 *
 * Punkt 17 (modusabhängige Regler, gerendert gemessen) läuft in JEDEM Lauf — er braucht weder
 * Server noch Assets noch Generierung, nur einen Moduswechsel und `getComputedStyle`.
 *   (braucht `npm run smoke:assets` in einem zweiten Terminal — lokaler Asset-Server auf 7862;
 *    --assets <url> nennt eine andere Basis. Der Lauf löscht und lädt die Modell-Dateien des
 *    Plugin-Caches neu — deshalb nur gegen den lokalen Server, nie gegen das HF-Repo.)
 * ```
 *
 * ⚠️ Chromium drosselt das Rendering nicht-fokussierter Fenster: ohne `Page.bringToFront`
 * plus `osascript activate` bleibt die View leer und man debuggt ein Phantom (CORE-TEST-02).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// Die CDP-Brücke liegt seit 2026-08-16 zentral im Dach (tools/obsidian-cdp/) und wird
// importiert, nicht vendored: sie ist plugin-neutral und lief zuvor byte-identisch in
// sechs Repos. Fehlt das Dach (fremder Checkout), bricht esbuild beim Auflösen ab — das
// ist die gewollte Meldung. Was ihr fehlt, wird DORT ergänzt, nicht hier nachgebaut.
import { Cdp, attachTo, clickReal } from "../../tools/obsidian-cdp/cdp.js";
import { SIZES, STEPS } from "../src/core/generation";
import { BUILTIN_MODELS, DEFAULT_BUILTIN_MODEL_ID, RUNTIME_WASM, assetsFor, totalBytes, type BuiltinModelId } from "../src/core/model-manifest";
import { IMAGE_GENERATION_API_VERSION } from "../src/core/plugin-api";
import { formatBytes } from "../src/core/viewmodel";
import { registerI18n } from "../src/i18n/strings";
import { pickLang, setLang, t } from "../src/vendor/kit/i18n";

const PLUGIN_ID = "local-image-generator";
/** Zielordner für Bild + Ergebnis-Notiz. Wird angelegt und am Ende wieder entfernt
 *  (außer mit `--keep`) — so muss der Treiber keine Dateien aus fremden Ordnern fischen. */
const SMOKE_FOLDER = "_lig-gui-smoke";
const SMOKE_PROMPT = "gui smoke test, a single grey pebble on white paper";

// --- Prüfpunkte -------------------------------------------------------------

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

const results: Check[] = [];

function record(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
  console.log(`${passed ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Nicht gemessene Prüfpunkte — getrennt von `results`, weil sie weder grün noch rot sind.
 *  Sie stehen trotzdem in der Abschlusszeile: ein Lauf, der die Hälfte auslässt, darf sich
 *  nicht wie ein vollständiger lesen. */
const skipped: Check[] = [];

function skip(name: string, grund: string): void {
  skipped.push({ name, passed: false, detail: grund });
  console.log(`  – ${name} — übersprungen: ${grund}`);
}

/**
 * Meldet die Statuszeile einen Fehlschlag?
 *
 * Der Prüfling schreibt Fehler als `status.error` („Fehler: <text>") in dieselbe Zeile, in
 * der sonst der Fortschritt steht. Ein Prüfpunkt, der nur auf „Text ≠ Bereit" prüft, hält
 * das für einen gestarteten Lauf — gemessen 2026-08-17: Punkt 5 meldete grün, während die
 * Zeile bereits „Fehler: txt2img HTTP 422" trug und nie eine Generierung lief.
 */
function istFehler(text: string): boolean {
  const praefix = t("status.error", "").trim();
  return praefix !== "" && text.startsWith(praefix);
}

/** Im Renderer: warten, bis `check()` wahr wird (Rendering ist asynchron). */
const waitFor = (body: string, timeoutMs = 8000): string => `
  const deadline = Date.now() + ${timeoutMs};
  while (Date.now() < deadline) {
    const value = (() => { ${body} })();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
`;

/**
 * Node-seitiges Warten für alles, was länger dauern kann als ein CDP-Aufruf leben darf.
 *
 * ABWEICHUNG zur 3d-codeblocks-Vorlage (Material für die spätere Kit-Extraktion): dort
 * genügt `waitFor` im Renderer, weil jede Prüfung in Millisekunden fällt. Hier dauert eine
 * echte Bildgenerierung Minuten — und `Cdp.send` bricht nach 30 s hart ab. Ein
 * renderer-seitiges Warten würde also nicht „lange warten", sondern zuverlässig in eine
 * Zeitüberschreitung laufen, die wie ein Defekt aussieht. Deshalb wird hier kurz gemessen
 * und lange auf der Node-Seite gewartet.
 */
async function pollUntil<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs: number,
  label: string,
  intervalMs = 2000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  let lastLog = Date.now();
  let value: T | null = null;
  while (Date.now() < deadline) {
    value = await read();
    if (done(value)) return value;
    if (Date.now() - lastLog > 15_000) {
      lastLog = Date.now();
      const left = Math.round((deadline - Date.now()) / 1000);
      console.log(`    … ${label} (noch ${left}s)`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

/**
 * Download-Frist für Punkt 14, PROPORTIONAL zur Bytezahl des Modells, das gerade geladen wird
 * — nicht länger ein fixer Wert. Anlass: die Frist stammte aus der Zeit, in der SD-Turbo
 * (~2,5 GB) das einzige eingebaute Modell war; SDXL-Turbo ist mit ~6,4 GiB (gemessen aus dem
 * Manifest) das 2,8-fache, und ein voller lokaler Download (inkl. SHA-256-Verifikation +
 * Cache-API-Schreiben) lief in genau diesem Lauf über die alten 30 min hinaus. Ein drittes,
 * noch größeres Modell würde jede erneut fest verdrahtete Zahl wieder sprengen.
 *
 * Regel: ein Sockel für Verbindungsaufbau/Cache-API-Vorbereitung, die auch bei winzigen
 * Modellen nicht unterschritten wird, plus ein Aufschlag je GB — SD-Turbos ~30 min (die
 * bisherige Konstante) sind der Kalibrierungspunkt: 10 min Sockel + 8 min/GB × 2,5 GB ≈ 30 min.
 * Für SDXL-Turbo ergibt dieselbe Formel 10 min + 8 min/GB × 6,4 GB ≈ 61 min.
 */
const DOWNLOAD_DEADLINE_FLOOR_MS = 10 * 60_000;
const DOWNLOAD_DEADLINE_PER_GB_MS = 8 * 60_000;
function downloadDeadlineMs(bytes: number): number {
  const gb = bytes / 1_000_000_000;
  return DOWNLOAD_DEADLINE_FLOOR_MS + Math.ceil(gb * DOWNLOAD_DEADLINE_PER_GB_MS);
}

/**
 * Miss den tatsächlichen INHALT eines Panel-Bildes statt nur seine Form. Anlass: Phase 1–3 des
 * SDXL-Turbo-Debuggings (2026-08-24) — ein rein schwarzes 1024×1024-PNG erfüllt jede
 * Form-Prüfung (gültige PNG-Datei, richtige Größe, Status „Bereit"), war aber zu 100 % NaN aus
 * dem WebGPU-Renderer (SDXLs VAE-Decoder überschreitet in fp16 den Wertebereich, s.
 * `tools/convert/convert_model.py`, Modulkopf). 355 Unit-Tests, acht Gate-Schritte und 24
 * bisherige Smoke-Punkte hätten das nicht gesehen — keiner misst Pixel.
 *
 * Liest das aktuell angezeigte `.lig-image` über ein `<canvas>` (`getImageData`) und liefert
 * zwei UNABHÄNGIGE Maße über die LUMA (0,299 R + 0,587 G + 0,114 B je Pixel) — Standardabweichung
 * und Zahl distinkter Luma-STUFEN (auf 6 Bit / 64 Stufen quantisiert, gegen Kompressionsrauschen).
 *
 * BEWUSST Luma statt RGB-Farbkombinationen (Review-Fund, zweite Runde): eine frühere Fassung
 * zählte distinkte (R,G,B)-Tripel nach 4-Bit-Quantisierung je Kanal (max. 4096 erreichbar). Für
 * ein echtes Graustufenbild (R=G=B, wie der Smoke-Prompt „ein grauer Kieselstein" es nahelegt)
 * kollabieren die erreichbaren Werte auf die DIAGONALE — höchstens 16 von 4096 — gegen eine
 * Grenze von 64. Ein KORREKTES Graustufenbild wäre also per Konstruktion durchgefallen; nur
 * Sampling-Rauschen (Pixel, die knapp von der Diagonale abweichen) rettete den Punkt bislang,
 * belegt bei n=1. Die Luma-Zahl selbst ist für Grau- wie Farbbilder derselbe Wertebereich (0–63
 * Stufen erreichbar in beiden Fällen) — kein Bild wird für fehlende Buntheit bestraft.
 *
 * Zwei Maße statt eines, weil sie an unterschiedlichen Fehlerbildern hängen — ein reines
 * Schwarz steht bei BEIDEN auf 0/1, ein schwacher Farbverlauf (z. B. 0→40 über die ganze
 * Fläche) besetzt nur wenige Luma-Stufen (Stufenbreite 4 → ~10 von 64) und kann so bei der
 * Stufenzahl durchfallen, während seine Standardabweichung schon ausreicht — und umgekehrt
 * eine Standardabweichung, die zwei weit auseinanderliegende, aber je flache Cluster erzeugt,
 * bei der Stufenzahl durchfällt. Beide Grenzen müssen zugleich reißen.
 */
async function pixelStats(cdp: Cdp): Promise<{ width: number; height: number; stddev: number; distinctLuma: number } | null> {
  return cdp.evaluate(`
    const img = document.querySelector(".lig-image");
    if (!img || !img.src.startsWith("data:image/png")) return null;
    const bild = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Bild liess sich nicht laden"));
      el.src = img.src;
    });
    const canvas = document.createElement("canvas");
    canvas.width = bild.naturalWidth;
    canvas.height = bild.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bild, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0, sumSq = 0;
    const stufen = new Set();
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += luma; sumSq += luma * luma;
      stufen.add(Math.min(63, Math.floor(luma / 4)));
    }
    const mean = sum / n;
    const variance = Math.max(0, sumSq / n - mean * mean);
    return { width: canvas.width, height: canvas.height, stddev: Math.sqrt(variance), distinctLuma: stufen.size };
  `);
}

/** Grenzwerte für `pixelStats()` — Verifikation in `phase4-fix-report.md` (Block 2): ein rein
 *  schwarzes Bild misst Stddev 0,0 und 1 distinkte Luma-Stufe (von 64 erreichbaren); eine echte
 *  Generierung (SD-Turbo wie SDXL-Turbo, gemessen an mehreren Prompts/Seeds) liegt weit über
 *  beiden Grenzen. Beide Grenzen müssen zugleich reißen, damit der Punkt grün wird — s.
 *  Kommentar an `pixelStats()`, warum ein Maß allein nicht reicht. */
const CONTENT_STDDEV_MIN = 8;
const CONTENT_LUMA_BUCKETS_MIN = 20;

/** Was der Server selbst über sein aktives Modell sagt — vom Treiber direkt geholt, nicht
 *  vom Plugin erfragt. Ein Prüfwerkzeug, das seine Erwartung aus dem Prüfling bezieht,
 *  bestätigt nur dessen Meinung: genau so blieb der `model`/`sd_model_checkpoint`-Fehlgriff
 *  unentdeckt. A1111/Forge/SD.Next melden `sd_model_checkpoint`, Draw Things `model`. */
async function serverModelName(endpoint: string): Promise<string | null> {
  const base = endpoint.replace(/\/+$/, "");
  const response = await fetch(`${base}/sdapi/v1/options`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Server antwortet mit HTTP ${response.status} auf /sdapi/v1/options`);
  const body = (await response.json()) as Record<string, unknown>;
  const raw = body["sd_model_checkpoint"] ?? body["model"];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

/** Ergebnis des Server-Guards. Die Unterscheidung ist der ganze Zweck: ein Server, der NICHT
 *  ANTWORTET, ist eine fehlende Umgebungsbedingung — der Treiber konnte nicht messen. Ein
 *  Server, der FALSCH antwortet (HTTP-Fehler, kein Modellname), ist ein Befund und bleibt ein
 *  Abbruch. Ohne diese Trennung meldet ein abgeschalteter Bild-Server sich als Defekt am
 *  Prüfling, und die Suche beginnt an der falschen Stelle. */
type ServerProbe = { reachable: true; model: string } | { reachable: false; grund: string };

/** Antwortet der Bild-Server? Nur Transportfehler (Server aus, falscher Port, Timeout) gelten
 *  als „nicht erreichbar"; alles, was der Server selbst sagt, wird durchgereicht. */
async function probeServer(endpoint: string): Promise<ServerProbe> {
  let model: string | null;
  try {
    model = await serverModelName(endpoint);
  } catch (error: unknown) {
    // `fetch` wirft bei ECONNREFUSED/DNS/Timeout — die eigentliche Ursache steht in `cause`,
    // die äußere Meldung ist nur „fetch failed" und benennt nichts.
    if (error instanceof Error && error.message.startsWith("Server antwortet mit HTTP")) throw error;
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const text = error instanceof Error ? error.message : String(error);
    return { reachable: false, grund: cause ? `${text} (${cause})` : text };
  }
  if (model === null) {
    throw new Error(
      `Der Server unter ${endpoint} nennt weder \`model\` noch \`sd_model_checkpoint\`. ` +
        `Ohne bekanntes Erwartungs-Modell ist Punkt 2/3 nicht prüfbar.`,
    );
  }
  return { reachable: true, model };
}

/**
 * Punkte 13–16: die eingebaute Engine — vom Modell-Download bis zur Ergebnis-Notiz. Läuft nach
 * den Server-Punkten im selben Panel; die Settings (Ordner, createMode) stehen noch auf Smoke.
 */
async function runBuiltinChecks(cdp: Cdp, assetsBase: string, generateTimeoutMs: number): Promise<void> {
  const readyText = t("status.ready");
  const engineState = () =>
    cdp.evaluate<{ kind: string; file?: string; received?: number; total?: number; message?: string; reason?: string }>(
      `return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].getEngineState();`,
    );
  const statusText = () =>
    cdp.evaluate<string>(`const el = document.querySelector(".lig-status-text"); return el ? el.textContent.trim() : "";`);

  // 13-15 sind fuer SD-Turbo geschrieben (Punkt 15 prueft `model: sd-turbo`) und muessen das
  // deshalb selbst ETABLIEREN statt es aus data.json zu ERBEN — sonst haengt der Lauf am
  // Modell, das die letzte Session zufaellig hinterlassen hat (gemessen 2026-08-24: mit
  // "sdxl-turbo" geerbt schlug Punkt 13 den 7-GB-Download statt des 2,5-GB-Downloads vor,
  // Punkt 14 lief 66 Minuten, 15/16/24 wurden uebersprungen). Originalwert deshalb hier
  // gemerkt und im `finally` zurueckgestellt, wie `runModelStageChecks()` es vormacht.
  const originalModel = await cdp.evaluate<BuiltinModelId>(
    `return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.builtinModel;`,
  );
  try {
    // --- 13. Modus umstellen -------------------------------------------------
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.assetBaseUrl = ${JSON.stringify(assetsBase)};
      await p.saveSettings();
      await p.setEngine("builtin");
      if (p.settings.builtinModel !== ${JSON.stringify(DEFAULT_BUILTIN_MODEL_ID)}) {
        await p.setBuiltinModel(${JSON.stringify(DEFAULT_BUILTIN_MODEL_ID)});
      }
      return true;
    `);
    let st = await pollUntil(engineState, (e) => e.kind !== "gpu-checking", 30_000, "warte auf den GPU-Check", 500);
    if (st?.kind === "gpu-missing") {
      record("13. Engine auf „Eingebaut“ — Panel zeigt den Modellzustand", true, `GPU fehlt (${st.reason}) — Panel meldet es; 14–16, 24 gegenstandslos`);
      for (const n of [
        "14. Download über den Panel-Knopf endet auf „bereit“",
        "15. Die eingebaute Engine liefert ein Bild und eine Notiz mit model: sd-turbo",
        "16. Zurück auf „Server“ bringt die Regler zurück",
        "24. SD-Turbo liefert ein Bild mit echtem Inhalt, nicht Schwarz/uniform",
      ])
        skip(n, "kein WebGPU/shader-f16 auf diesem Gerät");
      return;
    }
    // Ein vorhandener Download wird entfernt, damit Punkt 14 den echten Weg misst — erlaubt,
    // weil die Quelle der lokale Server ist (siehe Kopfkommentar).
    if (st?.kind === "ready") {
      await cdp.evaluate(`await app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].removeModel(); return true;`);
      st = await pollUntil(engineState, (e) => e.kind === "not-downloaded", 30_000, "warte auf das Entfernen", 500);
    }
    // Gerendert messen, nicht die Klasse lesen: die war beim Bug vom 2026-08-21 gesetzt, während
    // die Zeile im Bild stand. Punkt 17 prüft das systematisch — hier bleibt es als Vorbedingung
    // von 14/15 stehen, weil ein Panel mit sichtbarem Negativ-Prompt kein builtin-Panel ist.
    const negHidden = await cdp.evaluate<boolean>(`
      const el = document.querySelector(".lig-negative-row");
      return !!el && getComputedStyle(el).display === "none";
    `);
    const ctaLabel = await cdp.evaluate<string>(`
      const b = document.querySelector(".lig-empty button");
      return b && getComputedStyle(b).display !== "none" ? b.textContent.trim() : "";
    `);
    const notDownloaded = t("status.notDownloaded");
    const status13 = await statusText();
    record(
      "13. Engine auf „Eingebaut“ — Panel zeigt den Modellzustand",
      st?.kind === "not-downloaded" && status13 === notDownloaded && negHidden && ctaLabel !== "",
      st?.kind !== "not-downloaded"
        ? `Engine-Zustand ${JSON.stringify(st)}`
        : `Status „${status13}" · Negativ-Prompt ausgeblendet: ${negHidden} · CTA „${ctaLabel}"`,
    );
    if (st?.kind !== "not-downloaded") {
      skip("14. Download über den Panel-Knopf endet auf „bereit“", "Vorbedingung 13 nicht erreicht");
      skip("15. Die eingebaute Engine liefert ein Bild und eine Notiz mit model: sd-turbo", "Vorbedingung 13 nicht erreicht");
      skip("16. Zurück auf „Server“ bringt die Regler zurück", "Vorbedingung 13 nicht erreicht");
      skip("24. SD-Turbo liefert ein Bild mit echtem Inhalt, nicht Schwarz/uniform", "Vorbedingung 13 nicht erreicht");
      return;
    }

    // --- 14. Download über den Panel-Knopf -------------------------------------
    const t0 = Date.now();
    // Frist proportional zum Modell — Punkt 13 hat es oben auf DEFAULT_BUILTIN_MODEL_ID
    // (sd-turbo) ETABLIERT, hier nicht erneut aus data.json lesen. Siehe downloadDeadlineMs()
    // für die Herleitung.
    const downloadDeadline14 = downloadDeadlineMs(totalBytes([...assetsFor(DEFAULT_BUILTIN_MODEL_ID), RUNTIME_WASM]));
    await clickReal(cdp, `document.querySelector(".lig-empty button")`);
    let sawProgress = false;
    const done14 = await pollUntil(
      async () => {
        const e = await engineState();
        if (e.kind === "downloading" && (e.received ?? 0) > 0) sawProgress = true;
        return e;
      },
      // „not-downloaded" ist der STARTzustand — als Ende zählt er erst nach gesehenem Fortschritt
      // (Abbruch). Gemessen 2026-08-19: ohne diese Bedingung endete der Prüfpunkt sofort rot.
      (e) => e.kind === "ready" || e.kind === "error" || (sawProgress && e.kind === "not-downloaded"),
      downloadDeadline14,
      "warte auf den Modell-Download",
      1000,
    );
    const status14 = await statusText();
    record(
      "14. Download über den Panel-Knopf endet auf „bereit“",
      done14?.kind === "ready" && sawProgress && status14 === readyText,
      done14 === null
        ? `Download nach ${Math.round(downloadDeadline14 / 60_000)} min nicht fertig`
        : done14.kind === "ready"
          ? `${Math.round((Date.now() - t0) / 1000)} s · Fortschritt gesehen: ${sawProgress} · Status „${status14}"`
          : `Engine-Zustand ${JSON.stringify(done14)}`,
    );
    if (done14?.kind !== "ready") {
      skip("15. Die eingebaute Engine liefert ein Bild und eine Notiz mit model: sd-turbo", "Vorbedingung 14 nicht erreicht");
      skip("16. Zurück auf „Server“ bringt die Regler zurück", "Vorbedingung 14 nicht erreicht");
      skip("24. SD-Turbo liefert ein Bild mit echtem Inhalt, nicht Schwarz/uniform", "Vorbedingung 14 nicht erreicht");
      return;
    }

    // --- 15. Bild + Notiz ------------------------------------------------------
    const notesBefore = await cdp.evaluate<number>(`return app.vault.getFiles().filter((f) => f.path.startsWith(${JSON.stringify(`${SMOKE_FOLDER}/`)}) && f.extension === "md").length;`);
    await cdp.evaluate(`
      const ta = document.querySelector(".lig-panel textarea.lig-prompt");
      ta.value = ${JSON.stringify(SMOKE_PROMPT + ", built-in")}; ta.dispatchEvent(new Event("input", { bubbles: true }));
      const seed = document.querySelector(".lig-panel input.lig-seed");
      seed.value = "4242"; seed.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    `);
    const t1 = Date.now();
    // Wie Punkt 7: es zählt nur ein NEUES Bild, nicht das aus dem Reroll von Punkt 11.
    const imageBefore15 = await cdp.evaluate<string>(`const img = document.querySelector(".lig-image"); return img ? String(img.src.length) + ":" + img.src.slice(-48) : "";`);
    await clickReal(cdp, `document.querySelector(".lig-generate")`);
    let sawLoading = false;
    const image15 = await pollUntil(
      async () => {
        const r = await cdp.evaluate<{ length: number; status: string; sig: string }>(`
          const img = document.querySelector(".lig-image");
          const status = document.querySelector(".lig-status-text");
          return { length: img && img.src.startsWith("data:image/png") ? img.src.length : 0, status: status ? status.textContent.trim() : "", sig: img ? String(img.src.length) + ":" + img.src.slice(-48) : "" };
        `);
        if (r.status.includes("GPU")) sawLoading = true;
        return r;
      },
      (r) => (r.length > 5000 && r.sig !== imageBefore15 && r.status === readyText) || istFehler(r.status),
      generateTimeoutMs,
      "warte auf das Bild der eingebauten Engine",
      500,
    );
    let note15: { model: string | null; steps: number | null } | null = null;
    if (image15 !== null && !istFehler(image15.status)) {
      const createLabel = t("generate.button.create");
      await cdp.evaluate(`
        const button = [...document.querySelectorAll(".lig-actions button")].find((b) => b.textContent.trim() === ${JSON.stringify(createLabel)});
        if (!button) throw new Error("Knopf nicht gefunden: " + ${JSON.stringify(createLabel)});
        button.click(); return true;
      `);
      const body = await pollUntil(
        () =>
          cdp.evaluate<string | null>(`
            const files = app.vault.getFiles().filter((f) => f.path.startsWith(${JSON.stringify(`${SMOKE_FOLDER}/`)}) && f.extension === "md");
            if (files.length <= ${notesBefore}) return null;
            files.sort((a, b) => b.stat.ctime - a.stat.ctime);
            return await app.vault.cachedRead(files[0]);
          `),
        (b) => b !== null,
        60_000,
        "warte auf die Ergebnis-Notiz",
        1000,
      );
      if (body) {
        const model = body.match(/^model:\s*(.+)$/m)?.[1]?.trim() ?? null;
        const stepsRaw = body.match(/^steps:\s*(\d+)$/m)?.[1];
        note15 = { model, steps: stepsRaw ? Number(stepsRaw) : null };
      }
    }
    record(
      "15. Die eingebaute Engine liefert ein Bild und eine Notiz mit model: sd-turbo",
      image15 !== null && !istFehler(image15.status) && note15?.model === "sd-turbo" && (note15.steps ?? 99) <= 4,
      image15 === null
        ? "kein Bild innerhalb der Frist"
        : istFehler(image15.status)
          ? `Lauf gescheitert, gemeldet vom Plugin: „${image15.status}"`
          : `${Math.round((Date.now() - t1) / 1000)} s · ${Math.round(image15.length / 1024)} KB · Ladephase gesehen: ${sawLoading} · Notiz: ${JSON.stringify(note15)}`,
    );

    // --- 24. Inhalt statt Form — billige Zusatzabsicherung fuer SD-Turbo -------
    // Kostet nichts extra: misst dasselbe Bild, das Punkt 15 ohnehin schon generiert hat, kein
    // zweiter Lauf. SD-Turbo hat keinen bekannten fp16-Defekt (siehe convert_model.py) — aber die
    // Pruefkette war bis Phase 4 komplett blind gegen ein rein schwarzes/uniformes Bild, und ob
    // ein spaeteres ORT-/Treiber-Upgrade SD-Turbo dieselbe Fehlerklasse eintraegt, ist unbekannt.
    // Fuer diese eine zusaetzliche Messung an einem ohnehin vorhandenen Bild lohnt sich das.
    const NAME24 = "24. SD-Turbo liefert ein Bild mit echtem Inhalt, nicht Schwarz/uniform";
    if (image15 !== null && !istFehler(image15.status)) {
      const stats15 = await pixelStats(cdp);
      record(
        NAME24,
        stats15 !== null && stats15.stddev >= CONTENT_STDDEV_MIN && stats15.distinctLuma >= CONTENT_LUMA_BUCKETS_MIN,
        stats15 === null
          ? "Bild nicht lesbar (kein PNG-Data-URL)"
          : `${stats15.width}×${stats15.height} · Luma-Stddev ${stats15.stddev.toFixed(1)} (Grenze ${CONTENT_STDDEV_MIN}) · ${stats15.distinctLuma} distinkte Luma-Stufen (Grenze ${CONTENT_LUMA_BUCKETS_MIN})`,
      );
    } else {
      skip(NAME24, "Vorbedingung 15 nicht erreicht (kein Bild)");
    }

    // --- 16. Zurück auf Server -------------------------------------------------
    await cdp.evaluate(`await app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].setEngine("server"); return true;`);
    await new Promise((r) => setTimeout(r, 1000));
    const back = await cdp.evaluate<{ neg: boolean; cfg: boolean; max: string }>(`
      const sichtbar = (sel) => {
        const el = document.querySelector(sel);
        return !!el && getComputedStyle(el).display !== "none";
      };
      return { neg: sichtbar(".lig-negative-row"), cfg: sichtbar(".lig-cfg"), max: document.querySelector(".lig-steps")?.max ?? "" };
    `);
    record("16. Zurück auf „Server“ bringt die Regler zurück", back.neg && back.cfg && back.max === String(STEPS.max), `Negativ ${back.neg} · CFG ${back.cfg} · Steps-Max ${back.max}`);
  } finally {
    // Gilt auch bei einem frühen `return` oben (GPU fehlt, Vorbedingung 13/14 nicht erreicht) —
    // ein Treiber, der das geerbte Modell überschreibt, muss es unabhängig vom Ausgang wieder
    // hinstellen, wie es dastand.
    await cdp
      .evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        if (p.settings.builtinModel !== ${JSON.stringify(originalModel)}) {
          await p.setBuiltinModel(${JSON.stringify(originalModel)});
        }
        return true;
      `)
      .catch(() => undefined);
  }
}

/**
 * Punkt 17: sind die Regler, die ein Backend nicht kann, auch GERENDERT weg?
 *
 * Eigener Punkt statt einer Zeile in 13/16, aus zwei Gründen. Erstens misst er etwas anderes:
 * 13 und 16 fragen, ob das Panel den Zustand richtig setzt — 17 fragt, ob das CSS ihn auch
 * durchsetzt. Zweitens hängt er an nichts: kein Download, kein Asset-Server, keine
 * Generierung. Ein CSS-Regressionsschutz, der nur im Vollauf mitläuft, schützt genau dann
 * nicht, wenn man ihn braucht.
 *
 * Anlass (2026-08-21): `.is-hidden { display: none }` verlor gegen die später notierte Regel
 * `.lig-prompt-row { display: flex }` — gleiche Spezifität, die spätere gewinnt. Das Panel
 * hatte die Klasse korrekt gesetzt, 237 Unit-Tests und 16 Smoke-Punkte waren grün, und die
 * Negativ-Prompt-Zeile stand trotzdem im builtin-Modus im Bild. Genau der Fall, den ein
 * Prüfpunkt auf `classList.contains("is-hidden")` nicht sehen kann: er fragt den Prüfling
 * nach seiner Absicht, nicht nach dem Ergebnis.
 */
const MODUS_REGLER = [
  ".lig-negative-row",
  ".lig-cfg-label",
  ".lig-cfg",
  ".lig-cfg-value",
  // img2img (0.8): die ganze Vorlagen-Zeile haengt am Modus. Der Denoise-Regler steht
  // BEWUSST nicht hier — er haengt zusaetzlich daran, ob eine Vorlage gesetzt ist, und
  // waere im Server-Modus ohne Vorlage korrekterweise unsichtbar. Ihn hier zu fuehren
  // hiesse, die zweite Sichtbarkeitsstufe als Defekt zu melden.
  ".lig-init-row",
  ".lig-init-from-result",
  // Zweite Modellstufe (0.9): `.lig-model-pick` steht aus demselben Grund NICHT hier wie
  // `.lig-denoise` — es haengt an ZWEI unabhaengigen Bedingungen (showModelPicker UND
  // downloadedModels.length > 1), nicht am Modus allein. Im Server-Modus waere es korrekt
  // unsichtbar (kein builtin), im builtin-Modus mit nur einem geladenen Modell ebenso — hier
  // gefuehrt, meldete Punkt 17 diese zweite Stufe als Defekt. Eigener Prüfpunkt: 21.
  //
  // `.lig-size-slot` steht aus demselben Grund NICHT hier (seit der zweiten Modellstufe,
  // 2026-08-24 im GUI-Smoke gemessen): die Zeile haengt an ZWEI unabhaengigen Bedingungen
  // (Modus UND `sizes.length > 1` — sizes ist im Server-Modus ohnehin `null`, s.
  // viewmodel.ts). SDXL-Turbo hat zwei Groessen; im builtin-Modus MIT SDXL-Turbo ist die
  // Zeile deshalb korrekt sichtbar, waehrend Punkt 17 (der nur den MODUS wechselt, das
  // Modell aber unveraendert laesst, egal welches gerade in data.json steht) das als
  // "builtin trotzdem sichtbar" meldete. Eigener Prüfpunkt: 22 (misst beide Modelle explizit).
] as const;

/** Gerenderte Sichtbarkeit + Zustand jedes modusabhängigen Reglers, aus dem Renderer geholt.
 *  `display` kommt aus `getComputedStyle` (die Kaskade entsteht erst im Browser), `hidden`
 *  aus der Klasse — beide, damit ein Rot sagt, WELCHE der zwei Schichten gerissen ist. */
async function reglerSicht(cdp: Cdp): Promise<{
  regler: { sel: string; display: string; hidden: boolean; fehlt: boolean }[];
  steps: { wert: string; anzeige: string; max: string };
}> {
  return cdp.evaluate(`
    const sel = ${JSON.stringify(MODUS_REGLER)};
    const regler = sel.map((s) => {
      const el = document.querySelector(s);
      if (!el) return { sel: s, display: "", hidden: false, fehlt: true };
      return { sel: s, display: getComputedStyle(el).display, hidden: el.classList.contains("is-hidden"), fehlt: false };
    });
    const steps = document.querySelector(".lig-steps");
    const stepsValue = document.querySelector(".lig-steps-value");
    return {
      regler,
      steps: {
        wert: steps ? steps.value : "",
        anzeige: stepsValue ? stepsValue.textContent.trim() : "",
        max: steps ? steps.max : "",
      },
    };
  `);
}

/**
 * Beide Richtungen in einem Punkt: builtin versteckt, server bringt zurück. Ein Prüfpunkt, der
 * nur das Verstecken misst, ist mit `display: none !important` auf alles zu bestehen.
 */
async function runControlVisibilityCheck(cdp: Cdp): Promise<void> {
  const setzeModus = async (mode: "builtin" | "server"): Promise<void> => {
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      if (p.settings.engine !== ${JSON.stringify(mode)}) await p.setEngine(${JSON.stringify(mode)});
      p.refreshViews();
      return true;
    `);
    // Der Moduswechsel stößt einen GPU-Check an; die Regler hängen aber allein am Modus
    // (viewmodel.ts: `controls: builtin ? … : …`), das Rendern ist also nach einem Tick durch.
    await new Promise((r) => setTimeout(r, 800));
  };

  // Den Regler VOR dem Wechsel über das builtin-Maximum schieben — sonst findet das Klemmen
  // gar nicht statt und die Beschriftung kann nicht danebenliegen. Gemessen 2026-08-22 beim
  // Bau dieses Punktes: mit dem Standardwert 4 blieb er auch mit wieder eingebautem Defekt
  // grün. Ein Prüfpunkt, der die Vorbedingung seines Bugs nicht herstellt, misst nichts.
  await setzeModus("server");
  const stepsVorLauf = await cdp.evaluate<string>(`
    const el = document.querySelector(".lig-steps");
    const alt = el.value;
    el.value = el.max;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return alt;
  `);
  const vorher = await reglerSicht(cdp);

  await setzeModus("builtin");
  const drin = await reglerSicht(cdp);
  await setzeModus("server");
  const raus = await reglerSicht(cdp);
  // Zurückstellen: der Treiber gibt den Wirt so zurück, wie er ihn vorfand — auch in dem
  // bisschen UI-Zustand, das kein Setting ist und deshalb vom Aufräumblock nicht erfasst wird.
  await cdp.evaluate(`
    const el = document.querySelector(".lig-steps");
    el.value = ${JSON.stringify(stepsVorLauf)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  `);

  const fehlend = [...drin.regler, ...raus.regler].filter((r) => r.fehlt).map((r) => r.sel);
  const nichtWeg = drin.regler.filter((r) => !r.fehlt && r.display !== "none");
  const nichtDa = raus.regler.filter((r) => !r.fehlt && r.display === "none");
  // Die Beschriftung neben dem Regler ist ein eigenes Span und wird nicht vom Browser
  // mitgeklemmt, wenn `max` sinkt — sie kann also stehenbleiben, während gerechnet wird.
  const stepsSchief = [vorher.steps, drin.steps, raus.steps].filter((s) => s.anzeige !== s.wert);
  // Ohne echtes Klemmen ist die Steps-Hälfte dieses Punktes gegenstandslos — das gehört in die
  // Meldung, nicht ins Schweigen.
  const geklemmt = Number(vorher.steps.wert) > Number(drin.steps.max);

  const teile: string[] = [];
  if (fehlend.length > 0) teile.push(`nicht im DOM: ${[...new Set(fehlend)].join(", ")}`);
  if (nichtWeg.length > 0) teile.push(`builtin trotzdem sichtbar: ${nichtWeg.map((r) => `${r.sel} → display:${r.display}${r.hidden ? "" : " (auch die Klasse fehlt)"}`).join(", ")}`);
  if (nichtDa.length > 0) teile.push(`server bleibt weg: ${nichtDa.map((r) => r.sel).join(", ")}`);
  if (stepsSchief.length > 0) teile.push(`Steps-Beschriftung ≠ Regler: ${stepsSchief.map((s) => `„${s.anzeige}" bei value ${s.wert} (max ${s.max})`).join(", ")}`);
  if (!geklemmt) teile.push(`Steps wurde nicht geklemmt (${vorher.steps.wert} → max ${drin.steps.max}) — die Beschriftung ist damit ungeprüft`);

  record(
    "17. Die modusabhängigen Regler sind auch GERENDERT weg — und kommen zurück",
    teile.length === 0,
    teile.length === 0
      ? `${MODUS_REGLER.length} Regler je Richtung (getComputedStyle) · Steps geklemmt ${vorher.steps.wert} → ${drin.steps.anzeige}/${drin.steps.max}, zurück ${raus.steps.anzeige}/${raus.steps.max}`
      : teile.join(" · "),
  );
}

/**
 * Punkt 18: ist die Provider-API am laufenden Obsidian registriert und formtreu?
 *
 * Das ist die Aussage, die kein Unit-Test treffen kann. `plugin-api.test.ts` prueft die
 * Fassade gegen Fakes; ob `this.api` im onload wirklich gesetzt wird und ueber
 * `app.plugins.plugins[...]` erreichbar ist, sieht man nur am Wirt.
 *
 * 18b beweist nur die FORM, nicht den Wert — und das auch nur fuer den Server-Zweig. Zum
 * Zeitpunkt dieses Punktes steht der Modus auf "server" (Punkt 17 laesst ihn dort stehen);
 * `capabilities.negativePrompt`/`maxSteps` werden also im Server-Pfad gemessen, nicht im
 * builtin-Pfad. Die Download-Zusage (generate() im builtin-Modus OHNE Assets sagt
 * "model-not-downloaded" ab, statt zu laden) misst dieser Punkt bewusst NICHT: dafuer
 * muesste der Treiber den Modus wechseln und danach zuruecksetzen — und ob dieser Vault
 * gerade Assets liegen hat, ist unbekannt (ein frueherer --builtin-Lauf koennte sie
 * zurueckgelassen haben). Ein Wechsel ohne bekannten Ausgangszustand pruefte im Zweifel gar
 * nichts, waere aber der riskantere, zustandsveraendernde Teil des Punktes.
 *
 * Was die Zusage stattdessen traegt, ist STRUKTURELL, nicht gemessen: `ModelStore.getBuffer`/
 * `getText` gehen ueber `matchOrThrow` (src/obsidian/model-store.ts), das bei einem
 * Cache-Fehltreffer WIRFT und nie laedt. Der einzige Ladepfad ist `ModelStore.download`,
 * aufgerufen ausschliesslich von `startDownload()`, das an genau zwei vom Nutzer geklickte
 * Bedienelemente haengt und in `ApiDeps` (src/main.ts) nicht vorkommt. Selbst ohne das
 * Bereitschafts-Gate endet ein builtin-`generate()` ohne Assets als
 * `{ ok: false, reason: "failed" }` — nicht als stiller Download.
 */
async function runApiCheck(cdp: Cdp): Promise<void> {
  const form = await cdp.evaluate<{ version: unknown; keys: string[]; status: Record<string, unknown> }>(`
    const api = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.api;
    if (!api) return { version: null, keys: [], status: {} };
    return {
      version: api.apiVersion,
      keys: ["status", "generate", "save"].filter((k) => typeof api[k] === "function"),
      status: api.status(),
    };
  `);

  record(
    "18a. Die Provider-API ist registriert und formtreu",
    form.version === IMAGE_GENERATION_API_VERSION && form.keys.length === 3,
    `apiVersion=${String(form.version)}, Methoden=${form.keys.join(",") || "keine"}`,
  );

  const caps = form.status["capabilities"] as Record<string, unknown> | undefined;
  record(
    "18b. status() meldet Faehigkeiten typgerecht",
    caps !== undefined && typeof caps["negativePrompt"] === "boolean" && typeof caps["maxSteps"] === "number",
    JSON.stringify(caps ?? null),
  );
}

/** Zähler des Mock-Servers (`.mock-a1111-counts.json`). null, wenn kein Mock läuft — dann
 *  ist Punkt 19 nicht messbar und wird übersprungen statt geraten. */
function mockCounts(): Record<string, number> | null {
  // NICHT relativ zu `import.meta.url`: dieser Treiber wird nach `.gui-smoke.mjs` ins
  // REPO-ROOT gebundelt, `../` zeigte von dort eine Ebene zu hoch (gemessen 2026-08-23 im
  // ersten Lauf — der Punkt uebersprang sich mit „Zaehlerdatei fehlt", obwohl der Mock lief).
  // Der Mock selbst liegt in scripts/ und rechnet dort korrekt mit `../`. npm-Skripte laufen
  // im Paket-Root, cwd ist damit die verlaessliche Bezugsgroesse.
  const file = join(process.cwd(), ".mock-a1111-counts.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
  } catch {
    return null;
  }
}

/**
 * Punkt 19: geht ein Lauf MIT Vorlage wirklich an /sdapi/v1/img2img?
 *
 * Gemessen wird am ZÄHLER DES SERVERS, nicht am Zustand des Panels. Der Unterschied ist der
 * ganze Punkt: `state.initImage` kann gesetzt, `controls.denoising` sichtbar und das Rezept
 * korrekt sein, während die Anfrage trotzdem am txt2img-Endpunkt landet — genau die
 * Fehlerklasse, die ein zustandsbasierter Test nicht sehen kann (Lesson 2026-08-21).
 * Der Mock antwortet zusätzlich mit 400, wenn ein img2img ohne `init_images` ankommt; ein
 * reiner Endpunkt-Zähler würde diesen Fehler durchlassen.
 *
 * Der Lauf geht über die Provider-API statt über das Panel: dort ist die Vorlage ein
 * Base64-Parameter, der Punkt braucht also keine Vault-Datei und keinen Klickpfad — und er
 * misst denselben `runGeneration`-Weg, den auch der Generate-Knopf nimmt.
 */
async function runImg2ImgCheck(cdp: Cdp, generateTimeoutMs: number): Promise<void> {
  const NAME = "19. Ein Lauf mit Vorlage geht an /sdapi/v1/img2img";
  const vorher = mockCounts();
  if (vorher === null) {
    skip(NAME, "kein Mock-Server (Zählerdatei fehlt) — am echten Server nicht messbar");
    return;
  }

  // 1×1-PNG, transparent. Reicht als Vorlage: der Mock prüft die Form, nicht den Inhalt.
  const PIXEL =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  // Mutation und Wartephase getrennt (AGENTS-Gotcha): `Cdp.send` bricht nach 30 s ab, ein
  // Bildlauf darf laenger dauern. Der Aufruf legt sein Ergebnis im Renderer ab, das Warten
  // passiert hier auf der Node-Seite.
  await cdp.evaluate(`
    const api = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.api;
    window.__ligSmokeImg2Img = { fertig: false };
    if (!api) { window.__ligSmokeImg2Img = { fertig: true, ok: false, reason: "keine API" }; return true; }
    api.generate({ prompt: "smoke img2img", initImage: ${JSON.stringify(PIXEL)}, denoising: 0.4, steps: 1 })
      .then((r) => {
        window.__ligSmokeImg2Img = r.ok
          ? { fertig: true, ok: true, denoising: r.image.params.denoising }
          : { fertig: true, ok: false, reason: r.reason };
      })
      .catch((e) => { window.__ligSmokeImg2Img = { fertig: true, ok: false, reason: String(e) }; });
    return true;
  `);

  const lauf = (await pollUntil(
    () =>
      cdp.evaluate<{ fertig: boolean; ok?: boolean; reason?: string; denoising?: number | null }>(
        `return window.__ligSmokeImg2Img ?? { fertig: false };`,
      ),
    (v) => v.fertig,
    generateTimeoutMs,
    "warte auf den img2img-Lauf",
    1000,
  )) ?? { fertig: false, ok: false, reason: "Zeitlimit" };

  await cdp.evaluate(`delete window.__ligSmokeImg2Img; return true;`).catch(() => undefined);

  const nachher = mockCounts() ?? vorher;
  const img2img = (nachher["img2img"] ?? 0) - (vorher["img2img"] ?? 0);
  const txt2img = (nachher["txt2img"] ?? 0) - (vorher["txt2img"] ?? 0);

  const teile: string[] = [];
  if (!lauf.ok) teile.push(`generate() schlug fehl: ${lauf.reason ?? "unbekannt"}`);
  if (img2img !== 1) teile.push(`img2img-Anfragen: ${img2img} (erwartet 1)`);
  if (txt2img !== 0) teile.push(`txt2img-Anfragen: ${txt2img} (erwartet 0) — die Vorlage kam nicht an`);
  // Der Rückgabewert muss den Lauf als img2img ausweisen, sonst schreibt ein Konsument
  // txt2img-Metadaten in seine Notiz.
  if (lauf.ok && lauf.denoising !== 0.4) teile.push(`params.denoising: ${String(lauf.denoising)} (erwartet 0.4)`);

  record(NAME, teile.length === 0, teile.length === 0 ? `img2img +${img2img}, txt2img +${txt2img}, denoising ${String(lauf.denoising)}` : teile.join(" · "));
}

// --- Zweite Modellstufe (SDXL-Turbo, Spec 0.9): Punkte 20–23 --------------------------------

/** Zähler des lokalen Asset-Mocks (`.mock-assets-counts.json`, Schlüssel = die URL-Pathname
 *  MIT führendem Slash, z. B. `/sdxl-turbo/unet/model.onnx` — NICHT `sdxl-turbo/...` ohne ihn;
 *  das war der Bug, den Punkt 23 bei der Selbstprüfung dieses Tasks zeigte, s. dort). Dasselbe
 *  Muster wie `mockCounts()` oben, eigene Datei: der Bild-Mock und der Asset-Mock laufen
 *  unabhängig voneinander. */
function mockAssetCounts(): Record<string, number> | null {
  const file = join(process.cwd(), ".mock-assets-counts.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
  } catch {
    return null;
  }
}

/** Formatierter Name der Modell-Zeile im Settings-Tab, wie `settings-tab.ts` ihn baut
 *  (`t("settings.model.name", label, formatBytes(totalBytes(modelFiles(id))))`) — dieselbe
 *  Quelle wie das Plugin selbst, kein zweiter, driftender Erwartungswert im Treiber. */
function modelRowName(id: BuiltinModelId): string {
  const bytes = totalBytes([...assetsFor(id), RUNTIME_WASM]);
  return t("settings.model.name", BUILTIN_MODELS[id].label, formatBytes(bytes));
}

/** Lädt EIN Modell über den echten Weg (`startDownload()`), bestätigt einen eventuellen
 *  Dialog (nur bei einem Nicht-Default-Modell, Spec 0.9 §4). Wird von Punkt 21 gebraucht, um
 *  den Cache-Zustand „zwei geladene Modelle" ohne echten 6,4-GB-Netzabruf herzustellen — die
 *  Bytes kommen vom lokalen `mock-assets.mjs` (Ruling 2 des Controllers). */
async function downloadModelViaMock(cdp: Cdp, id: BuiltinModelId, timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
  await cdp.evaluate(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    if (p.settings.builtinModel !== ${JSON.stringify(id)}) await p.setBuiltinModel(${JSON.stringify(id)});
    window.__ligSmokeDl = { done: false };
    p.startDownload()
      .then(() => { window.__ligSmokeDl.done = true; })
      .catch((e) => { window.__ligSmokeDl = { done: true, error: String(e) }; });
    return true;
  `);
  if (id !== DEFAULT_BUILTIN_MODEL_ID) {
    const confirmLabel = t("confirm.bigModel.cta");
    const clicked = await pollUntil(
      () =>
        cdp.evaluate<boolean>(`
          const btn = [...document.querySelectorAll(".modal-button-container button")]
            .find((b) => b.textContent.trim() === ${JSON.stringify(confirmLabel)});
          if (btn) { btn.click(); return true; }
          return false;
        `),
      (v) => v === true,
      10_000,
      `warte auf den Bestätigungs-Dialog (${id})`,
      300,
    );
    if (clicked !== true) return { ok: false, detail: "Bestätigungs-Dialog nicht gefunden" };
  }
  const done = await pollUntil(
    () => cdp.evaluate<{ done: boolean; error?: string }>(`return window.__ligSmokeDl ?? { done: false };`),
    (v) => v.done,
    timeoutMs,
    `warte auf den Download von ${id}`,
    1500,
  );
  await cdp.evaluate(`delete window.__ligSmokeDl; return true;`).catch(() => undefined);
  if (done === null) return { ok: false, detail: "Zeitlimit" };
  if (done.error) return { ok: false, detail: done.error };
  return { ok: true, detail: "" };
}

/**
 * Punkt 20: ändert ein Modellwechsel im Settings-Tab wirklich die Download-Zeile darunter?
 *
 * Über das echte DROPDOWN geschaltet, nicht über einen direkten Settings-Write (Ruling des
 * Controllers, zweimal an einem Screenshot gemessen): nur `onChange` des Dropdowns ruft
 * `setBuiltinModel()` UND `refreshUi()`. Ein Test, der `settings.builtinModel` selbst setzt,
 * würde den Anlass des Wechsels wegnehmen und die Zeile bliebe unverändert stehen — ohne dass
 * das etwas über einen Bug im Plugin aussagt.
 */
async function runModelSwitchCheck(cdp: Cdp): Promise<void> {
  const NAME = "20. Modellwechsel im Settings-Tab ändert die Download-Zeile";
  const current = await cdp.evaluate<BuiltinModelId>(
    `return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.builtinModel;`,
  );
  const other: BuiltinModelId = current === "sd-turbo" ? "sdxl-turbo" : "sd-turbo";
  const erwartetVorher = modelRowName(current);
  const erwartetNachher = modelRowName(other);

  const result = await cdp.evaluate<{
    vorher: boolean;
    vorherAndereAbwesend: boolean;
    nachher: boolean;
    nachherAlteAbwesend: boolean;
    select: boolean;
  }>(`
    app.setting.open();
    app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 300));
    // Obsidian 1.13 cacht getSettingDefinitions() und wertet sie nicht bei jedem Oeffnen neu
    // aus (AGENTS.md-Gotcha) — nur der eigene Dropdown-onChange ruft refreshUi(). Der Engine-
    // Wechsel VOR diesem Punkt lief ueber plugin.setEngine() direkt (Punkt 20 selbst braucht
    // das nicht — nur die anderen drei Punkte in diesem Block), der Settings-Tab weiss davon
    // also noch nichts. Erzwungenes update() gleicht das aus, bevor "vorher" gelesen wird; der
    // Wechsel UNTEN geht ueber das echte Dropdown und loest refreshUi() dann selbst aus.
    if (app.setting.activeTab && typeof app.setting.activeTab.update === "function") app.setting.activeTab.update();
    const doc = app.setting?.activeTab?.containerEl?.ownerDocument ?? document;
    const namen = () => [...doc.querySelectorAll(".setting-item-name")].map((el) => el.textContent.trim());
    // Nicht nur "die erwartete Zeile ist da", auch "die ANDERE Zeile ist NICHT (mehr) da" —
    // sonst besteht ein Settings-Tab, der beide Modell-Zeilen gleichzeitig zeigt (z. B. ein
    // Rebuild-Bug, der die alte Zeile nicht entfernt), denselben Punkt trotzdem.
    const vorherAlle = namen();
    const vorher = vorherAlle.includes(${JSON.stringify(erwartetVorher)});
    const vorherAndereAbwesend = !vorherAlle.includes(${JSON.stringify(erwartetNachher)});
    const select = [...doc.querySelectorAll("select")]
      .find((s) => [...s.options].some((o) => o.value === ${JSON.stringify(other)}));
    if (!select) {
      app.setting.close();
      return { vorher, vorherAndereAbwesend, nachher: false, nachherAlteAbwesend: false, select: false };
    }
    const setter = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLSelectElement.prototype, "value").set;
    setter.call(select, ${JSON.stringify(other)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
    let nachherAlle = vorherAlle;
    const grenze = Date.now() + 8000;
    while (Date.now() < grenze) {
      nachherAlle = namen();
      if (nachherAlle.includes(${JSON.stringify(erwartetNachher)})) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const nachher = nachherAlle.includes(${JSON.stringify(erwartetNachher)});
    const nachherAlteAbwesend = !nachherAlle.includes(${JSON.stringify(erwartetVorher)});
    app.setting.close();
    return { vorher, vorherAndereAbwesend, nachher, nachherAlteAbwesend, select: true };
  `);

  const teile: string[] = [];
  if (!result.select) teile.push("Modell-Dropdown im Settings-Tab nicht gefunden");
  if (!result.vorher) teile.push(`Zeile vor dem Wechsel nicht gefunden (erwartet „${erwartetVorher}")`);
  if (!result.vorherAndereAbwesend) teile.push(`Zeile des ANDEREN Modells stand schon vor dem Wechsel da (erwartet „${erwartetNachher}" abwesend)`);
  if (!result.nachher) teile.push(`Zeile nach dem Wechsel nicht gefunden (erwartet „${erwartetNachher}")`);
  if (!result.nachherAlteAbwesend) teile.push(`Zeile des ALTEN Modells steht nach dem Wechsel noch da (erwartet „${erwartetVorher}" abwesend)`);
  record(
    NAME,
    teile.length === 0,
    teile.length === 0 ? `„${erwartetVorher}" → „${erwartetNachher}" (jeweils die andere Zeile abwesend)` : teile.join(" · "),
  );
}

/**
 * Punkt 22: folgt die Größen-Zeile im Panel dem gewählten Modell — GERENDERT gemessen, nicht
 * über den State (dieselbe Lehre wie Punkt 17: die Klasse kann korrekt gesetzt sein, während
 * eine spätere CSS-Regel sie trotzdem zeigt).
 */
async function runSizeRowCheck(cdp: Cdp): Promise<void> {
  const NAME = "22. Die Größen-Zeile folgt dem gewählten Modell";
  const measure = async (id: BuiltinModelId) => {
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      if (p.settings.builtinModel !== ${JSON.stringify(id)}) await p.setBuiltinModel(${JSON.stringify(id)});
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    return cdp.evaluate<{ display: string | null; options: number }>(`
      const el = document.querySelector(".lig-size-slot");
      const select = document.querySelector(".lig-size");
      return { display: el ? getComputedStyle(el).display : null, options: select ? select.options.length : 0 };
    `);
  };
  const sd = await measure("sd-turbo");
  const sdxl = await measure("sdxl-turbo");

  const teile: string[] = [];
  if (sd.display !== "none") teile.push(`sd-turbo: Größen-Zeile sichtbar (display:${sd.display}) — erwartet none`);
  if (sdxl.display === "none" || sdxl.display === null) teile.push(`sdxl-turbo: Größen-Zeile weg (display:${sdxl.display}) — erwartet sichtbar`);
  if (sdxl.options !== BUILTIN_MODELS["sdxl-turbo"].sizes.length) teile.push(`sdxl-turbo: ${sdxl.options} Größen-Optionen (erwartet ${BUILTIN_MODELS["sdxl-turbo"].sizes.length})`);
  record(
    NAME,
    teile.length === 0,
    teile.length === 0 ? `sd-turbo:${sd.display} · sdxl-turbo:${sdxl.display} (${sdxl.options} Optionen)` : teile.join(" · "),
  );
}

/**
 * Punkt 21: zeigt sich `.lig-model-pick` erst, wenn BEIDE Bedingungen gelten (showModelPicker
 * UND mehr als ein geladenes Modell) — drei Messungen über `getComputedStyle`, nicht über die
 * Klasse (dieselbe Begründung wie Punkt 17).
 *
 * Die dritte Stufe (zwei geladene Modelle) braucht einen echten Cache-Zustand — dafür lädt
 * dieser Punkt bei Bedarf über `downloadModelViaMock()` (lokaler Server, kein HF-Traffic,
 * Ruling 2 des Controllers). Fehlt der Asset-Mock, überspringt sich der GANZE Punkt LAUT
 * (nicht nur die dritte Stufe) — die Gegenprobe auf den Skip-Pfad ist der State-Check davor:
 * es wird NUR übersprungen, wenn der Cache-Zustand „zwei Modelle" weder schon vorliegt noch
 * ohne Mock herstellbar ist. Liegt er zufällig schon vor (ein früherer --builtin-Lauf hat
 * beide Modelle dagelassen), misst der Punkt trotzdem — ohne jeden neuen Download.
 */
async function runModelPickerCheck(cdp: Cdp, assetsBase: string, generateTimeoutMs: number): Promise<void> {
  const NAME = "21. Panel-Modell-Picker zeigt sich erst ab zwei geladenen Modellen";
  const assetsUp = await fetch(`${assetsBase.replace(/\/+$/, "")}/sd-turbo/tokenizer/vocab.json`, { method: "HEAD", signal: AbortSignal.timeout(3000) })
    .then((r) => r.status === 200)
    .catch(() => false);

  const displayOf = (sel: string) =>
    cdp.evaluate<string | null>(`
      const el = document.querySelector(${JSON.stringify(sel)});
      return el ? getComputedStyle(el).display : null;
    `);
  const setPicker = async (on: boolean): Promise<void> => {
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.showModelPicker = ${JSON.stringify(on)};
      await p.saveSettings();
      p.refreshViews();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
  };
  const geladeneModelle = () =>
    cdp.evaluate<BuiltinModelId[]>(`return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].downloadedModels;`);

  let geladen = await geladeneModelle();

  // Gegenprobe auf den Skip-Pfad: NUR überspringen, wenn der Zustand "zwei Modelle" weder
  // schon da ist noch ohne Mock herstellbar wäre. Ohne ihn ist KEINE der drei Stufen ehrlich
  // messbar (auch nicht "Toggle aus" — s. u.), der ganze Punkt wird also übersprungen, nicht
  // nur die dritte Stufe.
  if (geladen.length < 2 && !assetsUp) {
    skip(
      NAME,
      `weniger als zwei geladene Modelle (${geladen.length}) UND Asset-Mock unter ${assetsBase} nicht erreichbar (npm run smoke:assets) — der Zwei-Modell-Zustand ist ohne ihn nicht herstellbar, keine der drei Stufen ist damit ehrlich messbar`,
    );
    return;
  }

  // Zwei-Modell-Zustand HERSTELLEN, bevor irgendetwas gemessen wird (auch die Stufe "Toggle
  // aus"): fehlt hier eines der beiden, laedt der Helfer es nach — liegen beide schon vor
  // (z. B. ein frueherer Lauf), passiert nichts, der Zustand ist dann kostenlos gegeben.
  const herstellFehler: string[] = [];
  for (const id of ["sd-turbo", "sdxl-turbo"] as const) {
    geladen = await geladeneModelle();
    if (!geladen.includes(id)) {
      const dl = await downloadModelViaMock(cdp, id, generateTimeoutMs);
      if (!dl.ok) herstellFehler.push(`Download von ${id} fehlgeschlagen: ${dl.detail}`);
    }
  }
  if (herstellFehler.length > 0) {
    record(NAME, false, `Zwei-Modell-Zustand nicht herstellbar: ${herstellFehler.join(" · ")}`);
    return;
  }

  const teile: string[] = [];

  // a) Toggle aus — jetzt mit ZWEI geladenen Modellen gemessen, nicht vorher (Review-Fund):
  // mit nur einem geladenen Modell waere diese Stufe auch dann gruen, wenn showModelPicker
  // komplett ignoriert und die Sichtbarkeit allein an der Modellzahl haengen wuerde. Erst mit
  // dem Zwei-Modell-Zustand als Vorbedingung testet "aus" wirklich den TOGGLE.
  await setPicker(false);
  const aus = await displayOf(".lig-model-pick");

  // b) Toggle an, zwei Modelle — muss sichtbar sein.
  await setPicker(true);
  const an2 = await displayOf(".lig-model-pick");

  // c) Toggle an, EIN Modell — sdxl-turbo vorübergehend entfernen, danach wiederherstellen
  // (Nebenbefund Task 10 Gap 5: removeModel(id) darf NUR das eine Modell treffen).
  const entfernt = await cdp.evaluate<boolean>(
    `return await app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].removeModel(${JSON.stringify("sdxl-turbo" as BuiltinModelId)});`,
  );
  if (!entfernt) teile.push("removeModel(sdxl-turbo) für die Ein-Modell-Stufe fehlgeschlagen");
  await new Promise((r) => setTimeout(r, 300));
  const an1 = await displayOf(".lig-model-pick");
  const wiederhergestellt = await downloadModelViaMock(cdp, "sdxl-turbo", generateTimeoutMs);
  if (!wiederhergestellt.ok) teile.push(`Wiederherstellung von sdxl-turbo fehlgeschlagen: ${wiederhergestellt.detail}`);

  if (aus !== "none") teile.push(`Toggle aus (zwei Modelle geladen): display ${aus} (erwartet none)`);
  if (an1 !== "none") teile.push(`ein geladenes Modell: display ${an1} (erwartet none)`);
  if (an2 === "none" || an2 === null) teile.push(`zwei geladene Modelle: display ${an2} (erwartet sichtbar)`);

  record(
    NAME,
    teile.length === 0,
    teile.length === 0 ? `aus:${aus} · 1 Modell:${an1} · 2 Modelle:${an2}` : teile.join(" · "),
  );
}

/**
 * Punkt 23: lädt der Bestätigungsdialog vor einem großen Modell wirklich KEIN Byte, wenn man
 * ihn abbricht (Spec §4, „ohne Klick fließt kein Byte" — hier konkret: ein Klick auf den
 * FALSCHEN Knopf darf ebenfalls keinen fließen lassen). Gemessen am ZÄHLER DES SERVERS
 * (`.mock-assets-counts.json`), nicht am Panel-Zustand — dieselbe Begründung wie Punkt 19:
 * der Zustand kann korrekt aussehen, während die Anfrage trotzdem rausgeht.
 *
 * Zwei Review-Funde, beide hier behoben:
 *
 * 1. **Vorbedingung herstellen, nicht annehmen.** `ModelStore.download()` filtert bereits
 *    gecachte Dateien VOR jedem Netzwerkaufruf (`src/obsidian/model-store.ts`). Läuft dieser
 *    Punkt NACH Punkt 21 (der `sdxl-turbo` in beiden Zweigen vollständig geladen zurücklässt),
 *    wäre die Null-Messung unten bedeutungslos — sie träfe auch dann zu, wenn der Abbruch gar
 *    nichts täte, weil ohnehin nichts mehr zu laden war. Deshalb entfernt dieser Punkt
 *    `sdxl-turbo` selbst zuerst und bestätigt die Entfernung, unabhängig davon, in welcher
 *    Reihenfolge er aufgerufen wird.
 * 2. **Positiv-Kontrolle.** Ohne einen Lauf, der den Zähler nachweislich hochzählt, bewiese
 *    eine konstante Null nichts über den Abbruch — ein kaputter oder falsch gefilterter
 *    Zähler sähe identisch aus. Nach der Null-Messung bestätigt dieser Punkt deshalb einen
 *    zweiten Download-Versuch (`downloadModelViaMock`) und verlangt dort eine ECHTE Zunahme.
 */
async function runConfirmNoBytesCheck(cdp: Cdp, generateTimeoutMs: number): Promise<void> {
  const NAME = "23. Abbruch am Bestätigungsdialog lädt kein Byte";
  const startDatei = mockAssetCounts();
  if (startDatei === null) {
    skip(NAME, "kein Asset-Mock (Zählerdatei fehlt) — am HF-Repo nicht messbar, ohne echten Download zu riskieren");
    return;
  }

  // Schluessel im Zaehler tragen den fuehrenden Slash aus der URL-Pathname (mock-assets.mjs:
  // `normalize(new URL(...).pathname)`), z. B. "/sdxl-turbo/unet/model.onnx" — NICHT
  // "sdxl-turbo/...". Ohne den Slash matcht `startsWith` nie und der Punkt waere immer
  // (falsch) gruen, ganz gleich ob Bytes flossen.
  const PREFIX = "/sdxl-turbo/";
  // `after` ist `null`, wenn die Datei nicht lesbar war (fehlt, oder von einem gleichzeitigen
  // Schreiben des Mocks getroffen) — das ist eine ANOMALIE der Messung, keine Null. Der
  // Aufrufer muss das getrennt von "0 Anfragen" behandeln, sonst wird ein Messfehler zum
  // stillen Erfolg.
  const diffSeit = (before: Record<string, number>, after: Record<string, number> | null): number | null => {
    if (after === null) return null;
    return Object.entries(after)
      .filter(([k]) => k.startsWith(PREFIX))
      .reduce((sum, [k, v]) => sum + (v - (before[k] ?? 0)), 0);
  };

  const teile: string[] = [];

  // Vorbedingung: sdxl-turbo NICHT im Cache — sonst filtert ModelStore.download() die Datei
  // schon vor jedem Netzaufruf heraus und die Null-Messung unten sagt nichts über den Klick.
  const entfernt = await cdp.evaluate<{ ok: boolean; downloadedAfter: BuiltinModelId[] }>(`
    app.setting.close?.();
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const ok = await p.removeModel(${JSON.stringify("sdxl-turbo" as BuiltinModelId)});
    return { ok, downloadedAfter: p.downloadedModels };
  `);
  if (!entfernt.ok || entfernt.downloadedAfter.includes("sdxl-turbo")) {
    record(
      NAME,
      false,
      `Vorbedingung nicht herstellbar: sdxl-turbo liess sich nicht aus dem Cache entfernen (downloadedModels: ${JSON.stringify(entfernt.downloadedAfter)})`,
    );
    return;
  }

  // --- Abbruch-Messung: 0 Anfragen erwartet -------------------------------------------------
  const vorAbbruch = mockAssetCounts() ?? startDatei;
  const cancelLabel = t("modal.cancel");
  await cdp.evaluate(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    if (p.settings.builtinModel !== ${JSON.stringify("sdxl-turbo" as BuiltinModelId)}) await p.setBuiltinModel(${JSON.stringify("sdxl-turbo" as BuiltinModelId)});
    window.__ligSmokeCancel = { done: false };
    p.startDownload()
      .then(() => { window.__ligSmokeCancel.done = true; })
      .catch((e) => { window.__ligSmokeCancel = { done: true, error: String(e) }; });
    return true;
  `);
  const geklickt = await pollUntil(
    () =>
      cdp.evaluate<boolean>(`
        const btn = [...document.querySelectorAll(".modal-button-container button")]
          .find((b) => b.textContent.trim() === ${JSON.stringify(cancelLabel)});
        if (btn) { btn.click(); return true; }
        return false;
      `),
    (v) => v === true,
    10_000,
    "warte auf den Bestätigungs-Dialog",
    300,
  );
  const fertig = await pollUntil(
    () => cdp.evaluate<{ done: boolean }>(`return window.__ligSmokeCancel ?? { done: false };`),
    (v) => v.done,
    15_000,
    "warte auf den Abbruch von startDownload()",
    500,
  );
  await cdp.evaluate(`delete window.__ligSmokeCancel; return true;`).catch(() => undefined);

  const nachAbbruch = mockAssetCounts();
  const sdxlAnfragenAbbruch = diffSeit(vorAbbruch, nachAbbruch);

  if (geklickt !== true) teile.push("Bestätigungsdialog nicht gefunden/angeklickt");
  if (fertig === null) teile.push("startDownload() endete nicht nach dem Abbrechen");
  if (sdxlAnfragenAbbruch === null) teile.push("Zählerdatei nach dem Abbruch nicht lesbar (Anomalie der Messung, nicht 0 Anfragen)");
  else if (sdxlAnfragenAbbruch !== 0) teile.push(`${sdxlAnfragenAbbruch} Anfragen für sdxl-turbo-Dateien nach dem Abbrechen — es floss Byte`);

  // --- Positiv-Kontrolle: bestätigen statt abbrechen, MUSS Bytes zeigen --------------------
  // Ohne diesen zweiten Lauf bewiese die Null-Messung oben nichts: ein Zähler, der wegen
  // eines Bugs immer 0 meldet (genau der Slash-Fehler, den die Selbstprüfung dieses Tasks an
  // dieser Stelle bereits einmal fand), sähe identisch aus wie ein korrekter Abbruch.
  const vorKontrolle = mockAssetCounts() ?? nachAbbruch ?? vorAbbruch;
  const kontrolle = await downloadModelViaMock(cdp, "sdxl-turbo", generateTimeoutMs);
  const nachKontrolle = mockAssetCounts();
  const sdxlAnfragenKontrolle = diffSeit(vorKontrolle, nachKontrolle);

  if (!kontrolle.ok) teile.push(`Positiv-Kontrolle: Download fehlgeschlagen: ${kontrolle.detail}`);
  if (sdxlAnfragenKontrolle === null) teile.push("Zählerdatei nach der Positiv-Kontrolle nicht lesbar");
  else if (sdxlAnfragenKontrolle <= 0)
    teile.push(`Positiv-Kontrolle: 0 Anfragen für sdxl-turbo-Dateien trotz bestätigtem Download — der Zähler misst nichts`);

  record(
    NAME,
    teile.length === 0,
    teile.length === 0
      ? `Abbruch: 0 Anfragen · Bestätigung: ${String(sdxlAnfragenKontrolle)} Anfragen`
      : teile.join(" · "),
  );
}

/** Wrapper für 20–23: schaltet einmalig auf "builtin" (nur dort unterscheiden sich Modelle),
 *  läuft die vier Punkte, schaltet danach zurück auf "server" — Punkt 19 (img2img) und alles
 *  Spätere braucht den Server-Modus. Bei fehlender GPU/WebGPU bleibt `downloadedModels` für
 *  immer leer (`refreshEngineState()` bricht vor der Cache-Prüfung ab) — 20 und 22 hängen
 *  NICHT daran (sie lesen nur `settings.builtinModel` bzw. den Modell-Katalog) und laufen
 *  trotzdem; 21 und 23 überspringen sich in diesem Fall selbst (s. dort). */
async function runModelStageChecks(cdp: Cdp, assetsBase: string, generateTimeoutMs: number): Promise<void> {
  // Alle vier Punkte wechseln settings.builtinModel UND settings.showModelPicker mehrfach hin
  // und her und lassen sie am Ende auf irgendeinem Stand stehen. Ungemerkt bliebe das ein
  // STILLER Seiteneffekt fuer alles, was NACH diesem Block laeuft: Punkt 17 (modusabhaengige
  // Regler) misst `.lig-size-slot` im builtin-Modus — mit "sdxl-turbo" aktiv ist die
  // Groessen-Zeile dort ZU RECHT sichtbar (zwei Groessen), und der Punkt meldete genau das als
  // Defekt, als der `builtinModel`-Restore hier noch fehlte (gemessen bei der ersten
  // Live-Messung dieses Tasks). Der Fehler lag im Treiber, nicht im Plugin. `showModelPicker`
  // liest zwar aktuell niemand nach diesem Block — dieselbe Asymmetrie waere aber nur einen
  // spaeteren Punkt entfernt, der genau das tut, und dann unbemerkt gegen den falschen
  // Ausgangswert liefe.
  const original = await cdp.evaluate<{ builtinModel: BuiltinModelId; showModelPicker: boolean }>(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    return { builtinModel: p.settings.builtinModel, showModelPicker: p.settings.showModelPicker };
  `);
  try {
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      if (p.settings.engine !== "builtin") await p.setEngine("builtin");
      return true;
    `);
    await new Promise((r) => setTimeout(r, 500));

    await runModelSwitchCheck(cdp);
    await runSizeRowCheck(cdp);
    await runModelPickerCheck(cdp, assetsBase, generateTimeoutMs);
    await runConfirmNoBytesCheck(cdp, generateTimeoutMs);
  } finally {
    await cdp
      .evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const before = ${JSON.stringify(original)};
        if (p.settings.builtinModel !== before.builtinModel) await p.setBuiltinModel(before.builtinModel);
        if (p.settings.showModelPicker !== before.showModelPicker) {
          p.settings.showModelPicker = before.showModelPicker;
          await p.saveSettings();
          p.refreshViews();
        }
        if (p.settings.engine !== "server") await p.setEngine("server");
        return true;
      `)
      .catch(() => undefined);
  }
}

/**
 * Punkt 25: der eigentliche Regressionswächter aus Phase 4 des SDXL-Turbo-Debuggings
 * (2026-08-24) — misst INHALT, nicht Form. Vorgeschichte: SDXL-Turbo produzierte live ein
 * rein schwarzes Bild — gültige PNG-Datei, richtige Größe, Status „Bereit", aber der
 * VAE-Decoder-Ausgang war zu 100 % NaN (SDXLs Aktivierungen überschreiten in fp16 unter dem
 * WebGPU-EP den Wertebereich; ORTs CPU-Kernel zeigen das nicht — Details am Modulkopf von
 * `tools/convert/convert_model.py`). 355 Unit-Tests, acht Gate-Schritte, die bisherigen 24
 * Smoke-Punkte und drei Store-Review-Schichten hätten diesen Defekt NICHT gefunden — alle
 * messen Form. Der Fix (95471fd) hält den VAE-Decoder fp32; dieser Punkt ist die Gegenprobe,
 * dass ein künftiger fp16-Rückfall (an diesem Teil oder einem neuen) wieder auffällt.
 *
 * Ausdrücklich teuer: echte Session + echte Generierung mit SDXL-Turbo (~6,9 GB, mehrere
 * Sekunden GPU-Zeit) — deshalb NUR in derselben Gate-Bedingung wie 20–23 (`--builtin`, nicht
 * `--quick`, Asset-Server erreichbar), niemals lautlos. Ein übersprungener Lauf steht in der
 * Abschlusszeile wie jeder andere ausgelassene Punkt.
 *
 * Verifikation gegen den Vor-Fix-Zustand: siehe `phase4-fix-report.md` Block 2 — mit dem
 * fp16-Decoder aus dem Stand vor 95471fd misst dieser Punkt Luma-Stddev 0,0 und 1 distinkte
 * Farbe und fällt korrekt ROT; mit dem fp32-Decoder aus 95471fd misst er die Werte einer
 * echten Fotografie und ist GRÜN. Ein Wächter, den niemand rot gesehen hat, ist kein
 * bewiesener Wächter.
 *
 * `builtinModel`/`engine` in einem `finally` zurückgestellt, nicht dem Aufrufer überlassen —
 * dieselbe Begründung wie bei `runModelStageChecks()`: eine implizite Reihenfolge-Abhängigkeit
 * (hier: „Punkt 17 räumt danach ohnehin auf") ist genau der Fehlermodus, den dieses Muster
 * verhindern soll (Review-Fund, zweite Runde).
 */
async function runSdxlContentCheck(cdp: Cdp, generateTimeoutMs: number): Promise<void> {
  const NAME = "25. SDXL-Turbo liefert ein Bild mit echtem Inhalt, nicht Schwarz/uniform (VAE-fp16-Wächter)";
  const readyText = t("status.ready");

  const geladen = await cdp.evaluate<BuiltinModelId[]>(`return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].downloadedModels;`);
  if (!geladen.includes("sdxl-turbo")) {
    const dl = await downloadModelViaMock(cdp, "sdxl-turbo", generateTimeoutMs);
    if (!dl.ok) {
      record(NAME, false, `sdxl-turbo nicht ladbar: ${dl.detail}`);
      return;
    }
  }

  // builtinModel/engine wie runModelStageChecks() zurueckstellen — NICHT dem Aufrufer
  // ueberlassen: dieser Punkt lief bisher ohne try/finally und hing an der Reihenfolge, dass
  // Punkt 17 (das naechste Element in main()) den Engine-Modus ohnehin zurueck auf "server"
  // zwingt. Genau diese implizite Reihenfolge-Abhaengigkeit ist der historische Bug, den
  // runModelStageChecks() mit seinem try/finally schon einmal beheben musste (s. dortiger
  // Kommentar) — ein spaeteres Umsortieren von main() haette sie lautlos wieder eingefuehrt.
  const original = await cdp.evaluate<{ builtinModel: BuiltinModelId; engine: string }>(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    return { builtinModel: p.settings.builtinModel, engine: p.settings.engine };
  `);
  try {
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      if (p.settings.builtinModel !== ${JSON.stringify("sdxl-turbo" as BuiltinModelId)}) await p.setBuiltinModel(${JSON.stringify("sdxl-turbo" as BuiltinModelId)});
      if (p.settings.engine !== "builtin") await p.setEngine("builtin");
      return true;
    `);
    await new Promise((r) => setTimeout(r, 500));

    await cdp.evaluate(`
      const ta = document.querySelector(".lig-panel textarea.lig-prompt");
      ta.value = ${JSON.stringify(SMOKE_PROMPT + ", sdxl content check")}; ta.dispatchEvent(new Event("input", { bubbles: true }));
      const seed = document.querySelector(".lig-panel input.lig-seed");
      seed.value = "4242"; seed.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    `);
    const imageBefore = await cdp.evaluate<string>(
      `const img = document.querySelector(".lig-image"); return img ? String(img.src.length) + ":" + img.src.slice(-48) : "";`,
    );
    await clickReal(cdp, `document.querySelector(".lig-generate")`);
    const image25 = await pollUntil(
      () =>
        cdp.evaluate<{ length: number; status: string; sig: string }>(`
          const img = document.querySelector(".lig-image");
          const status = document.querySelector(".lig-status-text");
          return { length: img && img.src.startsWith("data:image/png") ? img.src.length : 0, status: status ? status.textContent.trim() : "", sig: img ? String(img.src.length) + ":" + img.src.slice(-48) : "" };
        `),
      (r) => (r.length > 5000 && r.sig !== imageBefore && r.status === readyText) || istFehler(r.status),
      generateTimeoutMs,
      "warte auf das SDXL-Turbo-Bild (Punkt 25)",
      500,
    );

    if (image25 === null || istFehler(image25.status)) {
      record(
        NAME,
        false,
        image25 === null ? "kein Bild innerhalb der Frist" : `Lauf gescheitert, gemeldet vom Plugin: „${image25.status}"`,
      );
      return;
    }
    const stats = await pixelStats(cdp);
    record(
      NAME,
      stats !== null && stats.stddev >= CONTENT_STDDEV_MIN && stats.distinctLuma >= CONTENT_LUMA_BUCKETS_MIN,
      stats === null
        ? "Bild nicht lesbar (kein PNG-Data-URL)"
        : `${stats.width}×${stats.height} · Luma-Stddev ${stats.stddev.toFixed(1)} (Grenze ${CONTENT_STDDEV_MIN}) · ${stats.distinctLuma} distinkte Luma-Stufen (Grenze ${CONTENT_LUMA_BUCKETS_MIN})`,
    );
  } finally {
    await cdp
      .evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const before = ${JSON.stringify(original)};
        if (p.settings.builtinModel !== before.builtinModel) await p.setBuiltinModel(before.builtinModel);
        if (p.settings.engine !== before.engine) await p.setEngine(before.engine);
        return true;
      `)
      .catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const port = Number(flag("port") ?? 9222);
  const keep = argv.includes("--keep");
  const quick = argv.includes("--quick");
  const builtin = argv.includes("--builtin");
  const assetsBase = flag("assets") ?? "http://127.0.0.1:7862";
  const vault = flag("vault");
  // Wenige Steps und die kleinste Größe: der Smoke prüft die Kette, nicht die Bildqualität.
  // Bei FLUX.2 dev kostet der Default (20) rund vier Minuten pro Bild — zweimal im Lauf.
  const steps = Math.min(STEPS.max, Math.max(STEPS.min, Number(flag("steps") ?? 4)));
  const size = SIZES[0]!;
  /** Obergrenze pro Bild. Großzügig: ein langsamer Server ist kein Defekt. */
  const generateTimeoutMs = Number(flag("timeout") ?? 900) * 1000;

  console.log(`GUI-Smoke — Obsidian auf Port ${port}`);
  // `attachTo` unterscheidet Haupt- und Einstellungen-Fenster an der Sache (nur das
  // Hauptfenster trägt einen Workspace), nicht am lokalisierten Titel.
  const cdp = await attachTo("workspace", port, vault);
  if (!cdp) {
    throw new Error(
      `Kein Obsidian-Hauptfenster auf Port ${port}` +
        (vault ? ` für Vault „${vault}“` : "") +
        ". Läuft Obsidian mit --remote-debugging-port? (siehe Kopfkommentar)",
    );
  }

  // Alle Vorwerte AUSSERHALB des try: das finally muss sie auch nach einem Abbruch mitten
  // im Lauf zurückschreiben können — sonst bliebe der Vault im Smoke-Zustand stehen.
  let previous: { createMode: string; outputFolder: string; noteFolder: string; history: unknown[]; engine: string; assetBaseUrl: string; builtinModel: string; showModelPicker: boolean } | null = null;
  let createdFolder = false;

  try {
    // Ohne Fokus drosselt Chromium den Renderer. `Page.bringToFront` allein genuegt auf
    // macOS NICHT: es holt das Fenster innerhalb der App nach vorn, nicht die App nach
    // vorn. Man debuggt sonst ein Phantom: Zustand richtig, Anzeige nicht da.
    await cdp.send("Page.bringToFront");
    if (process.platform === "darwin") {
      try {
        execFileSync("osascript", ["-e", 'tell application "Obsidian" to activate']);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch {
        console.log("  (Hinweis: `osascript activate` schlug fehl — Fenster ggf. von Hand nach vorn holen)");
      }
    }

    const vaultName = await cdp.evaluate<string>(`return window.app?.appId ? app.vault.getName() : "";`);
    if (!vaultName) throw new Error("Obsidians `app` ist im Renderer nicht erreichbar.");
    console.log(`Vault: ${vaultName}`);

    const plugin = await cdp.evaluate<{ ok: boolean; version?: string; endpoint?: string }>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      return p ? { ok: true, version: p.manifest.version, endpoint: p.settings.endpoint } : { ok: false };
    `);
    if (!plugin.ok) throw new Error(`Plugin ${PLUGIN_ID} ist nicht aktiv. Erst \`npm run deploy\`.`);
    console.log(`Plugin-Version im Vault: ${plugin.version}`);

    // Den Prueflig HERSTELLEN, nicht annehmen: `npm run deploy` kopiert Dateien, Obsidian laedt
    // sie nicht nach. Ohne diesen Neustart misst der Lauf den Code, der beim letzten Start des
    // Fensters im Speicher landete — und die Manifest-Version verraet das nicht, weil sie sich
    // zwischen zwei Bauten desselben Standes nicht aendert. Gemessen 2026-08-21: nach dem
    // Kit-0.27.0-Vendoring meldete der Lauf 15/16, weil die Tab-Leiste im DOM noch das alte
    // `lig-hub-`-Praefix trug, waehrend die deployte main.js ausschliesslich `okit-hub-` enthielt.
    // Das kostet 1,5 s und macht den Lauf reproduzierbar.
    await cdp.evaluate(`
      await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
      await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
      return true;
    `);
    const reloaded = await pollUntil(
      () => cdp.evaluate<boolean>(`return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.settings;`),
      (ok) => ok === true,
      15_000,
      "warte auf das neu geladene Plugin",
    );
    if (reloaded === null) throw new Error(`Plugin ${PLUGIN_ID} kam nach dem Neuladen nicht zurueck.`);
    console.log("Plugin neu geladen — gemessen wird der deployte Stand");

    const endpoint = (plugin.endpoint ?? "").trim();
    if (endpoint === "") throw new Error("Kein Server-Endpunkt in den Plugin-Settings — erst in den Settings eintragen.");

    // Die Sprache des Wirts übernehmen, damit die Label-Vergleiche unten gegen genau die
    // Strings laufen, die der Renderer rendert. Die Strings kommen aus src/ — derselben
    // Quelle wie im Plugin, kein zweiter, driftender Satz Erwartungen im Treiber.
    const rawLang = await cdp.evaluate<string | null>(`return window.localStorage.getItem("language");`);
    registerI18n();
    setLang(pickLang(rawLang));

    // Unabhängiges Orakel: was sagt der Server selbst? Zugleich der Guard für die
    // Umgebungsbedingung „Bild-Server läuft" — geprüft an der Quelle, die sie kennt, mit
    // Ansage statt Abbruch mitten im Lauf. Ein abgeschalteter Server ist keine Aussage über
    // das Plugin: die server-freien Punkte laufen weiter, die anderen werden übersprungen.
    const probe = await probeServer(endpoint);
    const expectedModel = probe.reachable ? probe.model : null;
    if (probe.reachable) {
      console.log(`Server meldet Modell: ${expectedModel}`);
    } else if (quick) {
      console.log(
        `⚠ Bild-Server unter ${endpoint} antwortet nicht — ${probe.grund}.\n` +
          `  Die Punkte 2, 3 und 4 brauchen ihn und werden übersprungen; 1 und 12 laufen.`,
      );
    } else {
      // Ein Freigabe-Smoke läuft vollständig oder gar nicht: Punkte 5–11 erzeugen ein echtes
      // Bild, das ist ohne Server gegenstandslos. Lieber hier klar abbrechen als eine
      // Teilmessung liefern, die später als „Smoke war grün" zitiert wird.
      throw new Error(
        `Bild-Server unter ${endpoint} antwortet nicht — ${probe.grund}.\n` +
          `  Ein vollständiger Smoke braucht ihn (Punkte 2, 3 und 5–11 messen gegen den Server).\n` +
          `  Server starten — oder \`--quick\` fahren: das misst die server-freien Punkte 1 und 12.`,
      );
    }
    console.log(`Lauf: ${steps} Steps · ${size.width}×${size.height}\n`);

    // --- Szene herstellen ---------------------------------------------------
    // Ausgabe in einen eigenen Ordner lenken und createMode auf "note" stellen, damit
    // Punkt 8 die Ergebnis-Notiz überhaupt zu sehen bekommt. Vorwerte gemerkt (finally).
    // Punkte 1–11 messen den Server-Pfad; die eingebaute Engine kommt in 13–16 dran. Der Modus
    // wird deshalb hier auf „server" gestellt und im finally zurückgeschrieben (setEngine räumt
    // GPU-Sessions ab und prüft den Server neu — genau wie ein Klick im Dropdown).
    previous = await cdp.evaluate<{ createMode: string; outputFolder: string; noteFolder: string; history: unknown[]; engine: string; assetBaseUrl: string; builtinModel: string; showModelPicker: boolean }>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const before = {
        createMode: p.settings.createMode,
        outputFolder: p.settings.outputFolder,
        noteFolder: p.settings.noteFolder,
        history: JSON.parse(JSON.stringify(p.settings.history)),
        engine: p.settings.engine,
        assetBaseUrl: p.settings.assetBaseUrl,
        builtinModel: p.settings.builtinModel,
        showModelPicker: p.settings.showModelPicker,
      };
      p.settings.createMode = "note";
      p.settings.outputFolder = ${JSON.stringify(SMOKE_FOLDER)};
      p.settings.noteFolder = ${JSON.stringify(SMOKE_FOLDER)};
      await p.saveSettings();
      if (p.settings.engine !== "server") await p.setEngine("server");
      return before;
    `);

    createdFolder = await cdp.evaluate<boolean>(`
      const path = ${JSON.stringify(SMOKE_FOLDER)};
      if (app.vault.getAbstractFileByPath(path)) return false; // fremder Ordner — nicht anfassen
      await app.vault.createFolder(path);
      return true;
    `);
    if (!createdFolder) {
      throw new Error(
        `Der Ordner ${SMOKE_FOLDER} existiert bereits. Er wird vom Smoke angelegt UND gelöscht — ` +
          `ein vorhandener könnte fremde Dateien tragen. Bitte von Hand prüfen und entfernen.`,
      );
    }

    // Hub über den echten Command öffnen (nicht über die interne API): das ist der Weg,
    // den auch ein Mensch nimmt.
    await cdp.evaluate(`
      await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open`)});
      return true;
    `);

    // --- 1. Der Hub öffnet sich und trägt das Generate-Panel ----------------
    const panel = await cdp.evaluate<number | null>(
      waitFor(`
        const prompts = document.querySelectorAll(".lig-panel .lig-prompt");
        return prompts.length >= 1 ? prompts.length : 0;
      `),
    );
    record("1. Hub öffnet sich mit dem Generate-Panel", panel !== null && panel >= 2, `${panel ?? 0} Prompt-Felder (Prompt + Negativ)`);

    // Punkt 2 und 3 vergleichen gegen das, was der SERVER meldet — ohne ihn haben sie
    // keinen Gegenstand. Übersprungen, nicht rot: der Prüfling ist hier nicht gefragt.
    if (expectedModel === null) {
      skip("2. „Verbindung testen“ meldet den Modellnamen des Servers", "Bild-Server nicht erreichbar");
      skip("3. Generate-Panel zeigt den echten Modellnamen (Bug 1d1c046)", "Bild-Server nicht erreichbar");
    } else {
      // --- 2. „Verbindung testen" meldet den Modellnamen ----------------------
      // Der echte Klick im echten Settings-Tab, nicht plugin.checkServer(): geprüft wird die
      // Kette Knopf → checkServer → Notice, nicht die Funktion allein.
      const testLabel = t("settings.server.test");
      // ⚠️ NICHT im globalen `document` suchen. Sind mehrere Obsidian-Fenster desselben Vaults
      // offen, öffnet `app.setting.open()` das Modal im AKTUELLEN Fenster der App — das muss
      // nicht das Fenster sein, an dem CDP hängt. Gemessen 2026-08-06: `app.setting.activeTab.id`
      // war korrekt "local-image-generator" und `s.win.document` enthielt das Modal, während
      // `document.querySelectorAll(".modal")` leer blieb. Das las sich als „Modal hat sich nicht
      // geöffnet" — ein Umgebungs-Artefakt, das wie ein Plugin-Defekt aussieht.
      //
      // Gegriffen wird deshalb am Tab-Container selbst (fenster-unabhängig) und, für die Notice,
      // über alle beteiligten Dokumente. Geprüft wird dadurch unverändert die echte Kette:
      // Obsidians Settings-Maschine baut den Tab, wir klicken den echten Knopf.
      const noticeText = await cdp.evaluate<string | null>(`
        app.setting.open();
        app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
        const docs = () => [...new Set([
          document,
          app.setting?.win?.document,
          app.setting?.activeTab?.containerEl?.ownerDocument,
        ].filter(Boolean))];
        const findButton = () => {
          const scope = app.setting?.activeTab?.containerEl ?? app.setting?.containerEl;
          if (!scope) return null;
          return [...scope.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(testLabel)}) ?? null;
        };
        // NICHT \`deadline\` nennen: das eingespleißte waitFor() unten deklariert denselben
        // Namen im selben Scope — beides zusammen ergibt einen SyntaxError, der als
        // "Renderer: Uncaught" ankommt. Eine Falle des String-Splicing-Entwurfs, die jeden
        // trifft, der neben einem waitFor() eine eigene Warteschleife schreibt.
        const buttonDeadline = Date.now() + 8000;
        let button = findButton();
        while (!button && Date.now() < buttonDeadline) {
          await new Promise((r) => setTimeout(r, 100));
          button = findButton();
        }
        if (!button) {
          const tab = app.setting?.activeTab?.id ?? null;
          return tab === ${JSON.stringify(PLUGIN_ID)}
            ? "(Settings-Tab offen, aber kein Knopf " + ${JSON.stringify(testLabel)} + ")"
            : "(falscher Settings-Tab aktiv: " + tab + ")";
        }
        // Alte Notices erst abräumen — sonst liest der Vergleich unten womöglich eine
        // Meldung, die schon vor dem Klick dastand (Prüfpunkt ohne Gegenstand).
        for (const d of docs()) d.querySelectorAll(".notice").forEach((n) => n.remove());
        button.click();
        ${waitFor(
          `
          for (const d of docs()) {
            const notice = d.querySelector(".notice");
            if (notice) return notice.textContent.trim();
          }
          return 0;
        `,
          15_000,
        )}
      `);
      record(
        "2. „Verbindung testen“ meldet den Modellnamen des Servers",
        noticeText !== null && noticeText.includes(expectedModel),
        noticeText === null ? "keine Notice erschienen" : noticeText,
      );
      await cdp.evaluate(`app.setting.close(); return true;`);

      // --- 3. DER BEFUND: das Generate-Panel zeigt den echten Modellnamen -----
      // Regression zu `1d1c046`: parseOptionsModel las nur `sd_model_checkpoint`, Draw Things
      // meldet `model` → modelName blieb null → hier stand der Platzhalter „(in der
      // Server-App gewählt)". Verglichen wird gegen das, was der SERVER sagt (Orakel oben).
      const modelInfo = await cdp.evaluate<string | null>(
        waitFor(`
          const el = document.querySelector(".lig-model-info");
          return el && el.textContent.trim() !== "" ? el.textContent.trim() : 0;
        `),
      );
      record(
        "3. Generate-Panel zeigt den echten Modellnamen (Bug 1d1c046)",
        modelInfo === t("generate.modelInfo", expectedModel),
        modelInfo === null
          ? "Modellzeile leer"
          : modelInfo === t("generate.modelInApp")
            ? `Platzhalter statt Name — erwartet „${expectedModel}"`
            : modelInfo,
      );
    }

    // --- Rezept in die echten Felder schreiben ------------------------------
    // Über DOM + `input`-Event, nicht über den Plugin-State: nur so laufen dieselben
    // Listener wie bei einem Menschen (setPrompt → refresh → generateEnabled).
    const seedUsed = await cdp.evaluate<number>(`
      const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
      const prompt = document.querySelector(".lig-prompt:not(.lig-negative)");
      prompt.value = ${JSON.stringify(SMOKE_PROMPT)};
      fire(prompt, "input");
      const stepsEl = document.querySelector(".lig-steps");
      stepsEl.value = ${JSON.stringify(String(steps))};
      fire(stepsEl, "input");
      const sizeEl = document.querySelector(".lig-size");
      sizeEl.value = ${JSON.stringify(`${size.width}x${size.height}`)};
      fire(sizeEl, "change");
      // Seed frisch würfeln — über den echten Würfel-Knopf. Ohne das prüft Punkt 4 sich
      // selbst kaputt: hält das Plugin noch das Bild eines vorigen Laufs und ist unser
      // Rezept zeichengleich, sperrt \`recipeUnchanged\` den Generate-Knopf VÖLLIG ZU RECHT
      // (ein Klick ergäbe byte-identisch dasselbe Bild). Gemessen 2026-08-06 als Falsch-Rot.
      // Ein Prüfpunkt muss seine Voraussetzung herstellen, nicht auf sie hoffen.
      const seedEl = document.querySelector(".lig-seed");
      const dice = seedEl.parentElement.querySelector("button.clickable-icon");
      if (dice) dice.click();
      return Number(seedEl.value);
    `);

    // --- 4. Generate ist bedienbar ------------------------------------------
    const generateReady = await cdp.evaluate<{ found: boolean; enabled: boolean }>(`
      const b = document.querySelector(".lig-generate");
      return { found: !!b, enabled: !!b && !b.disabled };
    `);
    // Auch dieser Punkt hängt am Server, wenn auch nur mittelbar: `generateEnabled` verlangt
    // `server.kind === "ok"` (src/core/viewmodel.ts). Ohne erreichbaren Server ist der Knopf
    // ZURECHT gesperrt — ihn dann rot zu melden, hiesse dem Plugin vorzuwerfen, dass es die
    // fehlende Umgebung korrekt abbildet. Beim ersten Lauf mit dem Guard genau so passiert.
    if (expectedModel === null) {
      skip(
        "4. „Generieren“ ist mit gesetztem Prompt bedienbar",
        "Bild-Server nicht erreichbar — ohne Verbindung ist der Knopf zurecht gesperrt",
      );
    } else {
      record(
        "4. „Generieren“ ist mit gesetztem Prompt bedienbar",
        generateReady.found && generateReady.enabled,
        generateReady.found
          ? generateReady.enabled
            ? `Seed ${seedUsed}`
            : "Knopf ist gesperrt"
          : "Knopf nicht gefunden",
      );
    }

    // --- 12. Die Einstellungen sind über die Settings-SUCHE auffindbar -------
    // Trägt die Nummer 12 und läuft trotzdem hier: er braucht keine Generierung, gehört
    // also in den --quick-Teil, aber eine Umnummerierung von 5–11 würde die Befund-
    // Rückverweise in docs/SMOKE.md („Punkt 4 war ein Falsch-Rot", „Punkt 3 und 8")
    // stillschweigend auf andere Prüfungen zeigen lassen. Nummern sind hier Namen, keine
    // Reihenfolge.
    //
    // Was hier misslingen kann und sonst NICHTS meldet: Der Store-Linter prüft nur, DASS
    // getSettingDefinitions() existiert — nicht, ob die Zeilen beim Nutzer in der Suche
    // ankommen. Genau das war der Befund, der 0.5.0 auf „Satisfactory" hielt.
    //
    // Die Erwartung kommt aus der Definition selbst, nicht aus einer Literal-Liste: sonst
    // misst der Prüfpunkt beim nächsten Umbenennen oder in einer anderen UI-Sprache am
    // eigenen Gedächtnis vorbei. (Beim Bau dieses Punktes zweimal genau so danebengegriffen:
    // gesucht wurde „Ausgabeordner", die Zeile heißt „Bilderordner" — das las sich zwei
    // Runden lang wie ein Produktdefekt.) Unsichtbare Zeilen (visible-Prädikat, z. B. der
    // Legacy-Cache-Aufräumer ohne Alt-Gewichte) sind ausgenommen — sie SOLLEN nicht auftauchen.
    // `skip` und `befund` sind bewusst zwei Felder, keine zwei Texte in einem: fehlt die
    // Settings-SUCHE (Obsidian < 1.13), konnte nicht gemessen werden — fehlt dagegen
    // `getSettingDefinitions()`, IST das der Befund, den 0.5.0 auf „Satisfactory" hielt.
    // Ihn als „übersprungen" zu führen hiesse, den gesuchten Defekt als Nichtmessung zu
    // verbuchen: die Gegenprobe (Migration zurückgebaut) liefe dann durch, ohne rot zu werden.
    const searchable = await cdp.evaluate<{
      skip?: string;
      befund?: string;
      gesucht: string[];
      gefunden: string[];
      fehlend: string[];
      negativkontrolle: boolean;
    }>(`
      const leer = { gesucht: [], gefunden: [], fehlend: [], negativkontrolle: false };
      const tab = (app.setting.pluginTabs ?? []).find((t) => t.id === ${JSON.stringify(PLUGIN_ID)});
      if (!tab) return { befund: "kein Settings-Tab registriert", ...leer };
      // NICHT \`typeof tab.getSettingDefinitions === "function"\` prüfen: Obsidian 1.13 bringt
      // die Methode in PluginSettingTab selbst mit, der Ausdruck ist also IMMER wahr und der
      // Guard tot. Gemessen 2026-08-14 an der Gegenprobe: nach dem Rückbau der Migration hiess
      // die eigene Methode anders — und \`typeof tab.getSettingDefinitions\` blieb "function".
      // Gefragt ist, ob das PLUGIN sie definiert; das steht auf dem Prototyp seiner Klasse.
      if (!Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(tab), "getSettingDefinitions")) {
        return { befund: "das Plugin definiert getSettingDefinitions() nicht — es erbt nur Obsidians Vorgabe (der Store-Befund von 0.5.0)", ...leer };
      }
      const sichtbar = (d) => {
        const v = d.visible;
        return v === undefined || v === true || (typeof v === "function" && v());
      };
      const namen = tab.getSettingDefinitions()
        .filter(sichtbar)
        .flatMap((d) => (d.type === "group" || d.type === "list" ? (d.items ?? []) : [d]))
        .filter(sichtbar)
        .map((d) => d.name)
        .filter((n) => typeof n === "string" && n.length > 0);

      app.setting.open();
      app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
      await new Promise((r) => setTimeout(r, 500));

      // Am Tab-Container greifen, nicht am globalen document: bei mehreren Vault-Fenstern
      // hängt das Settings-Modal in einem EIGENEN Fenster (Falle (4) in docs/SMOKE.md).
      const doc = app.setting.activeTab?.containerEl?.ownerDocument ?? document;
      const win = doc.defaultView;
      const input = doc.querySelector(".setting-search-container input");
      if (!input) {
        app.setting.close();
        return { skip: "keine Settings-Suche in dieser Obsidian-Version", gesucht: namen, gefunden: [], fehlend: [], negativkontrolle: false };
      }

      // Den Wert über den nativen Setter schreiben: eine direkte Zuweisung an .value
      // bemerkt Obsidians Eingabe-Beobachter nicht.
      const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set;
      const treffer = async (q) => {
        setter.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        setter.call(input, q);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 600));
        const box = doc.querySelector(".setting-search-results");
        return !!box && box.textContent.includes(q);
      };

      const gefunden = [];
      const fehlend = [];
      for (const n of namen) ((await treffer(n)) ? gefunden : fehlend).push(n);
      // Gegenprobe: findet die Suche ALLES, beweist ein Treffer nichts.
      const negativkontrolle = !(await treffer("zzz-gibt-es-nicht-zzz"));

      setter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      app.setting.close();
      return { gesucht: namen, gefunden, fehlend, negativkontrolle };
    `);
    if (searchable.skip) {
      skip("12. Die Einstellungen erscheinen in Obsidians Settings-Suche", searchable.skip);
    } else if (searchable.befund) {
      record("12. Die Einstellungen erscheinen in Obsidians Settings-Suche", false, searchable.befund);
    } else {
      record(
        "12. Die Einstellungen erscheinen in Obsidians Settings-Suche",
        searchable.fehlend.length === 0 && searchable.negativkontrolle && searchable.gesucht.length > 0,
        searchable.gesucht.length === 0
          ? "getSettingDefinitions() liefert keine Zeilen — nichts, was in der Suche stehen könnte"
          : searchable.fehlend.length > 0
            ? `nicht gefunden: ${searchable.fehlend.join(", ")}`
            : !searchable.negativkontrolle
              ? "Gegenprobe fiel durch — die Suche liefert auf jede Eingabe Treffer"
              : `${searchable.gefunden.length}/${searchable.gesucht.length} Zeilen gefunden`,
      );
    }

    // Die Punkte 5–11 brauchen eine echte Generierung. Auf einem FLUX.2-Server kostet
    // das auch bei 4 Steps rund neun Minuten pro Bild — zweimal im Lauf. --quick lässt
    // sie aus und prüft nur die UI-Verdrahtung (1–4 und 12): der Modus für die Schleife
    // während einer UI-Änderung. Ein Freigabe-Smoke läuft IMMER vollständig.
    if (quick) {
      console.log("\n(--quick: Punkte 5–11 übersprungen — sie brauchen eine echte Generierung)");
    } else {
      // --- 5. Der Lauf startet sichtbar ---------------------------------------
      const readyText = t("status.ready");
      // Stand des Bildes VOR dem Klick: Punkt 7 muss ein NEUES Bild sehen, nicht das aus dem
      // vorigen Lauf, das die Karte noch zeigt, wenn das Plugin zwischen zwei Läufen nicht neu
      // geladen wurde. Gemessen 2026-08-19: ohne diesen Vergleich war 7 sofort grün, 8 las die
      // Notiz des alten Bildes (model: sd-turbo statt des Mock-Servers) und 10 klickte in eine
      // Historie, in der der neue Lauf noch gar nicht angekommen war — dieselbe Falle wie beim
      // Aufnahme-Rezept am 2026-08-17 („ist ein Bild da" ≠ „ist ein NEUES Bild da").
      const imageBefore = await cdp.evaluate<string>(`const img = document.querySelector(".lig-image"); return img ? String(img.src.length) + ":" + img.src.slice(-48) : "";`);
      const started = await cdp.evaluate<string | null>(`
        document.querySelector(".lig-generate").click();
        ${waitFor(
          `
          const el = document.querySelector(".lig-status-text");
          const text = el ? el.textContent.trim() : "";
          return text !== "" && text !== ${JSON.stringify(readyText)} ? text : 0;
        `,
          15_000,
        )}
      `);
      record(
        "5. Der Klick auf „Generieren“ startet einen sichtbaren Lauf",
        started !== null && !istFehler(started),
        started === null
          ? `Statuszeile blieb auf „${readyText}"`
          : istFehler(started)
            ? `kein Lauf — der Server lehnte sofort ab: „${started}"`
            : started,
      );

      // --- 6. Die Statuszeile lebt während des Laufs --------------------------
      // Draw Things kennt /sdapi/v1/progress nicht (404) → der Sekundenzähler ist dort der
      // Normalfall, nicht die Ausnahme. Geprüft wird, dass sich die Zeile überhaupt bewegt:
      // eine eingefrorene Statuszeile ist von einem Hänger nicht zu unterscheiden.
      const firstStatus = started ?? "";
      const movedStatus = await pollUntil(
        () => cdp.evaluate<string>(`const el = document.querySelector(".lig-status-text"); return el ? el.textContent.trim() : "";`),
        (text) => text !== firstStatus && text !== "",
        30_000,
        "warte auf Bewegung in der Statuszeile",
        1500,
      );
      record(
        "6. Die Statuszeile bewegt sich während des Laufs",
        movedStatus !== null,
        movedStatus === null ? `blieb auf „${firstStatus}"` : `„${firstStatus}" → „${movedStatus}"`,
      );

      // --- 7. Das Bild kommt an ------------------------------------------------
      const image = await pollUntil(
        () =>
          cdp.evaluate<{ visible: boolean; length: number; status: string; sig: string }>(`
            const card = document.querySelector(".lig-card");
            const img = document.querySelector(".lig-image");
            const status = document.querySelector(".lig-status-text");
            return {
              visible: !!card && getComputedStyle(card).display !== "none",
              length: img && img.src.startsWith("data:image/png") ? img.src.length : 0,
              status: status ? status.textContent.trim() : "",
              sig: img ? String(img.src.length) + ":" + img.src.slice(-48) : "",
            };
          `),
        // Zwei Ausgänge, nicht einer: das Bild ODER ein gemeldeter Fehlschlag. Ohne den
        // zweiten sitzt der Prüfpunkt die volle Frist ab, obwohl das Ergebnis nach Sekunden
        // feststeht — am 2026-08-17 zwanzig Minuten lang, während „Fehler: txt2img HTTP 422"
        // sichtbar in der Statuszeile stand. Die Wartezeit war nicht das Schlimmste daran:
        // „kein Bild innerhalb der Frist" liest sich wie ein langsamer Server und verschweigt,
        // dass der Prüfling den Grund die ganze Zeit angezeigt hat.
        (r) => (r.visible && r.length > 5000 && r.sig !== imageBefore) || istFehler(r.status),
        generateTimeoutMs,
        "warte auf das Bild",
      );
      const laufFehler = image !== null && istFehler(image.status) ? image.status : null;
      record(
        "7. Die Generierung liefert ein Bild in die Karte",
        image !== null && laufFehler === null,
        laufFehler !== null
          ? `Lauf gescheitert, gemeldet vom Plugin: „${laufFehler}"`
          : image === null
            ? "kein Bild innerhalb der Frist (und kein gemeldeter Fehler — der Lauf hängt)"
            : `${Math.round(image.length / 1024)} KB Data-URL`,
      );
      if (image === null || laufFehler !== null) {
        throw new Error(
          laufFehler !== null
            ? `Ohne Bild sind die Punkte 8–10 gegenstandslos. Das Plugin meldet: „${laufFehler}" — ` +
              "das ist ein Zustand des Servers, nicht des Prüflings."
            : "Ohne Bild sind die Punkte 8–10 gegenstandslos — Abbruch.",
        );
      }

      // --- 8. DIE NUTZLAST DES BUGS: die Ergebnis-Notiz ------------------------
      // `1d1c046` schrieb `model: unknown` ins Frontmatter JEDER Notiz — also genau in das
      // Feld, das ein Rezept reproduzierbar machen soll. Hier wird das Produkt gelesen,
      // nicht der Zustand: die Datei, die im Vault landet.
      const createLabel = t("generate.button.create");
      await cdp.evaluate(`
        const button = [...document.querySelectorAll(".lig-actions button")]
          .find((b) => b.textContent.trim() === ${JSON.stringify(createLabel)});
        if (!button) throw new Error("Knopf nicht gefunden: " + ${JSON.stringify(createLabel)});
        button.click();
        return true;
      `);
      const note = await pollUntil(
        () =>
          cdp.evaluate<{ path: string; body: string } | null>(`
            const file = app.vault.getFiles().find((f) => f.path.startsWith(${JSON.stringify(`${SMOKE_FOLDER}/`)}) && f.extension === "md");
            if (!file) return null;
            return { path: file.path, body: await app.vault.cachedRead(file) };
          `),
        (r) => r !== null,
        60_000,
        "warte auf die Ergebnis-Notiz",
        1000,
      );
      const modelLine = note?.body.match(/^model:\s*(.+)$/m)?.[1]?.trim() ?? null;
      record(
        "8. Die Ergebnis-Notiz trägt den echten Modellnamen im Frontmatter",
        modelLine === expectedModel,
        note === null
          ? "keine Notiz angelegt"
          : modelLine === null
            ? "kein `model:`-Feld im Frontmatter"
            : `model: ${modelLine}`,
      );

      const imageEmbedded = note !== null && /!\[\[.+\.png\]\]/.test(note.body);
      record(
        "9. Die Ergebnis-Notiz bettet das Bild ein",
        imageEmbedded,
        note === null ? "keine Notiz" : imageEmbedded ? note.path : "kein PNG-Embed gefunden",
      );

      // --- 10. Die Historie stellt das Rezept wieder her -----------------------
      // Jays 0.2-Befund: „Historie merkt sich nur den Prompt" — seit 0.3 soll ein Klick das
      // ganze Rezept zurückholen. Geprüft wird der Effekt in den Feldern, nicht der State.
      // Der Tab-Knopf trägt `data-tab` (Kit-Hub, buildHubInto) — daran greifen statt am übersetzten Label:
      // ein Selektor, der die Sprache des Wirts nicht kennen muss, kann an ihr auch nicht
      // scheitern. Beide Panels sind immer gemountet; der Klick löst zusätzlich onShow() aus,
      // das die Liste neu rendert — genau der Pfad, den ein Mensch nimmt.
      const restored = await cdp.evaluate<{ rows: number; prompt: string; seed: number } | null>(`
        const historyTab = document.querySelector('.okit-hub-tab[data-tab="history"]');
        if (!historyTab) return null;
        // Erst auf „generate", dann auf „history" — der Wechsel muss ECHT sein. Der Kit-Hub
        // steigt bei setTab(aktueller Tab) sofort aus ("if (id === navState) return"), es gibt
        // also kein onShow() und damit kein render(). Der aktive Tab überlebt im Workspace-State:
        // ab dem zweiten Lauf stand er schon auf „history", und die Liste zeigte den Stand VOR
        // dem Lauf, während der neue Eintrag längst im State lag. Gemessen 2026-08-21 — der
        // Prüfpunkt war dadurch flaky (Lauf 2 grün, Lauf 3 rot, ohne Codeänderung dazwischen).
        document.querySelector('.okit-hub-tab[data-tab="generate"]').click();
        await new Promise((r) => setTimeout(r, 250));
        historyTab.click();
        await new Promise((r) => setTimeout(r, 400));
        const rows = document.querySelectorAll(".lig-hist-row, .lig-hist-var");
        if (rows.length === 0) return { rows: 0, prompt: "", seed: 0 };
        // Felder verstellen, damit ein Wiederherstellen messbar ist statt zufällig gleich:
        // sonst wäre der Prüfpunkt auch dann grün, wenn restoreRecipe gar nichts täte.
        const promptEl = document.querySelector(".lig-prompt:not(.lig-negative)");
        promptEl.value = "";
        promptEl.dispatchEvent(new Event("input", { bubbles: true }));
        rows[0].click();
        await new Promise((r) => setTimeout(r, 400));
        return {
          rows: rows.length,
          prompt: document.querySelector(".lig-prompt:not(.lig-negative)").value,
          seed: Number(document.querySelector(".lig-seed").value),
        };
      `);
      record(
        "10. Ein Klick in der Historie stellt Prompt UND Seed wieder her",
        restored !== null && restored.prompt === SMOKE_PROMPT && restored.seed === seedUsed,
        restored === null
          ? "History-Reiter nicht gefunden (Selektor .okit-hub-tab[data-tab=\"history\"]) — laeuft der deployte Stand?"
          : restored.rows === 0
          ? "keine Historien-Zeile vorhanden"
          : `Prompt ${restored.prompt === SMOKE_PROMPT ? "✓" : "✗"} · Seed ${restored.seed}${restored.seed === seedUsed ? " ✓" : ` ✗ (erwartet ${seedUsed})`}`,
      );

      // --- 11. Reroll würfelt und startet -------------------------------------
      const rerollLabel = t("generate.button.reroll");
      const reroll = await cdp.evaluate<{ found: boolean; seedBefore: number; seedAfter: number; status: string }>(`
        const button = [...document.querySelectorAll(".lig-actions button")]
          .find((b) => b.textContent.trim() === ${JSON.stringify(rerollLabel)});
        const seedEl = document.querySelector(".lig-seed");
        const seedBefore = Number(seedEl.value);
        if (!button) return { found: false, seedBefore, seedAfter: seedBefore, status: "" };
        button.click();
        await new Promise((r) => setTimeout(r, 1200));
        const status = document.querySelector(".lig-status-text");
        return {
          found: true,
          seedBefore,
          seedAfter: Number(seedEl.value),
          status: status ? status.textContent.trim() : "",
        };
      `);
      record(
        "11. „Reroll“ würfelt einen neuen Seed und startet einen Lauf",
        reroll.found && reroll.seedAfter !== reroll.seedBefore && reroll.status !== readyText && reroll.status !== "",
        !reroll.found
          ? `Knopf nicht gefunden: ${rerollLabel}`
          : `Seed ${reroll.seedBefore} → ${reroll.seedAfter} · Status „${reroll.status}"`,
      );

      // Den zweiten Lauf auslaufen lassen, BEVOR das finally die Historie zurückschreibt —
      // sonst schiebt er seinen Eintrag nach der Wiederherstellung nach und der Smoke
      // hinterlässt genau das, was er aufräumen wollte.
      console.log("    … warte auf das Ende des Reroll-Laufs (Aufräum-Voraussetzung)");
      const settled = await pollUntil(
        () => cdp.evaluate<string>(`const el = document.querySelector(".lig-status-text"); return el ? el.textContent.trim() : "";`),
        (text) => text === readyText || text.startsWith(t("status.error", "").trim()),
        generateTimeoutMs,
        "warte auf Lauf-Ende",
      );
      if (settled === null) {
        console.log("    ⚠️ Der Reroll-Lauf war nach der Frist noch aktiv — die Historie kann einen Extra-Eintrag behalten.");
      }
    }

    // --- 13–16, 20–25. Die eingebaute Engine + die zweite Modellstufe (Spec 0.6/0.9) ---------
    // Nur mit --builtin und nur gegen einen erreichbaren lokalen Asset-Server: der Block löscht
    // die Modell-Dateien aus dem Plugin-Cache und lädt sie neu (2,5 GB, Punkt 21 im ungünstigen
    // Fall zusätzlich 6,4 GB SDXL-Turbo, Punkt 25 baut zusätzlich eine echte SDXL-Turbo-Session
    // und generiert damit) — gegen das HF-Repo wäre das ein Missbrauch der Leitung, gegen den
    // lokalen Server dauert es Sekunden bis wenige Minuten.
    const ZWEITE_STUFE = [
      "20. Modellwechsel im Settings-Tab ändert die Download-Zeile",
      "21. Panel-Modell-Picker zeigt sich erst ab zwei geladenen Modellen",
      "22. Die Größen-Zeile folgt dem gewählten Modell",
      "23. Abbruch am Bestätigungsdialog lädt kein Byte",
      "25. SDXL-Turbo liefert ein Bild mit echtem Inhalt, nicht Schwarz/uniform (VAE-fp16-Wächter)",
    ];
    if (!builtin) {
      console.log("\n(ohne --builtin: Punkte 13–16, 20–25 übersprungen — sie brauchen den lokalen Asset-Server)");
      skip("24. SD-Turbo liefert ein Bild mit echtem Inhalt, nicht Schwarz/uniform", "ohne --builtin nicht erreicht");
    } else if (quick) {
      console.log("\n(--quick: Punkte 13–16, 20–25 übersprungen — sie brauchen Download und/oder Generierung)");
      skip("24. SD-Turbo liefert ein Bild mit echtem Inhalt, nicht Schwarz/uniform", "--quick: keine Generierung");
    } else {
      const assetsUp = await fetch(`${assetsBase.replace(/\/+$/, "")}/sd-turbo/tokenizer/vocab.json`, { method: "HEAD", signal: AbortSignal.timeout(3000) })
        .then((r) => r.status === 200)
        .catch(() => false);
      if (!assetsUp) {
        for (const n of [
          "13. Engine auf „Eingebaut“ — Panel zeigt den Modellzustand",
          "14. Download über den Panel-Knopf endet auf „bereit“",
          "15. Die eingebaute Engine liefert ein Bild und eine Notiz mit model: sd-turbo",
          "16. Zurück auf „Server“ bringt die Regler zurück",
          "24. SD-Turbo liefert ein Bild mit echtem Inhalt, nicht Schwarz/uniform",
          ...ZWEITE_STUFE,
        ])
          skip(n, `Asset-Server unter ${assetsBase} antwortet nicht (npm run smoke:assets)`);
      } else {
        await runBuiltinChecks(cdp, assetsBase, generateTimeoutMs);
        await runModelStageChecks(cdp, assetsBase, generateTimeoutMs);
        await runSdxlContentCheck(cdp, generateTimeoutMs);
      }
    }

    // --- 17. Modusabhängige Regler, gerendert gemessen ------------------------
    // Bewusst ausserhalb der --builtin/--quick-Bedingung: der Punkt wechselt nur den Modus und
    // liest `getComputedStyle` — kein Download, kein Asset-Server, keine Generierung. Er läuft
    // damit in jedem Lauf, auch im schnellen.
    await runControlVisibilityCheck(cdp);

    // --- 18. Die Provider-API am laufenden Obsidian --------------------------
    // Bewusst ausserhalb der --builtin/--quick-Bedingung: der Punkt braucht weder Server
    // noch Assets, nur die registrierte Plugin-Instanz.
    await runApiCheck(cdp);

    // --- 19. img2img am laufenden Wirt ---------------------------------------
    // Braucht den Server-Modus (die eingebaute Engine kann kein img2img) und den Mock.
    await runImg2ImgCheck(cdp, generateTimeoutMs);
  } finally {
    // Aufräumen darf nie am Ergebnis hängen: auch ein abgebrochener Lauf gibt den Vault
    // so zurück, wie er ihn vorgefunden hat.
    await cdp.evaluate(`app.setting.close?.(); return true;`).catch(() => undefined);
    if (previous !== null) {
      await cdp
        .evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          const before = ${JSON.stringify(previous)};
          p.settings.createMode = before.createMode;
          p.settings.outputFolder = before.outputFolder;
          p.settings.noteFolder = before.noteFolder;
          p.settings.history = before.history;
          p.settings.assetBaseUrl = before.assetBaseUrl;
          p.settings.builtinModel = before.builtinModel;
          p.settings.showModelPicker = before.showModelPicker;
          await p.saveSettings();
          if (p.settings.engine !== before.engine) await p.setEngine(before.engine);
          p.refreshViews();
          return true;
        `)
        .catch(() => undefined);
    }
    if (createdFolder && !keep) {
      await cdp
        .evaluate(`
          const folder = app.vault.getAbstractFileByPath(${JSON.stringify(SMOKE_FOLDER)});
          if (folder) await app.vault.delete(folder, true);
          return true;
        `)
        .catch(() => undefined);
    } else if (keep) {
      console.log(`\n(--keep: ${SMOKE_FOLDER} bleibt liegen, Settings sind zurückgesetzt)`);
    }
    cdp.close();
  }

  const failed = results.filter((check) => !check.passed);
  // Die Übersprungenen gehören in dieselbe Zeile wie die grünen. Sonst wird aus „3/3 grün"
  // beim Zitieren ein bestandener Smoke, obwohl ein Drittel nie gemessen wurde.
  const summe = `${results.length - failed.length}/${results.length} grün`;
  console.log(`\n${summe}${skipped.length > 0 ? ` · ${skipped.length} übersprungen (NICHT gemessen)` : ""}`);
  if (skipped.length > 0) {
    console.log("Übersprungen:");
    for (const check of skipped) console.log(`  – ${check.name}: ${check.detail}`);
  }
  if (failed.length > 0) {
    console.log("Rot:");
    for (const check of failed) console.log(`  - ${check.name}: ${check.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`\nAbbruch: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
