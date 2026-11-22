// Vault-Probe: prueft je Vault, ob local-image-generator mit seiner eingetragenen Config am ComfyUI-Dienst rechnen kann,
// und rechnet auf Wunsch ein kleines Testbild — mit dem Core-Code des Repos (classifyWorkflow, Bibliothek, ComfyClient),
// ohne dass der Vault in Obsidian offen sein muss.
//
//   npm run vault:probe -- [--vault <name>] [--root <dir>] [--ohne-bild] [--out <dir>]
//
// Je Vault: Endpunkt aufgeloest wie das Plugin (aktiver LLM Endpoint Manager: die gewaehlte endpointId, sonst der erste
// eingeschaltete Eintrag mit Capability image; ohne Manager das Feld endpoint) — eine Nachbildung, der Manager selbst
// laeuft hier nicht —, Workflow-Ordner da, Rolle je Datei, /system_stats erreichbar. Ohne --ohne-bild dazu ein Lauf mit
// dem aktiven Erzeugen-Workflow bei 512×512 und 4 Steps; der Seed ist je Vault verschieden, sonst beantwortet ComfyUI den
// zweiten identischen Graphen aus seinem Cache, und die Messung saehe einen Lauf, der nie stattfand. Ergebnis nach
// <out>/<vault>.png (Standard ~/tmp/lig-comfy-ausbau/probe).
// Vor Bildlaeufen am geteilten Dienst die Slot-Regel des Betreibers einhalten (free, Swap, load) — das prueft das Skript
// nicht selbst.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { libraryFrom, activeEntry } from "../src/core/comfy/library";
import { ComfyClient, type ComfyTransport } from "../src/core/comfy/client";
import { workflowProblemText } from "../src/core/viewmodel";
import { registerI18n } from "../src/i18n/strings";
import { setLang } from "../src/vendor/kit/i18n";
import { DEFAULT_SETTINGS, migrateSettings } from "../src/core/settings";
import { mergeSettings } from "../src/vendor/kit/settings";

const PLUGIN_ID = "local-image-generator";
const MANAGER_ID = "llm-endpoint-manager";

const args = process.argv.slice(2);
const flag = (n: string): string | null => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const root = flag("root") ?? join(homedir(), "Documents");
const out = flag("out") ?? join(homedir(), "tmp", "lig-comfy-ausbau", "probe");
const nurVault = flag("vault");
const mitBild = !args.includes("--ohne-bild");

registerI18n();
setLang("de");

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));

interface ManagerEndpoint { id?: string; url?: string; capabilities?: string[]; enabled?: boolean }

function endpointOf(vdir: string, s: typeof DEFAULT_SETTINGS): { url: string | null; quelle: string } {
  const plugins = join(vdir, ".obsidian", "community-plugins.json");
  const aktiv = existsSync(plugins) && (readJson(plugins) as string[]).includes(MANAGER_ID);
  const mpath = join(vdir, ".obsidian", "plugins", MANAGER_ID, "data.json");
  if (!aktiv || !existsSync(mpath)) return { url: s.endpoint.trim() || null, quelle: "Feld endpoint (kein aktiver Manager)" };
  const eps = ((readJson(mpath) as { endpoints?: ManagerEndpoint[] }).endpoints ?? []).filter((e) => e.enabled !== false);
  const id = s.comfyEndpointChoice.endpointId;
  const ep = id !== undefined ? eps.find((e) => e.id === id) : eps.find((e) => e.capabilities?.includes("image"));
  return ep?.url ? { url: ep.url, quelle: `Manager ${id !== undefined ? `endpointId ${id}` : "automatisch"}` } : { url: null, quelle: "Manager ohne passenden Eintrag" };
}

/** Transport ueber fetch (Node) — dieselbe Form wie comfyTransport() im Plugin, ohne Obsidian. */
function nodeTransport(): ComfyTransport {
  const json = async (r: Response): Promise<unknown> => r.json().catch(() => undefined);
  return {
    postJson: async (url, body) => {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, json: await json(r) };
    },
    getJson: async (url) => {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      return { status: r.status, json: await json(r) };
    },
    getBase64: async (url) => {
      const r = await fetch(url);
      return { status: r.status, base64: r.status === 200 ? Buffer.from(await r.arrayBuffer()).toString("base64") : "" };
    },
    postBytes: async (url, body, contentType) => {
      const r = await fetch(url, { method: "POST", headers: { "content-type": contentType }, body: body.slice().buffer as ArrayBuffer });
      return { status: r.status, json: await json(r) };
    },
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    now: () => Date.now(),
  };
}

