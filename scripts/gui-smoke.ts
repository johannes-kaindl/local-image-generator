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
 * SD.Next) auf dem Endpunkt, der in den Plugin-Settings steht. Ohne ihn bricht der Treiber
 * ab, statt rote Prüfpunkte zu melden — ein fehlender Server ist kein Plugin-Defekt.
 *
 * Dann, mit deployter Plugin-Version (`npm run deploy`):
 *
 * ```bash
 * npm run smoke:gui -- --vault <name>
 * npm run smoke:gui -- --vault <name> --port 9222 --steps 8 --keep
 * ```
 *
 * ⚠️ Chromium drosselt das Rendering nicht-fokussierter Fenster: ohne `Page.bringToFront`
 * plus `osascript activate` bleibt die View leer und man debuggt ein Phantom (CORE-TEST-02).
 */

import { execFileSync } from "node:child_process";
import { SIZES, STEPS } from "../src/core/generation";
import { registerI18n } from "../src/i18n/strings";
import { pickLang, setLang, t } from "../src/vendor/kit/i18n";

const PLUGIN_ID = "local-image-generator";
/** Zielordner für Bild + Ergebnis-Notiz. Wird angelegt und am Ende wieder entfernt
 *  (außer mit `--keep`) — so muss der Treiber keine Dateien aus fremden Ordnern fischen. */
const SMOKE_FOLDER = "_lig-gui-smoke";
const SMOKE_PROMPT = "gui smoke test, a single grey pebble on white paper";

// --- CDP-Minimalbrücke ------------------------------------------------------
// Node ≥21 bringt `WebSocket` global mit — keine Dependency nötig.

