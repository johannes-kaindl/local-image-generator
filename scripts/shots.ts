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
 * ## Was dieser Treiber NICHT aufnimmt
 *
 * Die drei Motive, die ein **erzeugtes Bild** zeigen (`hero.png`, `history.png`,
 * `result-note.png`), haben hier bewusst kein Rezept. Sie brauchen einen laufenden
 * A1111-kompatiblen Bild-Server, und ein Rezept, das nie gelaufen ist, ist eine
 * Behauptung: es saehe im Repo wie eine Faehigkeit aus und waere ungeprueft. Sie stehen
 * im Vertrag unter „Offen" — `npm run shots:check` meldet sie bei jedem Lauf, bis sie
 * jemand mit laufendem Server nachzieht. Dann entstehen sie hier als drei weitere
 * Eintraege in SHOTS.
 *
 * ## Was ohne Server im Bild anders aussieht
 *
 * `generateEnabled` verlangt `server.kind === "ok"` (src/core/viewmodel.ts) — ohne
 * erreichbaren Server ist der „Generate"-Knopf ausgegraut, und das ist richtig so. Der
 * Zustand wird NICHT vorgetaeuscht: ein Bild, das eine Verbindung zeigt, die es nicht
 * gab, dokumentiert den eigenen Eingriff statt des Produkts.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, env, exit } from "node:process";

