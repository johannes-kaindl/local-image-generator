/**
 * Aufnahme-Treiber fuer die README-Bilder — faehrt den Vertrag aus `docs/images/README.md`
 * gegen ein **laufendes** Obsidian, statt die Bilder von Hand zu klicken.
 *
 * Bruecke, Aufnahme-Primitive und Fixture→Vault liegen zentral im Dach
 * (`obsidian-plugins/tools/obsidian-cdp/`); hier steht nur das Rezept — welches Bild was
 * zeigt. Dieselbe Aufteilung wie bei `scripts/gui-smoke.ts`, mit dem sich dieser Treiber
 * die Bruecke teilt.
 *
 * ## Ablauf
 *
 * ⚠️ **Vor dem Quit koordinieren — Obsidian ist geteilte Infrastruktur.** Dieses Rezept
 * braucht den frischen Start (ein Bild pro Start, jeder Lauf hinterlaesst Zustand); Mitnutzen ist
 * hier keine Alternative. Aber Obsidian ist Single-Instance: der Quit trifft die Instanz, an der
 * moeglicherweise eine andere Session arbeitet, und zerstoert deren Zustand. Der eigene Lauf ist
 * danach sauber gruen; der Schaden faellt nicht auf.
 *
 * ```bash
 * lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "belegt — erst fragen, wem"
 * ```
 *
 * Hoert der Port, haengt jemand dran: **erst fragen, dann quitten.** ⚠️ Und die Pruefung ersetzt die
 * Frage nicht — sie zeigt aktive CDP-Treiber, aber nicht, wer ein Fenster offen haelt oder auf den
 * Port wartet; am 2026-08-30 haette sie einen zwei Stunden alten Reindex nicht gezeigt, denn der
 * hing an Ollama, nicht am Port.
 *
 * ```bash
 * export STAGING_VAULTS_DIR="$HOME/StagingVaults"   # einmalig
 * npm run build && npm run shots -- --setup         # Vault aus dem Fixture bauen
 *
 * osascript -e 'quit app "Obsidian"'                # Handarbeit: Debug-Port
 * open -a Obsidian --args --remote-debugging-port=9222
 * #   ... den Aufnahme-Vault oeffnen und einmalig als vertrauenswuerdig markieren
 *
 * npm run shots                                     # alles aufnehmen
 * npm run shots -- --only settings.png              # ein Bild nachziehen
 * npm run shots -- --list                           # Vertrag anzeigen
 * ```
 *
 * ## Welches Backend die Bilder zeigen
 *
 * Seit 0.6 ist die **eingebaute Engine** der Default (SD-Turbo im Renderer). Ein frisch
 * installiertes Plugin steht dort, ohne geladenes Modell und ohne Server — genau diesen
 * Weg zeigen die Bilder. Bis 0.6 zeigten sie den Server-Modus; das war fuer 0.5 richtig
 * (reiner Thin Client) und ist seitdem die Ausnahme statt der Regel.
 *
 * Der Nebeneffekt traegt diesen Treiber: **kein fremder Server noetig.** Bis 2026-08-17
 * hingen drei Motive an einer Draw-Things-Installation, deren API sich nur von Hand
 * einschalten laesst — der Lauf war damit an eine Maschine gebunden. Jetzt braucht er nur
 * WebGPU mit shader-f16.
 *
 * ## Der eine Zustandskonflikt, den die Reihenfolge loest
 *
 * `first-run.png` muss das Panel mit **nicht geladenem** Modell zeigen (der Download-CTA
 * ist die Aussage: ohne Klick fliesst kein Byte), `hero.png` & Co. brauchen es **geladen**.
 * Beides im selben Lauf geht nur in dieser Reihenfolge: erst der Erstkontakt, dann der
 * Download ueber den echten Knopf, dann alles Weitere. `--only` stellt den jeweils noetigen
 * Zustand selbst her — `first-run.png` raeumt den Cache dafuer per `removeModel()`, und das
 * kostet den naechsten Volllauf einen erneuten Download von ~2,5 GB. Wer nur schnell ein
 * Panel-Bild nachziehen will, nimmt `generate-panel.png`.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, env, exit } from "node:process";

import { Cdp, attachTo, openExisting, setPluginSetting } from "../../tools/obsidian-cdp/cdp.js";
import { boxAround, capture, setWindowSize, withMetrics, writeShot } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const PLUGIN_ID = "local-image-generator";
const REPO_NAME = "local-image-generator";
const OUT_DIR = "docs/images";
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;
const FENSTER_BREITE = 1280;
const FENSTER_HOEHE = 940;
/** Breite der rechten Sidebar. Der Auslieferungswert (~300 px) macht die Reglerzeilen
 *  im Bild unleserlich; die Breite ist Nutzer-Sache, kein Produktmerkmal — anders als
 *  ein Plugin-Setting, das den Auslieferungszustand zeigen muss. */
const SIDEBAR_BREITE = 440;
/** Nur fuer `settings-server.png`: der Wert, der in der Endpunkt-Zeile stehen soll. Es wird
 *  NICHT geprueft, ob dort etwas antwortet — das Bild zeigt, wo der zweite Weg anfaengt,
 *  nicht ob auf dieser Maschine gerade ein Server laeuft. */
const BEISPIEL_ENDPOINT = env.SHOTS_ENDPOINT ?? "http://127.0.0.1:7860";
/** Frist fuer den Modell-Download (~2,5 GB). Grosszuegig: die Quelle ist ein fremder Host,
 *  und ein Abbruch mitten im Download kostet den ganzen Lauf. */
