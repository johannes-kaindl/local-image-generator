#!/usr/bin/env node
// Vault-Abgleich: bringt local-image-generator in allen Vaults des Maintainers auf die Referenz-Config
// (comfy/reference-config.json) und die Referenz-Workflows (comfy/workflows/).
//
//   node tools/vault-abgleich.mjs [--dry] [--vault <name>] [--offene] [--root <dir>]
//
// Was es tut, je Vault mit installiertem Plugin (<root>/<vault>/.obsidian/plugins/local-image-generator/data.json):
//   1. setzt genau die Schluessel unter `settings` der Referenz; alle anderen (history, presets, playgroundShortcutName, ...)
//      bleiben als JSON-Teilbaum unveraendert stehen,
//   2. kopiert die Referenz-Workflows in den Workflow-Ordner des Vaults (legt ihn an, ueberschreibt nur Dateien mit dem
//      Namen einer Referenz-Datei, eigene Dateien bleiben),
//   3. verschiebt Dateien aus `retire` in den Papierkorb des Vaults (<vault>/.trash/, Obsidians Papierkorb),
//   4. traegt im LLM Endpoint Manager den Bild-Endpunkt der Referenz nach, wenn er dort fehlt (Quelle: der Manager des
//      Vaults `endpointManager.sourceVault`); sonst bleibt dessen data.json byte-gleich.
// Ein Vault, der laut obsidian.json gerade offen ist, wird ohne --offene uebersprungen: das laufende Plugin schreibt seine
// data.json beim naechsten Speichern zurueck. Mit --offene wird geschrieben, danach muss das Plugin neu geladen werden.
// --dry zeigt jede Aenderung und schreibt nichts. Exit 0: alles abgeglichen; 1: mindestens ein Vault uebersprungen oder
// fehlerhaft; 2: Aufruf- oder Konfigurationsfehler.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ID = "local-image-generator";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
// Obsidian schreibt data.json mit zwei Leerzeichen Einrueckung; derselbe Stil haelt den Diff klein.
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Pfade der Vaults, die Obsidian (Hauptinstanz) gerade offen hat. Fehlt die Datei, gilt keiner als offen. */
function offeneVaults(obsidianJson) {
  if (!existsSync(obsidianJson)) return new Set();
  try {
    const vaults = readJson(obsidianJson).vaults ?? {};
    return new Set(Object.values(vaults).filter((v) => v?.open === true).map((v) => resolve(v.path)));
  } catch {
    return new Set();
  }
}

/** Freier Name im Papierkorb: `name`, sonst `stamm 2.ext`, `stamm 3.ext`, ... (wie Obsidian beim Verschieben). */
function freierPapierkorbName(trash, name) {
  if (!existsSync(join(trash, name))) return name;
  const dot = name.indexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  for (let n = 2; ; n++) if (!existsSync(join(trash, `${stem} ${n}${ext}`))) return `${stem} ${n}${ext}`;
}

/**
 * Der Abgleich als Funktion (fuer den Test); die CLI unten ist nur Argument-Lesen und Ausgabe.
 * @returns {{ vaults: { name: string, version: string | null, skipped: string | null, changes: string[] }[], exitCode: number }}
 */