async function main(): Promise<number> {
  const namen = readdirSync(root)
    .filter((n) => existsSync(join(root, n, ".obsidian", "plugins", PLUGIN_ID, "data.json")))
    .filter((n) => nurVault === null || n === nurVault)
    .sort();
  let rot = 0;
  let seed = 41_000;
  for (const name of namen) {
    const vdir = join(root, name);
    const raw = readJson(join(vdir, ".obsidian", "plugins", PLUGIN_ID, "data.json"));
    // Dieselbe Migration und dieselben Defaults wie beim Laden im Plugin; ein alter Stand mit comfyWorkflowPath bekommt
    // so seinen Ordner, wie ihn der neue Plugin-Stand saehe.
    const s = mergeSettings(DEFAULT_SETTINGS, migrateSettings(raw) as Partial<typeof DEFAULT_SETTINGS>);
    const befunde: string[] = [];
    if (s.engine !== "comfy") befunde.push(`engine ${s.engine}`);
    const ep = endpointOf(vdir, s);
    if (ep.url === null) befunde.push(`kein Endpunkt (${ep.quelle})`);
    const folder = s.comfyWorkflowFolder.trim();
    const fdir = join(vdir, folder);
    const files = folder !== "" && existsSync(fdir)
      ? readdirSync(fdir).filter((f) => f.endsWith(".json")).map((f) => ({ path: `${folder}/${f}`, raw: readFileSync(join(fdir, f), "utf8") }))
      : null;
    const lib = libraryFrom(folder, files);
    if (lib.kind !== "ok") befunde.push(lib.kind === "missing" ? `Ordner fehlt: ${folder}` : "kein Ordner");
    const rollen = lib.kind === "ok"
      ? lib.entries.map((e) => `${e.file}=${e.classified.role ?? `abgewiesen (${workflowProblemText(e.classified.error)})`}`)
      : [];
    const txt = activeEntry(lib, "txt2img", s.comfyWorkflowSelection.txt2img);
    if (txt === null) befunde.push("kein gültiger Erzeugen-Workflow");
    let erreichbar = false;
    if (ep.url !== null) {
      erreichbar = await fetch(`${ep.url.replace(/\/+$/, "")}/system_stats`, { signal: AbortSignal.timeout(3000) })
        .then((r) => r.status === 200).catch(() => false);
      if (!erreichbar) befunde.push(`${ep.url} antwortet nicht`);
    }
    let bild = "";
    if (mitBild && befunde.length === 0 && txt !== null && ep.url !== null) {
      seed += 1;
      const t0 = Date.now();
      try {
        const b64 = await new ComfyClient(ep.url, txt.json, nodeTransport(), { timeoutMs: 600_000 }).generate({
          prompt: "a small lighthouse on a rocky coast at dusk", negativePrompt: "", seed, steps: 4, cfg: null,
          width: 512, height: 512, initImageData: null, denoising: null,
        });
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, `${name}.png`), Buffer.from(b64, "base64"));
        bild = ` · Testbild ${join(out, `${name}.png`)} (${Math.round((Date.now() - t0) / 1000)} s, Seed ${seed}, ${txt.file})`;
      } catch (e) {
        befunde.push(`Lauf: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const ok = befunde.length === 0;
    if (!ok) rot += 1;
    console.log(`${ok ? "✓" : "✗"} ${name}: ${ok ? "bereit" : befunde.join(" · ")} · Endpunkt ${ep.url ?? "–"} (${ep.quelle})${bild}`);
    if (rollen.length > 0) console.log(`    ${rollen.join(", ")}`);
  }
  console.log(`\n${namen.length} Vault(s), ${rot} nicht bereit${mitBild ? "" : " (--ohne-bild)"}`);
  return rot === 0 ? 0 : 1;
}

main().then((c) => process.exit(c), (e) => {
  console.error(e);
  process.exit(2);
});
