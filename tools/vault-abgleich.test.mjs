// node --test tools/vault-abgleich.test.mjs — gegen ein Wegwerf-Wurzelverzeichnis, nie gegen echte Vaults.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { abgleich } from "./vault-abgleich.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = JSON.parse(readFileSync(join(REPO, "comfy", "reference-config.json"), "utf8"));
const EP_ID = CONFIG.endpointManager.endpointId;
const FOLDER = CONFIG.settings.comfyWorkflowFolder;
const COMFY_EP = { id: EP_ID, label: "ComfyUI", url: "http://macbookm5.fritz.box:8000", provider: "comfy", capabilities: ["image"], enabled: true };

const write = (p, text) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};
const writeJson = (p, v) => write(p, JSON.stringify(v, null, 2));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const hashTree = (dir) => {
  const h = createHash("sha256");
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(p).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex");
};

/** Drei Vaults: A (playground, mit Altdateien), B (ohne Manager-Endpunkt fuer Bilder), C (offen laut obsidian.json). */
function baue() {
  const root = mkdtempSync(join(tmpdir(), "lig-abgleich-"));
  const plugin = (v) => join(root, v, ".obsidian", "plugins", "local-image-generator");
  const manager = (v) => join(root, v, ".obsidian", "plugins", "llm-endpoint-manager", "data.json");
  writeJson(join(plugin("Pallas"), "data.json"), { engine: "comfy", endpoint: "http://macbookm5.fritz.box:8000", history: [], presets: [] });
  writeJson(join(plugin("Pallas"), "manifest.json"), { version: "0.22.1" });
  writeJson(manager("Pallas"), { version: 1, endpoints: [COMFY_EP] });
  writeJson(join(plugin("A"), "data.json"), {
    engine: "playground", endpoint: "http://x", history: [{ prompt: "p", seed: 1 }], presets: [{ id: "a", label: "A", suffix: "s" }],
    playgroundShortcutName: "Mein Kurzbefehl", comfyWorkflowPath: "alt/sdxl-base-txt2img.api.json",
  });
  writeJson(join(plugin("A"), "manifest.json"), { version: "0.21.2" });
  write(join(root, "A", FOLDER, "sdxl-base-txt2img.api.json"), "{}");
  write(join(root, "A", FOLDER, "z-image-turbo-txt2img.api.json"), "{}");
  write(join(root, "A", FOLDER, "eigener.api.json"), '{"mein":1}');
  writeJson(manager("A"), { version: 1, endpoints: [COMFY_EP] });
  writeJson(join(plugin("B"), "data.json"), { engine: "comfy", endpoint: "http://127.0.0.1:7861" });
  writeJson(join(plugin("B"), "manifest.json"), { version: "0.22.0" });
  writeJson(manager("B"), { version: 1, endpoints: [{ id: "other", label: "ComfyUI", url: "http://h:8000", provider: "comfy", capabilities: ["chat"], enabled: true }] });
  writeJson(join(plugin("C"), "data.json"), { engine: "playground" });
  writeJson(join(plugin("C"), "manifest.json"), { version: "0.22.1" });
  mkdirSync(join(root, "OhnePlugin", ".obsidian"), { recursive: true });
  const obsidianJson = join(root, "obsidian.json");
  writeJson(obsidianJson, { vaults: { c: { path: join(root, "C"), open: true }, a: { path: join(root, "A") } } });
  return { root, plugin, manager, obsidianJson };
}

const run = (b, extra = {}) => abgleich({ root: b.root, repoDir: REPO, obsidianJson: b.obsidianJson, dry: false, offene: false, log: () => {}, ...extra });

test("--dry schreibt nichts", () => {
  const b = baue();
  const vorher = hashTree(b.root);
  const r = run(b, { dry: true });
  assert.equal(hashTree(b.root), vorher);
  assert.ok(r.vaults.some((v) => v.name === "A" && v.changes.length > 0));
});