const DOWNLOAD_FRIST_MS = 45 * 60_000;
const PADDING = 8;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Shot {
  name: string;
  klasse: "hero" | "feature" | "detail";
  /** Stellt den Zustand her und liefert den Bildausschnitt (null = nicht aufnehmbar). */
  run(cdp: Cdp, explizit: boolean): Promise<Rect | null>;
  /** Grund, dieses Motiv im Sammellauf zu ueberspringen (null = aufnehmen). Nur fuer Motive,
   *  deren Zustandsherstellung teuer ist; `--only <name>` erzwingt sie trotzdem. */
  ueberspringen?(cdp: Cdp, outDir: string): Promise<string | null>;
}

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

/** Den Hub in der rechten Sidebar oeffnen und auf den gewuenschten Reiter stellen.
 *  Ueber das echte Kommando, nicht ueber `setViewState`: so laeuft derselbe Weg wie beim
 *  Nutzer (Ribbon/Palette → activateView), inklusive der Sidebar-Wahl des Plugins. */
async function hubOeffnen(cdp: Cdp, reiter: "Generate" | "History"): Promise<boolean> {
  return Boolean(
    await cdp.evaluate<boolean>(`
      app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:open`)});
      await new Promise((r) => setTimeout(r, 800));
      // Sidebar verbreitern: die Vorgabe ist zu schmal, um Reglerzeilen zu lesen.
      app.workspace.rightSplit?.setSize?.(${SIDEBAR_BREITE});
      await new Promise((r) => setTimeout(r, 400));
      const tab = [...document.querySelectorAll(".okit-hub-tab")]
        .find((t) => t.textContent.trim().includes(${JSON.stringify(reiter)}));
      if (tab) { tab.click(); await new Promise((r) => setTimeout(r, 400)); }
      // Obsidians Statusleiste schwebt ueber der rechten Sidebar und klebt sonst als
      // fremdes Symbol in jeder Panel-Aufnahme. Sie gehoert dem Wirt, nicht dem Plugin.
      if (!document.getElementById("lig-shots-style")) {
        const s = document.createElement("style");
        s.id = "lig-shots-style";
        // Dazu die Notices: „Model downloaded and verified" ist eine korrekte Meldung des
        // Wirts ueber ein Ereignis, das der LAUF ausgeloest hat — im Bild ein schwarzer
        // Kasten ueber dem Panel, der beim Leser nie so stehen wuerde. Gemessen 2026-08-21.
        s.textContent = ".status-bar { display: none !important; } .notice-container { display: none !important; }";
        document.head.appendChild(s);
      }
      const panel = document.querySelector(".lig-panel, .okit-hub-root");
      return !!panel && panel.getBoundingClientRect().width > 1;
    `),
  );
}

/**
 * Warten, bis das Panel eingeschwungen ist — nicht nur, bis es DA ist.
 *
 * `refresh()` setzt die Reglergrenzen aus dem Backend (`vm.controls`) und klemmt den Wert
 * hinein; zwischen dem ersten Render und diesem Nachziehen liegt ein Zustand, den es beim
 * Nutzer nie zu sehen gibt. Gemessen 2026-08-21: `first-run.png` zeigte „Steps 20" auf
 * einem Regler bis 50, waehrend das Panel Sekunden spaeter korrekt `min 1, max 4, value 4`
 * trug. Der Lauf meldete ein Haekchen — das Bild war einfach zu frueh.
 *
 * Geprueft wird auf RUHE (zwei gleiche Messungen), nicht auf einen erwarteten Wert: der
 * Treiber soll das Panel abbilden, nicht ihm vorschreiben, was es zeigen muss.
 */
async function panelRuhig(cdp: Cdp): Promise<void> {
  let vorherige = "";
  for (let i = 0; i < 25; i++) {
    const jetzt = await cdp.evaluate<string>(`
      const s = document.querySelector(".lig-steps");
      const neg = document.querySelector(".lig-negative-row");
      const cfg = document.querySelector(".lig-cfg");
      return [
        s ? s.min + "/" + s.max + "/" + s.value : "-",
        neg ? getComputedStyle(neg).display : "-",
        cfg ? getComputedStyle(cfg).display : "-",
        document.querySelectorAll(".lig-chip").length,
      ].join("|");
    `);
    if (jetzt !== "" && jetzt === vorherige) return;
    vorherige = jetzt;
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * Ausschnitt eines Sidebar-Panels: Breite vom Blatt-Container, Hoehe vom Inhalt.
 *
 * Zwei Quellen, weil keine allein stimmt — der Container zeigt nur seinen sichtbaren
 * Teil (Hoehe zu klein, sobald der Inhalt scrollt), der Inhalt kennt die Blattkante
 * nicht (Breite zu schmal, Rand fehlt). Gemessen als Falle in yijing-oracle.
 */
async function panelBox(cdp: Cdp, inhalt: string): Promise<Rect | null> {
  // Auf ein RUHIGES Layout warten, nicht auf eine Sekundenzahl: `rightSplit.setSize()`
  // wirkt asynchron, und eine Box, die waehrend der Animation gemessen wird, ist
  // rechnerisch einwandfrei und zeigt trotzdem den falschen Ausschnitt — im ersten Lauf
  // stand der halbe Editor im Bild und das Panel war rechts abgeschnitten. Zwei gleiche
  // Messungen hintereinander sind das Signal (dieselbe Regel wie beim Warten auf einen
  // fertigen Stream: auf Ruhe warten, nicht auf Zeit).
  let vorherige = "";
  for (let i = 0; i < 20; i++) {
    const jetzt = await cdp.evaluate<string>(`
      const el = document.querySelector('.workspace-leaf-content[data-type=${JSON.stringify(PLUGIN_ID)}]');
      if (!el) return "";
      const b = el.getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)].join(",");
    `);
    if (jetzt !== "" && jetzt === vorherige) break;
    vorherige = jetzt;
    await new Promise((r) => setTimeout(r, 300));
  }
  return cdp.evaluate<Rect | null>(`
    const blatt = [...document.querySelectorAll('.workspace-leaf-content[data-type=${JSON.stringify(PLUGIN_ID)}]')]
      .find((e) => e.getBoundingClientRect().width > 1);
    const el = document.querySelector(${JSON.stringify(inhalt)});
    if (!blatt || !el) return null;
    const b = blatt.getBoundingClientRect();
    const i = el.getBoundingClientRect();
    if (b.width < 2 || i.height < 2) return null;
    const oben = Math.max(0, Math.floor(b.top) - ${PADDING});
    // Am Fensterrand kappen: captureBeyondViewport verlaengert die SEITE, nicht einen
    // scrollenden Kasten — was darunter liegt, waere im Bild eine weisse Flaeche.
    const unten = Math.min(Math.ceil(i.bottom) + ${PADDING}, window.innerHeight - 4);
    return {
      x: Math.max(0, Math.floor(b.left) - ${PADDING}),
      y: oben,
      width: Math.ceil(b.width) + 2 * ${PADDING},
      height: Math.max(2, unten - oben),
    };
  `);
}

/**
 * Das Modell laden — ueber den Knopf, den auch der Nutzer drueckt.
 *
 * Nicht ueber `plugin.startDownload()`: der CTA im leeren Panel ist der Weg, den das
 * Produkt anbietet, und ein Rezept, das ihn umgeht, prueft ihn nie. (Dieselbe Regel, die
 * 2026-08-17 den Server-Fall rettete: `setPluginSetting` schrieb den Endpunkt, aber erst
 * `checkServer()` erzeugte den Zustand, den der Generate-Knopf verlangt.)
 *
 * Liegt das Modell schon im Cache, passiert nichts — der Zustand ist dann bereits der
 * gewuenschte, und 2,5 GB erneut zu laden waere Zeitverschwendung ohne Erkenntnis.
 */
async function modellBereit(cdp: Cdp): Promise<boolean> {
  if (await modellIstBereit(cdp)) return true;
  // Klicken nur, wenn der CTA da ist. Fehlt er, heisst das NICHT „nicht aufnehmbar": es
  // laeuft womoeglich schon ein Download, und dann traegt derselbe Knopf „Cancel download".
  // In dem Fall faellt der Ablauf direkt in die Warteschleife unten.
  await cdp.evaluate(`
    const knopf = [...document.querySelectorAll(".lig-empty button")]
      .find((b) => /download model|modell laden|modell herunterladen/i.test(b.textContent.trim()));
    if (knopf) knopf.click();
    return true;
  `);
  const frist = Date.now() + DOWNLOAD_FRIST_MS;
  let letzterStand = "";
  while (Date.now() < frist) {
    const stand = await cdp.evaluate<string>(`
      const st = document.querySelector(".lig-status-text");
      return st ? st.textContent.trim() : "";
    `);
    if (stand !== letzterStand && stand !== "") {
      console.log(`      · ${stand}`);
      letzterStand = stand;
    }
    if (await modellIstBereit(cdp)) return true;
    if (/^(error|fehler)/i.test(stand)) {
      console.log(`      ⚠ Download gescheitert: ${stand}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/**
 * Bereit = die Engine sagt `ready`. Gefragt wird der Zustand, nicht das DOM.
 *
 * Der naheliegende DOM-Test („kein Download-CTA mehr da, Generate-Knopf vorhanden") ist
 * FALSCH und meldet mitten im Download Erfolg: waehrend `downloading` traegt derselbe Knopf
 * die Aufschrift „Cancel download", der CTA-Test greift also ins Leere. Gemessen 2026-08-21
 * im ersten Volllauf — `generate-panel.png` entstand bei „8 MB / 681 MB (file 1 of 6)" und
 * zeigte das ladende statt des benutzbaren Panels. Der Lauf meldete dabei ein Haekchen.
 *
 * `state.engine.kind` ist die Quelle, aus der auch `generateEnabled` seine Antwort zieht
 * (`viewmodel.ts`: `backendReady = builtin ? s.engine.kind === "ready" : …`) — dieselbe
 * Frage wie die des Produkts, nicht eine nachgebaute.
 */