export function abgleich({ root, repoDir, obsidianJson, dry, offene, vault = null, log = console.log }) {
  const config = readJson(join(repoDir, "comfy", "reference-config.json"));
  const workflowsDir = join(repoDir, config.workflowsDir);
  const workflows = readdirSync(workflowsDir).filter((f) => f.endsWith(".json")).sort();
  const open = offeneVaults(obsidianJson);
  const mgr = config.endpointManager;
  const sourceManager = join(root, mgr.sourceVault, ".obsidian", "plugins", mgr.pluginId, "data.json");
  const sourceEndpoint = existsSync(sourceManager)
    ? (readJson(sourceManager).endpoints ?? []).find((e) => e?.id === mgr.endpointId) ?? null
    : null;

  const namen = readdirSync(root)
    .filter((n) => existsSync(join(root, n, ".obsidian", "plugins", PLUGIN_ID, "data.json")))
    .filter((n) => vault === null || n === vault)
    .sort();
  const vaults = [];
  let exitCode = 0;

  for (const name of namen) {
    const vdir = join(root, name);
    const pdir = join(vdir, ".obsidian", "plugins", PLUGIN_ID);
    const manifest = join(pdir, "manifest.json");
    const version = existsSync(manifest) ? (readJson(manifest).version ?? null) : null;
    const entry = { name, version, skipped: null, changes: [] };
    vaults.push(entry);
    if (open.has(resolve(vdir)) && !offene) {
      entry.skipped = "offen";
      exitCode = 1;
      log(`${name} (${version ?? "?"}): übersprungen — in Obsidian offen (mit --offene schreiben, danach Plugin neu laden)`);
      continue;
    }
    try {
      // 1. Einstellungen
      const dataPath = join(pdir, "data.json");
      const data = readJson(dataPath);
      const next = { ...data };
      for (const [k, v] of Object.entries(config.settings)) {
        if (!same(data[k], v)) {
          entry.changes.push(`${k}: ${JSON.stringify(data[k] ?? null)} → ${JSON.stringify(v)}`);
          next[k] = v;
        }
      }
      if (!dry && !same(data, next)) writeJson(dataPath, next);

      // 2. Workflows
      const wdir = join(vdir, config.settings.comfyWorkflowFolder);
      for (const f of workflows) {
        const want = readFileSync(join(workflowsDir, f), "utf8");
        const target = join(wdir, f);
        const have = existsSync(target) ? readFileSync(target, "utf8") : null;
        if (have === want) continue;
        entry.changes.push(`${have === null ? "neu" : "aktualisiert"}: ${config.settings.comfyWorkflowFolder}/${f}`);
        if (!dry) {
          mkdirSync(wdir, { recursive: true });
          writeFileSync(target, want);
        }
      }

      // 3. Altdateien in den Papierkorb
      for (const f of config.retire) {
        const p = join(wdir, f);
        if (!existsSync(p) || !statSync(p).isFile()) continue;
        const trash = join(vdir, ".trash");
        const ziel = freierPapierkorbName(trash, f);
        entry.changes.push(`Papierkorb: ${config.settings.comfyWorkflowFolder}/${f} → .trash/${ziel}`);
        if (!dry) {
          mkdirSync(trash, { recursive: true });
          renameSync(p, join(trash, ziel));
        }
      }

      // 4. Endpoint Manager
      const mpath = join(vdir, ".obsidian", "plugins", mgr.pluginId, "data.json");
      if (existsSync(mpath)) {
        const m = readJson(mpath);
        const eps = Array.isArray(m.endpoints) ? m.endpoints : [];
        if (!eps.some((e) => e?.id === mgr.endpointId)) {
          if (sourceEndpoint === null) {
            entry.changes.push(`Endpoint Manager: Eintrag ${mgr.endpointId} fehlt, Quelle ${mgr.sourceVault} hat ihn nicht — nichts eingetragen`);
            exitCode = 1;
          } else {
            entry.changes.push(`Endpoint Manager: Eintrag ${mgr.endpointId} (${sourceEndpoint.url}) nachgetragen`);
            if (!dry) writeJson(mpath, { ...m, endpoints: [...eps, sourceEndpoint] });
          }
        }
      }

      log(`${name} (${version ?? "?"}): ${entry.changes.length === 0 ? "schon abgeglichen" : `${entry.changes.length} Änderung(en)${dry ? " (--dry, nicht geschrieben)" : ""}`}`);
      for (const c of entry.changes) log(`  · ${c}`);
    } catch (e) {
      entry.skipped = `Fehler: ${e instanceof Error ? e.message : String(e)}`;
      exitCode = 1;
      log(`${name}: ${entry.skipped}`);
    }
  }
  return { vaults, exitCode };
}

// --- CLI ------------------------------------------------------------------------------------------------------------
const istDirekt = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (istDirekt) {
  const args = process.argv.slice(2);
  const flag = (n) => {
    const i = args.indexOf(`--${n}`);
    return i === -1 ? null : (args[i + 1] ?? null);
  };
  const bekannt = new Set(["--dry", "--offene", "--vault", "--root"]);
  const unbekannt = args.filter((a, i) => a.startsWith("--") && !bekannt.has(a) && !["--vault", "--root"].includes(args[i - 1] ?? ""));
  if (unbekannt.length > 0) {
    console.error(`unbekannte Argumente: ${unbekannt.join(" ")}`);
    process.exit(2);
  }
  const repoDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const r = abgleich({
    root: flag("root") ?? join(homedir(), "Documents"),
    repoDir,
    obsidianJson: join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json"),
    dry: args.includes("--dry"),
    offene: args.includes("--offene"),
    vault: flag("vault"),
  });
  const n = r.vaults.length;
  const ueber = r.vaults.filter((v) => v.skipped !== null).length;
  console.log(`\n${n} Vault(s), ${ueber} übersprungen${args.includes("--dry") ? ", --dry: nichts geschrieben" : ""}`);
  process.exit(r.exitCode);
}