import { Cdp, attachTo } from "../../tools/obsidian-cdp/cdp.js";
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
  run(cdp: Cdp): Promise<Rect | null>;
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
      const tab = [...document.querySelectorAll(".lig-hub-tab")]
        .find((t) => t.textContent.trim().includes(${JSON.stringify(reiter)}));
      if (tab) { tab.click(); await new Promise((r) => setTimeout(r, 400)); }
      // Obsidians Statusleiste schwebt ueber der rechten Sidebar und klebt sonst als
      // fremdes Symbol in jeder Panel-Aufnahme. Sie gehoert dem Wirt, nicht dem Plugin.
      if (!document.getElementById("lig-shots-style")) {
        const s = document.createElement("style");
        s.id = "lig-shots-style";
        s.textContent = ".status-bar { display: none !important; }";
        document.head.appendChild(s);
      }
      const panel = document.querySelector(".lig-panel, .lig-hub-root");
      return !!panel && panel.getBoundingClientRect().width > 1;
    `),
  );
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

const SHOTS: Shot[] = [
  {
    name: "generate-panel.png",
    klasse: "detail",
    async run(cdp) {
      if (!(await hubOeffnen(cdp, "Generate"))) return null;
      return panelBox(cdp, ".lig-panel");
    },
  },
  {
    name: "style-chips.png",
    klasse: "detail",
    async run(cdp) {
      if (!(await hubOeffnen(cdp, "Generate"))) return null;
      // Nur die Stil-Leiste. `boxAround` nimmt die Vereinigung mehrerer Elemente — die
      // Beschriftung „Styles" steht als eigenes Span neben den Chips.
      return boxAround(cdp, [".lig-chips"], PADDING);
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
async function settingsBild(port: number, outDir: string): Promise<string> {
  const haupt = await attachTo("workspace", port, REPO_NAME);
  if (!haupt) return "settings.png — kein Hauptfenster";
  await haupt.evaluate(`
    app.setting.open();
    app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  `);
  haupt.close();

  const fenster = (await attachTo("settings", port)) ?? (await attachTo("workspace", port, REPO_NAME));
  if (!fenster) return "settings.png — kein Einstellungen-Fenster";
  try {
    await fenster.send("Page.bringToFront");
    await new Promise((r) => setTimeout(r, 600));

    // Den Legacy-Aufraeumer ausblenden. Er ist KEIN Produktmerkmal, sondern ein Rest
    // dieser Installation: `visible: () => this.legacyCache === true` zeigt ihn nur, wenn
    // im app-weiten Cache noch SD-Turbo-Gewichte aus der Zeit vor 0.5 liegen. Auf dem
    // Rechner des Maintainers ist das so, in einer frischen Installation nie — ohne diesen
    // Eingriff dokumentierte das Bild also die Aufnahme-Umgebung statt des Produkts.
    // (Der Weg ueber die echte Quelle waere, die 2,5 GB zu loeschen; das ist eine
    // Entscheidung des Maintainers, nicht die eines Aufnahme-Laufs.)
    await fenster.evaluate(`
      const zeilen = [...document.querySelectorAll(".setting-item")];
      for (const z of zeilen) {
        if (z.textContent.includes("SD-Turbo")) z.style.display = "none";
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
    if (!masse) return "settings.png — Einstellungen-Inhalt nicht gefunden";

    return await withMetrics(fenster, FENSTER_BREITE, masse.hoehe + 120, async () => {
      await new Promise((r) => setTimeout(r, 900));
      const box = await fenster.evaluate<Rect | null>(`
        const inhalt = document.querySelector(".vertical-tab-content.is-active, .vertical-tab-content");
        if (!inhalt) return null;
        const kinder = [...inhalt.children].filter((k) => k.getBoundingClientRect().height > 0);
        const letztes = kinder[kinder.length - 1];
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
      if (!box) return "settings.png — Einstellungen-Inhalt nicht gefunden";
      const png = await capture(fenster, box);
      return await writeShot(fenster, "settings.png", png, {
        outDir,
        captureWidth: CAPTURE_WIDTH,
        thumbWidth: THUMB_WIDTH,
        thumb: true,
      });
    });
  } finally {
    await fenster.evaluate("app.setting?.close?.(); return true;").catch(() => undefined);
    fenster.close();
  }
}

async function main(): Promise<void> {
  const repoRoot = cwd();
  const outDir = join(repoRoot, OUT_DIR);

  if (argv.includes("--list")) {
    for (const s of SHOTS) console.log(`  ${s.klasse.padEnd(8)} ${s.name}`);
    console.log("  detail   settings.png");
    console.log("\n  offen (brauchen einen laufenden Bild-Server, siehe docs/images/README.md):");
    for (const n of ["hero.png", "history.png", "result-note.png"]) console.log(`    ${n}`);
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
        "\nObsidian mit offenem Debug-Port starten und diesen Vault oeffnen:\n" +
        "  osascript -e 'quit app \"Obsidian\"'\n" +
        "  open -a Obsidian --args --remote-debugging-port=9222\n" +
        "Beim ersten Mal fragt Obsidian, ob es dem Vault-Autor vertraut — bestaetigen,\n" +
        "sonst laeuft das Plugin nicht und jedes Bild zeigt ein leeres Blatt.",
    );
    return;
  }

  const port = Number(flag("--port") ?? env.SHOTS_PORT ?? 9222);
  const nur = flag("--only");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const cdp = await attachTo("workspace", port, REPO_NAME);
  if (!cdp) {
    throw new Error(
      `Kein Obsidian-Fenster mit dem Vault "${REPO_NAME}" auf Port ${port}.\n` +
        "Den Aufnahme-Vault oeffnen (er darf neben anderen Vaults offen sein):\n" +
        `  open -a Obsidian "$STAGING_VAULTS_DIR/${REPO_NAME}"`,
    );
  }
  console.log(`Verbunden auf Port ${port}.\n`);
  await cdp.send("Page.bringToFront");
  await new Promise((r) => setTimeout(r, 3000));
  await setWindowSize(cdp, FENSTER_BREITE, FENSTER_HOEHE);

  let ok = 0;
  let fehlend = 0;
  for (const shot of SHOTS) {
    if (nur && shot.name !== nur) continue;
    try {
      const box = await shot.run(cdp);
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

  if (!nur || nur === "settings.png") {
    try {
      console.log(`  · ${await settingsBild(port, outDir)}`);
      ok++;
    } catch (err) {
      console.log(`  ✗ settings.png — ${(err as Error).message}`);
      fehlend++;
    }
  }

  console.log(`\n${ok} Bild(er) geschrieben, ${fehlend} offen.`);
  console.log(
    "Nicht aufgenommen (brauchen einen laufenden Bild-Server): hero.png, history.png,\n" +
      "result-note.png — siehe docs/images/README.md § Offen.",
  );
  if (fehlend) exit(1);
}

main().catch((err: Error) => {
  console.error(err.message);
  exit(1);
});