async function modellIstBereit(cdp: Cdp): Promise<boolean> {
  return Boolean(
    await cdp.evaluate<boolean>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      return p?.state?.engine?.kind === "ready";
    `),
  );
}

/**
 * Den Erstkontakt-Zustand herstellen: Modell aus dem Cache raeumen.
 *
 * Ueber `removeModel()` statt ueber den Settings-Knopf, weil dort eine Bestaetigung
 * dazwischenliegt — das ist Zustandsherstellung, kein Produktverhalten, genau wie
 * `createMode` weiter unten. **Teuer:** der naechste Lauf laedt die ~2,5 GB erneut.
 */
async function modellEntfernen(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    await app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].removeModel();
    await new Promise((r) => setTimeout(r, 800));
    return true;
  `);
}

/** Einen echten Lauf fahren und auf das Bild in der Karte warten. Derselbe Weg wie beim
 *  Nutzer: Prompt ins Feld, Klick auf „Generieren" — nicht ueber den Plugin-State. */
async function erzeuge(cdp: Cdp, prompt: string, seed?: number, timeoutMs = 600_000): Promise<boolean> {
  // Die Bild-Signatur VOR dem Lauf merken. Sonst meldet der naechste Aufruf sofort
  // „fertig", weil das Bild des vorigen Laufs noch in der Karte haengt — gemessen
  // 2026-08-17: zwei Laeufe fuer den Verlauf wurden uebersprungen, das Bild zeigte einen
  // einzigen Eintrag, und der Lauf meldete Erfolg. Gefragt ist ein NEUES Bild, nicht
  // irgendeines.
  const vorher = await cdp.evaluate<string>(`
    const img = document.querySelector(".lig-image");
    return img && img.src ? String(img.src.length) + ":" + img.src.slice(22, 54) : "";
  `);
  await cdp.evaluate(`
    const feld = document.querySelector(".lig-prompt:not(.lig-negative)");
    feld.value = ${JSON.stringify("")};
    feld.dispatchEvent(new Event("input", { bubbles: true }));
    feld.value = ${JSON.stringify(prompt)};
    feld.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const stepsEl = document.querySelector(".lig-steps");
    if (stepsEl) { stepsEl.value = "4"; stepsEl.dispatchEvent(new Event("input", { bubbles: true })); }
    // Seed direkt ins Feld, nicht ueber den Wuerfel-Knopf: der traegt keine eigene Klasse
    // (nur clickable-icon + lokalisiertes aria-label), und ein Selektor darauf griff ins
    // Leere — im Verlaufs-Bild standen dadurch zwei Laeufe mit DEMSELBEN Seed, was wie ein
    // Copy-Paste-Fehler aussieht. Feste Werte statt Zufall: zwei Aufnahmen sollen dasselbe
    // Bild ergeben.
    const seedEl = document.querySelector(".lig-seed");
    if (seedEl && ${JSON.stringify(seed ?? null)} !== null) {
      seedEl.value = String(${JSON.stringify(seed ?? 0)});
      seedEl.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
    }
    const knopf = document.querySelector(".lig-generate");
    if (knopf && !knopf.disabled) knopf.click();
    return true;
  `);
  const frist = Date.now() + timeoutMs;
  while (Date.now() < frist) {
    const stand = await cdp.evaluate<{ fertig: boolean; status: string }>(`
      const img = document.querySelector(".lig-image");
      const st = document.querySelector(".lig-status-text");
      const sig = img && img.src ? String(img.src.length) + ":" + img.src.slice(22, 54) : "";
      return {
        fertig: !!img && img.src.startsWith("data:image/png") && img.src.length > 5000
                && sig !== ${JSON.stringify(vorher)},
        status: st ? st.textContent.trim() : "",
      };
    `);
    // Zweiter Ausgang wie im GUI-Smoke: ein gemeldeter Fehlschlag ist kein Fortschritt.
    if (stand.status.startsWith("Fehler") || stand.status.startsWith("Error")) {
      console.log(`      ⚠ Lauf gescheitert: ${stand.status}`);
      return false;
    }
    if (stand.fertig) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** Aus dem fertigen Bild eine Ergebnis-Notiz machen (Knopf „Create"). */
async function alsNotiz(cdp: Cdp): Promise<string | null> {
  await setPluginSetting(cdp, PLUGIN_ID, "createMode", "note");
  await cdp.evaluate(`
    const knopf = [...document.querySelectorAll(".lig-actions button")]
      .find((b) => /create|erstellen/i.test(b.textContent.trim()));
    if (knopf) knopf.click();
    return true;
  `);
  for (let i = 0; i < 30; i++) {
    const pfad = await cdp.evaluate<string | null>(`
      const md = app.vault.getFiles().filter((f) => f.extension === "md" && !f.path.startsWith("."));
      const neueste = md.sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
      return neueste && Date.now() - neueste.stat.mtime < 60000 ? neueste.path : null;
    `);
    if (pfad) return pfad;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

const SHOTS: Shot[] = [
  {
    // MUSS vor allen anderen laufen: zeigt das Panel OHNE geladenes Modell. Der
    // Download-CTA ist die Aussage des Bildes — „nichts wird vor deinem Klick geladen"
    // steht damit im Bild statt nur in der README.
    name: "first-run.png",
    klasse: "detail",
    async ueberspringen(cdp, outDir) {
      // Der Erstkontakt-Zustand kostet den Cache: `removeModel()` wirft ~2,5 GB weg, die der
      // naechste Shot ueber die Leitung zurueckholt. Das ist beim ERSTEN Mal richtig und bei
      // jedem weiteren Volllauf reine Wartezeit — das Bild aendert sich ja nicht. Also nur
      // aufnehmen, wenn es fehlt oder ausdruecklich verlangt wird.
      if (!existsSync(join(outDir, "first-run.png"))) return null;
      const geladen = await modellIstBereit(cdp);
      return geladen
        ? "liegt vor und das Modell ist geladen — `--only first-run.png` nimmt es neu auf (loescht ~2,5 GB)"
        : null;
    },
    async run(cdp) {
      if (!(await hubOeffnen(cdp, "Generate"))) return null;
      await modellEntfernen(cdp);
      await new Promise((r) => setTimeout(r, 600));
      const cta = await cdp.evaluate<boolean>(`
        return [...document.querySelectorAll(".lig-empty button")]
          .some((b) => /download model|modell laden|modell herunterladen/i.test(b.textContent.trim()));
      `);
      // Kein CTA heisst hier nicht „schon geladen" (gerade entfernt), sondern: dieses
      // Obsidian hat kein WebGPU mit shader-f16. Dann zeigt das Panel `empty.gpuMissing`,
      // und das Bild waere eine Aussage ueber die Aufnahme-Maschine.
      if (!cta) return null;
      await panelRuhig(cdp);
      return panelBox(cdp, ".lig-panel");
    },
  },
  {
    // Ab hier ist das Modell geladen — der Zustand, in dem das Plugin benutzt wird.
    name: "generate-panel.png",
    klasse: "feature",
    async run(cdp) {
      if (!(await hubOeffnen(cdp, "Generate"))) return null;
      if (!(await modellBereit(cdp))) return null;
      await panelRuhig(cdp);
      return panelBox(cdp, ".lig-panel");
    },
  },
  {
    name: "style-chips.png",
    klasse: "detail",
    async run(cdp) {
      if (!(await hubOeffnen(cdp, "Generate"))) return null;
      await panelRuhig(cdp);
      // Nur die Stil-Leiste. `boxAround` nimmt die Vereinigung mehrerer Elemente — die
      // Beschriftung „Styles" steht als eigenes Span neben den Chips.
      return boxAround(cdp, [".lig-chips"], PADDING);
    },
  },
  {
    // Das Verkaufsbild: ganzes Fenster, Ergebnis rechts, die Notiz daneben, in die es
    // gehoert. Nur hier ist der Ausschnitt das FENSTER — ein Panel allein zeigt das
    // Produkt nicht, es zeigt ein Panel.
    name: "hero.png",
    klasse: "hero",
    async run(cdp) {
      if (!(await hubOeffnen(cdp, "Generate"))) return null;
      if (!(await modellBereit(cdp))) return null;
      if (!(await erzeuge(cdp, "an empty reading room, low winter sun through tall windows, dust in the air, muted colours", 1455058787))) return null;
      const notiz = await alsNotiz(cdp);
      if (notiz) {
        await openExisting(cdp, notiz, "preview");
        await new Promise((r) => setTimeout(r, 1500));
      }
      return cdp.evaluate<Rect | null>(`
        return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
      `);
    },
  },
  {
    name: "history.png",
    klasse: "detail",
    async run(cdp) {
      if (!(await hubOeffnen(cdp, "Generate"))) return null;
      if (!(await modellBereit(cdp))) return null;
      await setPluginSetting(cdp, PLUGIN_ID, "createMode", "image");
      await new Promise((r) => setTimeout(r, 600));
      // Nur so viele Laeufe fahren, wie fuer „mehrere Eintraege" fehlen. Vorhandene sind
      // echte Laeufe und genauso gueltig — jeder zusaetzliche kostet Minuten am Server.
      // Die Prompts stammen aus der Fixture-Notiz „Field-notes", damit Bild und Vault
      // dieselbe Geschichte erzaehlen statt zufaellig nebeneinanderzustehen.
      const vorhanden = await cdp.evaluate<number>(`
        return (app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.history || []).length;
      `);
      const prompts: [string, number][] = [
        ["a lighthouse on a rocky shore, early morning fog", 604212883],
        ["a market stall at dusk, paper lanterns", 331920475],
      ];
      for (const [text, seed] of prompts.slice(0, Math.max(0, 3 - vorhanden))) {
        if (!(await erzeuge(cdp, text, seed))) break; // ein misslungener Zusatzlauf ist kein
        // Grund, das ganze Bild fallen zu lassen — die vorhandenen Eintraege reichen.
      }
      if (!(await hubOeffnen(cdp, "History"))) return null;
      await new Promise((r) => setTimeout(r, 800));
      // Die Hoehe kommt von der LETZTEN EINTRAGSZEILE, nicht vom Reiter-Inhalt. Der ist so
      // hoch wie das Panel; bei zwei Eintraegen bestand das Bild zu zwei Dritteln aus
      // leerer Flaeche und bestand dabei jeden Check (gemessen 2026-08-21).
      // `.lig-hist-list` hilft hier nicht als Ganzes — vor dem Kit-Umbau mass der Container
      // 0 px, seither die volle Scrollhoehe; beides ist die falsche Zahl.
      return cdp.evaluate<Rect | null>(`
        const blatt = [...document.querySelectorAll('.workspace-leaf-content[data-type=${JSON.stringify(PLUGIN_ID)}]')]
          .find((e) => e.getBoundingClientRect().width > 1);
        const zeilen = [...document.querySelectorAll(".lig-hist-row, .lig-hist-group, .lig-hist-empty")]
          .filter((e) => e.getBoundingClientRect().height > 1);
        const letzte = zeilen[zeilen.length - 1];
        if (!blatt || !letzte) return null;
        const b = blatt.getBoundingClientRect();
        const l = letzte.getBoundingClientRect();
        const oben = Math.max(0, Math.floor(b.top) - ${PADDING});
        const unten = Math.min(Math.ceil(l.bottom) + ${PADDING}, window.innerHeight - 4);
        return {
          x: Math.max(0, Math.floor(b.left) - ${PADDING}),
          y: oben,
          width: Math.ceil(b.width) + 2 * ${PADDING},
          height: Math.max(2, unten - oben),
        };
      `);
    },
  },
  {
    name: "result-note.png",
    klasse: "feature",
    async run(cdp) {
      const notiz = await cdp.evaluate<string | null>(`
        const md = app.vault.getFiles().filter((f) => f.extension === "md" && !f.path.startsWith("."));
        const neueste = md.sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
        return neueste ? neueste.path : null;
      `);
      if (!notiz) return null;
      await openExisting(cdp, notiz, "preview");
      await new Promise((r) => setTimeout(r, 1500));
      // Properties-Tabelle einblenden: das Rezept IM Frontmatter ist der Punkt dieses
      // Bildes — ohne sie zeigt es nur ein eingebettetes Bild.
      await cdp.evaluate(`
        app.vault.setConfig("propertiesInDocument", "visible");
        app.workspace.trigger("css-change");
        await new Promise((r) => setTimeout(r, 800));
        return true;
      `);
      return cdp.evaluate<Rect | null>(`
        const el = [...document.querySelectorAll(".markdown-preview-view, .markdown-reading-view")]
          .find((e) => e.getBoundingClientRect().width > 1);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        const breite = Math.ceil(b.width);
        // Auf das Klassen-Seitenverhaeltnis begrenzen (feature: H/B <= 1.6). Lieber hier
        // entscheiden, wo die Kante faellt, als das Bild spaeter nachzuschneiden: das
        // Rezept bleibt so die einzige Quelle fuer den Ausschnitt.
        const maxHoehe = Math.floor(breite * 1.55);
        return {
          x: Math.max(0, Math.floor(b.left)),
          y: Math.max(0, Math.floor(b.top)),
          width: breite,
          height: Math.min(maxHoehe, Math.ceil(Math.min(b.height, window.innerHeight - b.top - 4))),
        };
      `);
    },
  },
];

/**
 * Der Einstellungen-Tab.
 *
 * Ab Obsidian 1.13 ist das ein EIGENES Fenster (URL `about:blank`, Titel lokalisiert) —
 * es wird ueber die Sache gewaehlt: das Fenster ohne Workspace. Der Tab ist hoeher als
 * das Fenster, deshalb wird bis zum letzten Kind des Inhalts geschnitten und der Rest
 * per Vorschaubild in der README verlinkt.
 */
async function settingsBild(port: number, outDir: string, modus: "builtin" | "server" = "builtin"): Promise<string> {
  const name = modus === "server" ? "settings-server.png" : "settings.png";
  const haupt = await attachTo("workspace", port, REPO_NAME);
  if (!haupt) return `${name} — kein Hauptfenster`;
  // Nur den Endpunkt-WERT vorbereiten, nicht den Modus: der wird unten im Fenster ueber das
  // Dropdown umgeschaltet, damit dessen `onChange` die Zeilen neu zeichnet. Wer den Modus
  // hier schon setzt, nimmt dem Wechsel seinen Anlass — das Dropdown steht dann bereits
  // richtig, das Ereignis bleibt aus, und die gecachten Definitionen zeigen weiter die
  // Zeile des alten Modus (gemessen 2026-08-21, zweimal hintereinander).
  await setPluginSetting(haupt, PLUGIN_ID, "endpoint", modus === "server" ? BEISPIEL_ENDPOINT : "");
  await haupt.evaluate(`
    app.setting.open();
    app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  `);
  haupt.close();

  const fenster = (await attachTo("settings", port, REPO_NAME)) ?? (await attachTo("workspace", port, REPO_NAME));
  if (!fenster) return `${name} — kein Einstellungen-Fenster`;
  try {
    await fenster.send("Page.bringToFront");
    await new Promise((r) => setTimeout(r, 600));

    // Den Modus HIER umschalten, ueber das Dropdown — nicht nur ueber die Einstellung.
    // Obsidian 1.13 cacht `getSettingDefinitions()` und wertet die Praedikate nicht neu aus:
    // ein vorab gesetzter Wert faerbt zwar das Dropdown, laesst darunter aber die Zeile des
    // ALTEN Modus stehen. Gemessen 2026-08-21: „Server" gewaehlt, darunter die
    // SD-Turbo-Modellzeile. Das `onChange` des Dropdowns ruft `refreshUi()` — also den Weg
    // gehen, den auch der Nutzer geht, statt den Zustand danebenzulegen.
    await fenster.evaluate(`
      const sel = [...document.querySelectorAll(".setting-item select, select.dropdown")]
        .find((s) => [...s.options].some((o) => /built-in|eingebaut/i.test(o.textContent)));
      if (sel && sel.value !== ${JSON.stringify(modus)}) {
        sel.value = ${JSON.stringify(modus)};
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 900));
      }
      return true;
    `);

    // Den Legacy-Aufraeumer ausblenden. Er ist KEIN Produktmerkmal, sondern ein Rest
    // dieser Installation: `visible: () => this.legacyCache === true` zeigt ihn nur, wenn
    // im app-weiten Cache noch SD-Turbo-Gewichte aus der Zeit vor 0.5 liegen. Auf dem
    // Rechner des Maintainers ist das so, in einer frischen Installation nie — ohne diesen
    // Eingriff dokumentierte das Bild also die Aufnahme-Umgebung statt des Produkts.
    // (Der Weg ueber die echte Quelle waere, die 2,5 GB zu loeschen; das ist eine
    // Entscheidung des Maintainers, nicht die eines Aufnahme-Laufs.)
    await fenster.evaluate(`
      // NUR die Aufraeum-Zeile treffen. Ein Filter auf „SD-Turbo" tut das nicht: die
      // Engine-Beschreibung lautet „Built-in: SD-Turbo runs on your GPU …" und die
      // Modell-Zeile heisst „SD-Turbo model (2.5 GB)" — beide verschwanden mit, und das
      // Bild zeigte einen Abschnitt „Engine", unter dem nichts stand (gemessen 2026-08-21;
      // der Fehler fiel erst beim Ansehen auf, der Lauf meldete zwei Haekchen). Die
      // Aufraeum-Zeile beginnt als einzige mit ihrem Verb.
      const zeilen = [...document.querySelectorAll(".setting-item")];
      for (const z of zeilen) {
        if (/^(delete old|alte).*(weights|gewichte)/i.test(z.textContent.trim())) z.style.display = "none";
      }
      await new Promise((r) => setTimeout(r, 200));
      return true;
    `);

    // Erst MESSEN, wie hoch der Tab wirklich ist, dann so hoch simulieren. Eine feste
    // Simulationshoehe schneidet den Rest ab und fuellt ihn schwarz: der Tab scrollt in
    // einem eigenen Kasten, und `captureBeyondViewport` verlaengert die SEITE, nicht den
    // Kasten. Im ersten Lauf waren dadurch 42 % des Bildes schwarze Flaeche, und die
    // Stil-Verwaltung — das halbe Motiv — fehlte darunter.
    const masse = await fenster.evaluate<{ breite: number; hoehe: number } | null>(`
      const inhalt = document.querySelector(".vertical-tab-content.is-active, .vertical-tab-content");
      if (!inhalt) return null;
      return {
        breite: Math.ceil(inhalt.getBoundingClientRect().width),
        hoehe: Math.ceil(inhalt.scrollHeight),
      };
    `);
    if (!masse) return `${name} — Einstellungen-Inhalt nicht gefunden`;

    return await withMetrics(fenster, FENSTER_BREITE, masse.hoehe + 120, async () => {
      await new Promise((r) => setTimeout(r, 900));
      const box = await fenster.evaluate<Rect | null>(`
        const inhalt = document.querySelector(".vertical-tab-content.is-active, .vertical-tab-content");
        if (!inhalt) return null;
        const kinder = [...inhalt.children].filter((k) => k.getBoundingClientRect().height > 0);
        // Der Server-Ausschnitt endet nach dem Engine-Abschnitt: das Bild zeigt, WO der
        // zweite Weg anfaengt: Umschalter und Endpunkt-Zeile. Alles darunter (Ordner,
        // Stile, Advanced) ist in beiden Modi gleich und steht schon in settings.png.
        const letztes = ${JSON.stringify(modus)} === "server"
          ? kinder.find((k) => /test connection|verbindung testen/i.test(k.textContent)) ?? kinder[1] ?? kinder[0]
          : kinder[kinder.length - 1];
        if (!letztes) return null;
        const c = inhalt.getBoundingClientRect();
        const l = letztes.getBoundingClientRect();
        // Das LETZTE KIND bestimmt die Hoehe, nicht der Container: der ist in der
        // Simulation so hoch wie die Simulation, und der Rest waere Leere.
        return {
          x: Math.max(0, Math.floor(c.left)),
          y: Math.max(0, Math.floor(c.top)),
          width: Math.ceil(c.width),
          height: Math.max(2, Math.ceil(l.bottom - c.top) + 16),
        };
      `);
      if (!box) return `${name} — Einstellungen-Inhalt nicht gefunden`;
      const png = await capture(fenster, box);
      return await writeShot(fenster, name, png, {
        outDir,
        captureWidth: CAPTURE_WIDTH,
        thumbWidth: THUMB_WIDTH,
        thumb: true,
      });
    });
  } finally {
    await fenster.evaluate("app.setting?.close?.(); return true;").catch(() => undefined);
    fenster.close();
    // Den Auslieferungszustand wiederherstellen: ein zurueckgelassener Server-Modus liesse
    // jedes Panel-Bild eines Folgelaufs das falsche Backend zeigen.
    if (modus === "server") {
      const zurueck = await attachTo("workspace", port, REPO_NAME);
      if (zurueck) {
        await setPluginSetting(zurueck, PLUGIN_ID, "engine", "builtin");
        await setPluginSetting(zurueck, PLUGIN_ID, "endpoint", "");
        zurueck.close();
      }
    }
  }
}

async function main(): Promise<void> {
  const repoRoot = cwd();
  const outDir = join(repoRoot, OUT_DIR);

  if (argv.includes("--list")) {
    for (const s of SHOTS) console.log(`  ${s.klasse.padEnd(8)} ${s.name}`);
    console.log("  feature  settings.png");
    console.log("  detail   settings-server.png");
    return;
  }

  if (argv.includes("--setup")) {
    const vaultDir = stagingVaultDir(REPO_NAME);
    console.log(`Aufnahme-Vault: ${vaultDir}`);
    for (const zeile of buildVault({
      repoRoot,
      vaultDir,
      fixtureDir: join(repoRoot, "docs/images/fixture"),
      pluginId: PLUGIN_ID,
    })) {
      console.log(`  ${zeile}`);
    }
    console.log(
      "\n⚠️  Lief Obsidian waehrend dieses Setups, muss es JETZT neu starten. --setup hat\n" +
        "   Notizen, Layout und Plugin-Einstellungen ersetzt; ein laufendes Obsidian haelt\n" +
        "   den alten Stand im Speicher und schreibt ihn zurueck.\n" +
        "\n⚠️  Erst pruefen, ob schon ein Obsidian laeuft — ein Quit zerstoert den Zustand\n" +
        "    einer fremden Session, und der eigene Lauf ist danach trotzdem gruen:\n" +
        "      lsof -nP -iTCP:9222 -sTCP:LISTEN\n" +
        "    Hoert der Port, haengt jemand dran: erst fragen, dann quitten.\n" +
        "\nObsidian mit offenem Debug-Port starten und diesen Vault oeffnen:\n" +
        "  osascript -e 'quit app \"Obsidian\"'\n" +
        "  open -a Obsidian --args --remote-debugging-port=9222\n" +
        "Beim ersten Mal fragt Obsidian, ob es dem Vault-Autor vertraut — bestaetigen,\n" +
        "sonst laeuft das Plugin nicht und jedes Bild zeigt ein leeres Blatt.",
    );
    return;
  }

  const port = Number(flag("--port") ?? env.SHOTS_PORT ?? 9222);
  // `--only` nimmt eine Komma-Liste. Ein einzelner Name ist der haeufige Fall; die Liste
  // braucht man, um alles AUSSER `first-run.png` zu fahren — das raeumt sonst das Modell
  // weg und der Lauf laedt 2,5 GB neu, nur um dieselben Bilder zu bekommen.
  const nurListe = (flag("--only") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const nimmt = (name: string): boolean => nurListe.length === 0 || nurListe.includes(name);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const cdp = await attachTo("workspace", port, REPO_NAME);
  if (!cdp) {
    throw new Error(
      `Kein Obsidian-Fenster mit dem Vault "${REPO_NAME}" auf Port ${port}.\n` +
        "Den Aufnahme-Vault oeffnen (er darf neben anderen Vaults offen sein):\n" +
        `  open -a Obsidian "$STAGING_VAULTS_DIR/${REPO_NAME}"`,
    );
  }
  console.log(`Verbunden auf Port ${port}.`);
  await cdp.send("Page.bringToFront");
  await new Promise((r) => setTimeout(r, 3000));
  await setWindowSize(cdp, FENSTER_BREITE, FENSTER_HOEHE);

  // Den Prueflig HERSTELLEN, nicht annehmen: `npm run deploy` kopiert Dateien, Obsidian
  // laedt sie nicht nach. Ohne diesen Neustart bebildert der Lauf den Stand, der beim
  // letzten Start des Fensters im Speicher landete — und meldet dabei Erfolg, weil der
  // Treiber nur den Vault kennt, nicht den Arbeitsbaum. Die Manifest-Version verraet den
  // Unterschied nicht: sie aendert sich zwischen zwei Bauten desselben Standes nicht.
  // Genau hier faellt es am haerteste auf, weil Bilder das Ergebnis ueberdauern —
  // ein falsch bebildertes README steht auf GitHub, Forgejo und der Store-Seite.
  // (`scripts/gui-smoke.ts` traegt denselben Block seit 2026-08-21, aus demselben Anlass.)
  const version = await cdp.evaluate<string | null>(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    return p ? p.manifest.version : null;
  `);
  if (version === null) throw new Error(`Plugin ${PLUGIN_ID} ist nicht aktiv. Erst \`npm run deploy\`.`);
  await cdp.evaluate(`
    await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
    await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
    return true;
  `);
  for (let i = 0; i < 30; i++) {
    const da = await cdp.evaluate<boolean>(`return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.settings;`);
    if (da) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  // Nach dem Reload steht die Engine erst auf `gpu-checking` und findet den gefuellten Cache
  // asynchron. Wer sie in diesem Moment fragt, bekommt „nicht bereit" — und die Sparlogik von
  // `first-run.png` wirft daraufhin 2,5 GB weg, die schon da waren. Gemessen 2026-08-21: genau
  // das passierte im zweiten Volllauf. Also den Uebergangszustand abwarten, bevor irgendwer
  // eine Entscheidung darauf stuetzt.
  for (let i = 0; i < 40; i++) {
    const kind = await cdp.evaluate<string>(`
      return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.state?.engine?.kind ?? "";
    `);
    if (kind !== "" && kind !== "gpu-checking") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`Plugin ${version} neu geladen — aufgenommen wird der deployte Stand.\n`);

  let ok = 0;
  let fehlend = 0;
  for (const shot of SHOTS) {
    if (!nimmt(shot.name)) continue;
    try {
      const grund = nurListe.includes(shot.name) ? null : await shot.ueberspringen?.(cdp, outDir);
      if (grund !== null && grund !== undefined) {
        console.log(`  – ${shot.name} — uebersprungen: ${grund}`);
        continue;
      }
      const box = await shot.run(cdp, nurListe.includes(shot.name));
      const png = box ? await capture(cdp, box) : null;
      if (!png) {
        console.log(`  ✗ ${shot.name} — Zustand kam nicht zustande`);
        fehlend++;
        continue;
      }
      console.log(
        `  ✓ ${await writeShot(cdp, shot.name, png, {
          outDir,
          captureWidth: CAPTURE_WIDTH,
          thumbWidth: THUMB_WIDTH,
          thumb: shot.klasse === "detail",
        })}`,
      );
      ok++;
    } catch (err) {
      console.log(`  ✗ ${shot.name} — ${(err as Error).message}`);
      fehlend++;
    }
  }
  cdp.close();

  // Die beiden Einstellungs-Bilder laufen in dieser Reihenfolge: `settings-server.png`
  // stellt den builtin-Zustand danach wieder her, umgekehrt bliebe der Server-Modus stehen.
  for (const modus of ["builtin", "server"] as const) {
    const name = modus === "server" ? "settings-server.png" : "settings.png";
    if (!nimmt(name)) continue;
    try {
      console.log(`  · ${await settingsBild(port, outDir, modus)}`);
      ok++;
    } catch (err) {
      console.log(`  ✗ ${name} — ${(err as Error).message}`);
      fehlend++;
    }
  }

  console.log(`\n${ok} Bild(er) geschrieben, ${fehlend} offen.`);
  if (fehlend) exit(1);
}

main().catch((err: Error) => {
  console.error(err.message);
  exit(1);
});
