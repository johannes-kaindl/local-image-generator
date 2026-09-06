// ComfyUI-Mock fuer den GUI-Smoke ohne echten ComfyUI-Server (analog scripts/mock-a1111.mjs,
// aber eine EIGENE Datei — s. AGENTS.md: mock-a1111.mjs hat seit 2026-09-02 einen fremden
// Konsumenten (epub-exporter), diese Datei hat keinen und darf frei geformt werden).
//
// Kennt die vier Endpunkte, die ComfyClient (src/core/comfy/client.ts) nutzt:
//   GET  /system_stats     -> 200 { system: {} }                      (Verbindungstest)
//   POST /prompt           -> { prompt_id: "p1" }                     (Workflow einreichen)
//   GET  /history/p1       -> beim ERSTEN Aufruf NACH einem /prompt {} (noch am Rechnen),
//                              danach der Erfolgs-Eintrag mit einem images-Verweis
//   GET  /view             -> ein 1x1-PNG als rohe Bytes (kein JSON/Base64 — ComfyClient holt
//                              es per requestUrl().arrayBuffer und base64-kodiert selbst)
//
// Zaehler UND der zuletzt empfangene Graph landen in .mock-comfy-counts.json — an `graph`
// misst Smoke-Punkt 38, ob die vom Server EMPFANGENE Schrittzahl (nicht der Workflow-Default,
// nicht der Request-Rohwert) in der Ergebnis-Notiz landet.
//
//   node scripts/mock-comfy.mjs                # Port 8189
//   MOCK_COMFY_PORT=8199 node scripts/mock-comfy.mjs
//
// Danach den Plugin-Endpunkt (Server-Feld in den Settings) auf http://127.0.0.1:8189 stellen,
// engine auf "comfy", einen Workflow hinterlegen, `npm run smoke:gui`.
import http from "node:http";
import { writeFileSync } from "node:fs";

const PORT = Number(process.env.MOCK_COMFY_PORT ?? 8189);
const COUNTS_FILE = new URL("../.mock-comfy-counts.json", import.meta.url);

// 1x1-transparentes PNG, roh als Bytes — /view liefert nie JSON, sondern das Bild selbst
// (Content-Type image/png), wie ein echter ComfyUI-Server.
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const counts = { system_stats: 0, prompt: 0, history: 0, view: 0 };
// Der zuletzt EMPFANGENE Graph (das "prompt"-Feld aus POST /prompt) — nicht der Workflow, den
// der Treiber verschickt hat, sondern das, was auf der Leitung wirklich ankam. Das ist der
// Unterschied, den Punkt 38 misst.
let lastGraph = null;
// Jede neue Einreichung ist zunaechst "noch am Rechnen" — genau EIN /history-Aufruf danach
// bekommt {}, jeder weitere den fertigen Eintrag. Bildet nach, dass ein echter Server nicht
// beim ersten Poll schon fertig ist (der Client pollt genau dafuer in einer Schleife).
let pending = false;

const persist = () => writeFileSync(COUNTS_FILE, JSON.stringify({ counts, graph: lastGraph }));
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;

    if (path === "/system_stats") {
      counts.system_stats++;
      persist();
      return json(res, 200, { system: {} });
    }

    if (path === "/prompt" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        counts.prompt++;
        try {
          const parsed = JSON.parse(body);
          lastGraph = parsed.prompt ?? null;
        } catch {
          lastGraph = null;
        }
        pending = true;
        persist();
        return json(res, 200, { prompt_id: "p1" });
      });
      return;
    }

    if (path === "/history/p1") {
      counts.history++;
      persist();
      if (pending) {
        pending = false;
        return json(res, 200, {});
      }
      return json(res, 200, {
        p1: {
          status: { status_str: "success", messages: [] },
          outputs: { "9": { images: [{ filename: "smoke.png", subfolder: "", type: "output" }] } },
        },
      });
    }

    if (path === "/view") {
      counts.view++;
      persist();
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(PIXEL_PNG);
    }

    res.writeHead(404);
    res.end();
  })
  .listen(PORT, "127.0.0.1", () =>
    console.log(`mock comfy auf http://127.0.0.1:${PORT} · Zaehler + letzter Graph: ${COUNTS_FILE.pathname}`),
  );