interface CdpTarget {
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface CdpResponse {
  id?: number;
  result?: {
    result?: { value?: unknown };
    // ABWEICHUNG zur Vorlage: dort wird nur `text` gelesen — das ist bei einer geworfenen
    // Ausnahme wörtlich "Uncaught" und sagt nichts. Die eigentliche Meldung steht in
    // `exception.description`. Gemessen 2026-08-06 beim ersten Fehlschlag im Settings-Modal.
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  };
  error?: { message?: string };
}

class Cdp {
  private nextId = 1;
  private readonly pending = new Map<number, { ok: (v: CdpResponse) => void; fail: (e: Error) => void }>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as CdpResponse;
      if (message.id === undefined) return; // Event, kein Antwort-Frame
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.fail(new Error(message.error.message ?? "CDP-Fehler"));
      else waiter.ok(message);
    });
  }

  static async attach(port: number, vault?: string): Promise<Cdp> {
    let targets: CdpTarget[];
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = (await response.json()) as CdpTarget[];
    } catch {
      throw new Error(
        `Kein Debug-Port auf ${port}. Obsidian mit --remote-debugging-port=${port} neu starten ` +
          `(siehe Kopfkommentar).`,
      );
    }

    // Das Hauptfenster ist die Seite mit Obsidians app-Schema; Popouts und DevTools
    // tragen andere URLs. Ohne diese Auswahl landet man im falschen Renderer.
    const pages = targets.filter(
      (t) => t.type === "page" && t.url.startsWith("app://obsidian.md") && t.webSocketDebuggerUrl,
    );
    if (pages.length === 0) {
      const seen = targets.map((t) => `${t.type} ${t.url}`).join("\n  ") || "(keine)";
      throw new Error(`Kein Obsidian-Fenster unter den Targets gefunden:\n  ${seen}`);
    }

    // Mehrere offene Vaults sind der Normalfall, nicht die Ausnahme. Blind das erste
    // Fenster zu nehmen hiesse, den Smoke im falschen Vault zu fahren — und der
    // Fehlschlag saehe aus wie ein Plugin-Defekt ("Plugin nicht aktiv"). Der Titel
    // traegt den Vault-Namen ("<Notiz> - <Vault> - Obsidian x.y.z").
    const matching = vault
      ? pages.filter((t) => t.title.toLowerCase().includes(vault.toLowerCase()))
      : pages;
    if (matching.length === 0) {
      throw new Error(
        `Kein Fenster passt zu --vault ${vault}. Offen:\n  ${pages.map((t) => t.title).join("\n  ")}`,
      );
    }
    if (matching.length > 1) {
      throw new Error(
        `Mehrere Obsidian-Fenster offen — mit --vault <name> eines waehlen:\n  ` +
          matching.map((t) => t.title).join("\n  "),
      );
    }
    // ABWEICHUNG zur Vorlage: dieses Repo fährt `noUncheckedIndexedAccess`. Die beiden
    // Längen-Prüfungen oben erzwingen bereits genau ein Element — das `!` macht das für
    // den Compiler sichtbar, statt eine tote Zweigstelle zu erfinden.
    const page = matching[0]!;
    // Der Filter oben garantiert die URL, der Typ nicht — der Guard haelt beides zusammen.
    if (!page.webSocketDebuggerUrl) throw new Error(`Fenster ohne Debugger-URL: ${page.title}`);
    console.log(`Fenster: ${page.title}`);

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket-Verbindung fehlgeschlagen")), {
        once: true,
      });
    });
    return new Cdp(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpResponse> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => {
      this.pending.set(id, { ok, fail });
      setTimeout(() => {
        if (!this.pending.delete(id)) return;
        fail(new Error(`Zeitüberschreitung: ${method}`));
      }, 30_000);
    });
  }

  /** Ausdruck im Renderer auswerten. Wirft die Renderer-Ausnahme weiter, statt sie
   *  als `undefined` zu verschlucken — sonst liest sich ein kaputter Ausdruck wie ein
   *  fehlgeschlagener Prüfpunkt. */
  async evaluate<T>(expression: string): Promise<T> {
    const message = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const details = message.result?.exceptionDetails;
    if (details) throw new Error(`Renderer: ${details.exception?.description ?? details.text ?? "Ausnahme"}`);
    return message.result?.result?.value as T;
  }

  close(): void {
    this.socket.close();
  }
}

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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const port = Number(flag("port") ?? 9222);
  const keep = argv.includes("--keep");
  const quick = argv.includes("--quick");
  const vault = flag("vault");
  // Wenige Steps und die kleinste Größe: der Smoke prüft die Kette, nicht die Bildqualität.
  // Bei FLUX.2 dev kostet der Default (20) rund vier Minuten pro Bild — zweimal im Lauf.
  const steps = Math.min(STEPS.max, Math.max(STEPS.min, Number(flag("steps") ?? 4)));
  const size = SIZES[0]!;
  /** Obergrenze pro Bild. Großzügig: ein langsamer Server ist kein Defekt. */
  const generateTimeoutMs = Number(flag("timeout") ?? 900) * 1000;

  console.log(`GUI-Smoke — Obsidian auf Port ${port}`);
  const cdp = await Cdp.attach(port, vault);

  // Alle Vorwerte AUSSERHALB des try: das finally muss sie auch nach einem Abbruch mitten
  // im Lauf zurückschreiben können — sonst bliebe der Vault im Smoke-Zustand stehen.
  let previous: { createMode: string; outputFolder: string; noteFolder: string; history: unknown[] } | null = null;
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

    const endpoint = (plugin.endpoint ?? "").trim();
    if (endpoint === "") throw new Error("Kein Server-Endpunkt in den Plugin-Settings — erst in den Settings eintragen.");

    // Die Sprache des Wirts übernehmen, damit die Label-Vergleiche unten gegen genau die
    // Strings laufen, die der Renderer rendert. Die Strings kommen aus src/ — derselben
    // Quelle wie im Plugin, kein zweiter, driftender Satz Erwartungen im Treiber.
    const rawLang = await cdp.evaluate<string | null>(`return window.localStorage.getItem("language");`);
    registerI18n();
    setLang(pickLang(rawLang));

    // Unabhängiges Orakel: was sagt der Server selbst?
    const expectedModel = await serverModelName(endpoint);
    if (expectedModel === null) {
      throw new Error(
        `Der Server unter ${endpoint} nennt weder \`model\` noch \`sd_model_checkpoint\`. ` +
          `Ohne bekanntes Erwartungs-Modell ist Punkt 3/8 nicht prüfbar.`,
      );
    }
    console.log(`Server meldet Modell: ${expectedModel}`);
    console.log(`Lauf: ${steps} Steps · ${size.width}×${size.height}\n`);

    // --- Szene herstellen ---------------------------------------------------
    // Ausgabe in einen eigenen Ordner lenken und createMode auf "note" stellen, damit
    // Punkt 8 die Ergebnis-Notiz überhaupt zu sehen bekommt. Vorwerte gemerkt (finally).
    previous = await cdp.evaluate<{ createMode: string; outputFolder: string; noteFolder: string; history: unknown[] }>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const before = {
        createMode: p.settings.createMode,
        outputFolder: p.settings.outputFolder,
        noteFolder: p.settings.noteFolder,
        history: JSON.parse(JSON.stringify(p.settings.history)),
      };
      p.settings.createMode = "note";
      p.settings.outputFolder = ${JSON.stringify(SMOKE_FOLDER)};
      p.settings.noteFolder = ${JSON.stringify(SMOKE_FOLDER)};
      await p.saveSettings();
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
    record(
      "4. „Generieren“ ist mit gesetztem Prompt bedienbar",
      generateReady.found && generateReady.enabled,
      generateReady.found ? (generateReady.enabled ? `Seed ${seedUsed}` : "Knopf ist gesperrt") : "Knopf nicht gefunden",
    );

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
    const searchable = await cdp.evaluate<{
      skip?: string;
      gesucht: string[];
      gefunden: string[];
      fehlend: string[];
      negativkontrolle: boolean;
    }>(`
      const tab = (app.setting.pluginTabs ?? []).find((t) => t.id === ${JSON.stringify(PLUGIN_ID)});
      if (!tab || typeof tab.getSettingDefinitions !== "function") {
        return { skip: "kein deklarativer Settings-Tab", gesucht: [], gefunden: [], fehlend: [], negativkontrolle: false };
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
      console.log(`  – 12. Settings-Suche übersprungen — ${searchable.skip}`);
    } else {
      record(
        "12. Die Einstellungen erscheinen in Obsidians Settings-Suche",
        searchable.fehlend.length === 0 && searchable.negativkontrolle && searchable.gesucht.length > 0,
        searchable.fehlend.length > 0
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
        started !== null,
        started ?? `Statuszeile blieb auf „${readyText}"`,
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
          cdp.evaluate<{ visible: boolean; length: number; status: string }>(`
            const card = document.querySelector(".lig-card");
            const img = document.querySelector(".lig-image");
            const status = document.querySelector(".lig-status-text");
            return {
              visible: !!card && !card.classList.contains("is-hidden"),
              length: img && img.src.startsWith("data:image/png") ? img.src.length : 0,
              status: status ? status.textContent.trim() : "",
            };
          `),
        (r) => r.visible && r.length > 5000,
        generateTimeoutMs,
        "warte auf das Bild",
      );
      record(
        "7. Die Generierung liefert ein Bild in die Karte",
        image !== null,
        image === null ? "kein Bild innerhalb der Frist" : `${Math.round(image.length / 1024)} KB Data-URL`,
      );
      if (image === null) throw new Error("Ohne Bild sind die Punkte 8–10 gegenstandslos — Abbruch.");

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
      // Der Tab-Knopf trägt `data-tab` (hub.ts) — daran greifen statt am übersetzten Label:
      // ein Selektor, der die Sprache des Wirts nicht kennen muss, kann an ihr auch nicht
      // scheitern. Beide Panels sind immer gemountet; der Klick löst zusätzlich onShow() aus,
      // das die Liste neu rendert — genau der Pfad, den ein Mensch nimmt.
      const restored = await cdp.evaluate<{ rows: number; prompt: string; seed: number } | null>(`
        const historyTab = document.querySelector('.lig-hub-tab[data-tab="history"]');
        if (!historyTab) return null;
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
        restored === null || restored.rows === 0
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
          await p.saveSettings();
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
  console.log(`\n${results.length - failed.length}/${results.length} grün`);
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
