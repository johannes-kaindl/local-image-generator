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
 * npm run smoke:gui -- --vault <name> --builtin                # + Punkte 13–16 (eingebaute Engine)
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
// Die CDP-Brücke liegt seit 2026-08-16 zentral im Dach (tools/obsidian-cdp/) und wird
// importiert, nicht vendored: sie ist plugin-neutral und lief zuvor byte-identisch in
// sechs Repos. Fehlt das Dach (fremder Checkout), bricht esbuild beim Auflösen ab — das
// ist die gewollte Meldung. Was ihr fehlt, wird DORT ergänzt, nicht hier nachgebaut.
import { Cdp, attachTo, clickReal } from "../../tools/obsidian-cdp/cdp.js";
import { SIZES, STEPS } from "../src/core/generation";
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

  // --- 13. Modus umstellen ---------------------------------------------------
  await cdp.evaluate(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    p.settings.assetBaseUrl = ${JSON.stringify(assetsBase)};
    await p.saveSettings();
    await p.setEngine("builtin");
    return true;
  `);
  let st = await pollUntil(engineState, (e) => e.kind !== "gpu-checking", 30_000, "warte auf den GPU-Check", 500);
  if (st?.kind === "gpu-missing") {
    record("13. Engine auf „Eingebaut“ — Panel zeigt den Modellzustand", true, `GPU fehlt (${st.reason}) — Panel meldet es; 14–16 gegenstandslos`);
    for (const n of ["14. Download über den Panel-Knopf endet auf „bereit“", "15. Die eingebaute Engine liefert ein Bild und eine Notiz mit model: sd-turbo", "16. Zurück auf „Server“ bringt die Regler zurück"])
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
    return;
  }

  // --- 14. Download über den Panel-Knopf -------------------------------------
  const t0 = Date.now();
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
    // 2,5 GB: lokal 30 s, vom echten HF-Repo je nach Leitung 10–20 min (gemessen 2026-08-19).
    30 * 60_000,
    "warte auf den Modell-Download",
    1000,
  );
  const status14 = await statusText();
  record(
    "14. Download über den Panel-Knopf endet auf „bereit“",
    done14?.kind === "ready" && sawProgress && status14 === readyText,
    done14 === null
      ? "Download nach 15 min nicht fertig"
      : done14.kind === "ready"
        ? `${Math.round((Date.now() - t0) / 1000)} s · Fortschritt gesehen: ${sawProgress} · Status „${status14}"`
        : `Engine-Zustand ${JSON.stringify(done14)}`,
  );
  if (done14?.kind !== "ready") {
    skip("15. Die eingebaute Engine liefert ein Bild und eine Notiz mit model: sd-turbo", "Vorbedingung 14 nicht erreicht");
    skip("16. Zurück auf „Server“ bringt die Regler zurück", "Vorbedingung 14 nicht erreicht");
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
  ".lig-size-slot",
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
  let previous: { createMode: string; outputFolder: string; noteFolder: string; history: unknown[]; engine: string; assetBaseUrl: string } | null = null;
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
    previous = await cdp.evaluate<{ createMode: string; outputFolder: string; noteFolder: string; history: unknown[]; engine: string; assetBaseUrl: string }>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const before = {
        createMode: p.settings.createMode,
        outputFolder: p.settings.outputFolder,
        noteFolder: p.settings.noteFolder,
        history: JSON.parse(JSON.stringify(p.settings.history)),
        engine: p.settings.engine,
        assetBaseUrl: p.settings.assetBaseUrl,
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

    // --- 13–16. Die eingebaute Engine (Spec 0.6) ------------------------------
    // Nur mit --builtin und nur gegen einen erreichbaren lokalen Asset-Server: der Block löscht
    // die Modell-Dateien aus dem Plugin-Cache und lädt sie neu (2,5 GB) — gegen das HF-Repo
    // wäre das ein Missbrauch der Leitung, gegen den lokalen Server dauert es rund eine Minute.
    if (!builtin) {
      console.log("\n(ohne --builtin: Punkte 13–16 übersprungen — sie brauchen den lokalen Asset-Server)");
    } else if (quick) {
      console.log("\n(--quick: Punkte 13–16 übersprungen — sie brauchen Download und Generierung)");
    } else {
      const assetsUp = await fetch(`${assetsBase.replace(/\/+$/, "")}/sd-turbo/tokenizer/vocab.json`, { method: "HEAD", signal: AbortSignal.timeout(3000) })
        .then((r) => r.status === 200)
        .catch(() => false);
      if (!assetsUp) {
        for (const n of ["13. Engine auf „Eingebaut“ — Panel zeigt den Modellzustand", "14. Download über den Panel-Knopf endet auf „bereit“", "15. Die eingebaute Engine liefert ein Bild und eine Notiz mit model: sd-turbo", "16. Zurück auf „Server“ bringt die Regler zurück"])
          skip(n, `Asset-Server unter ${assetsBase} antwortet nicht (npm run smoke:assets)`);
      } else {
        await runBuiltinChecks(cdp, assetsBase, generateTimeoutMs);
      }
    }

    // --- 17. Modusabhängige Regler, gerendert gemessen ------------------------
    // Bewusst ausserhalb der --builtin/--quick-Bedingung: der Punkt wechselt nur den Modus und
    // liest `getComputedStyle` — kein Download, kein Asset-Server, keine Generierung. Er läuft
    // damit in jedem Lauf, auch im schnellen.
    await runControlVisibilityCheck(cdp);
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