test("setzt genau die Referenz-Schluessel und laesst history, presets und Kurzbefehl byte-gleich", () => {
  const b = baue();
  const alt = readJson(join(b.plugin("A"), "data.json"));
  run(b);
  const neu = readJson(join(b.plugin("A"), "data.json"));
  for (const [k, v] of Object.entries(CONFIG.settings)) assert.deepEqual(neu[k], v, k);
  assert.equal(JSON.stringify(neu.history), JSON.stringify(alt.history));
  assert.equal(JSON.stringify(neu.presets), JSON.stringify(alt.presets));
  assert.equal(neu.playgroundShortcutName, "Mein Kurzbefehl");
  const sonst = Object.keys(neu).filter((k) => !(k in CONFIG.settings));
  assert.deepEqual(sonst.sort(), ["history", "playgroundShortcutName", "presets"]);
});

test("kopiert die Workflows, laesst eigene Dateien stehen, Altdateien in den Papierkorb", () => {
  const b = baue();
  run(b);
  const dir = join(b.root, "A", FOLDER);
  for (const f of readdirSync(join(REPO, CONFIG.workflowsDir)).filter((f) => f.endsWith(".json"))) {
    assert.equal(readFileSync(join(dir, f), "utf8"), readFileSync(join(REPO, CONFIG.workflowsDir, f), "utf8"), f);
  }
  assert.equal(readFileSync(join(dir, "eigener.api.json"), "utf8"), '{"mein":1}');
  assert.equal(existsSync(join(dir, "sdxl-base-txt2img.api.json")), false);
  assert.equal(existsSync(join(b.root, "A", ".trash", "sdxl-base-txt2img.api.json")), true);
  assert.equal(existsSync(join(b.root, "A", ".trash", "z-image-turbo-txt2img.api.json")), true);
  // ein Ordner, der fehlte, wird angelegt
  assert.equal(existsSync(join(b.root, "B", FOLDER, "flux3-klein.api.json")), true);
});

test("ein offener Vault wird ohne --offene uebersprungen, mit --offene geschrieben", () => {
  const b = baue();
  const vorher = readFileSync(join(b.plugin("C"), "data.json"), "utf8");
  const r = run(b);
  assert.equal(readFileSync(join(b.plugin("C"), "data.json"), "utf8"), vorher);
  assert.equal(r.vaults.find((v) => v.name === "C").skipped, "offen");
  assert.equal(r.exitCode, 1);
  const r2 = run(b, { offene: true });
  assert.equal(readJson(join(b.plugin("C"), "data.json")).engine, "comfy");
  assert.equal(r2.exitCode, 0);
});

test("ein Manager ohne Bild-Endpunkt bekommt genau den Eintrag der Quelle, sonst bleibt seine Datei byte-gleich", () => {
  const b = baue();
  const aVorher = readFileSync(b.manager("A"), "utf8");
  run(b);
  assert.equal(readFileSync(b.manager("A"), "utf8"), aVorher);
  const mb = readJson(b.manager("B"));
  assert.equal(mb.endpoints.length, 2);
  assert.deepEqual(mb.endpoints[0], { id: "other", label: "ComfyUI", url: "http://h:8000", provider: "comfy", capabilities: ["chat"], enabled: true });
  assert.deepEqual(mb.endpoints[1], COMFY_EP);
  assert.equal(mb.version, 1);
});

test("ein zweiter Lauf aendert nichts mehr", () => {
  const b = baue();
  run(b, { offene: true });
  const vorher = hashTree(b.root);
  const r = run(b, { offene: true });
  assert.equal(hashTree(b.root), vorher);
  assert.ok(r.vaults.every((v) => v.changes.length === 0));
});

test("--vault waehlt einen Vault, ein Vault ohne Plugin wird nicht angefasst", () => {
  const b = baue();
  const r = run(b, { vault: "B" });
  assert.deepEqual(r.vaults.map((v) => v.name), ["B"]);
  assert.equal(existsSync(join(b.root, "OhnePlugin", ".obsidian", "plugins")), false);
});
