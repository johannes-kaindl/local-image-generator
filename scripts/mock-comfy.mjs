// ComfyUI-Mock fuer den GUI-Smoke ohne echten ComfyUI-Server (analog scripts/mock-a1111.mjs,
// aber eine EIGENE Datei — s. AGENTS.md: mock-a1111.mjs hat seit 2026-09-02 einen fremden
// Konsumenten (epub-exporter), diese Datei hat keinen und darf frei geformt werden).
//
// Kennt die vier Endpunkte, die ComfyClient (src/core/comfy/client.ts) nutzt:
//   GET  /system_stats     -> 200 { system: {} }                      (Verbindungstest)
//   POST /prompt           -> { prompt_id: "p1" }                     (Workflow einreichen)
//   GET  /history/p1       -> beim ERSTEN Aufruf NACH einem /prompt {} (noch am Rechnen),
//                              danach der Erfolgs-Eintrag mit einem images-Verweis
//   WS   /ws?clientId=…     -> Fortschritts-Socket (seit Welle 24): nach einem /prompt mit
//                              passender client_id kommen STEPS `progress`-Nachrichten
//                              (value 1..STEPS, max STEPS, prompt_id p1), /history bleibt bis
//                              zur letzten leer. Die Laufzeit (STEPS * STEP_MS) gilt
//                              auch ohne Socket. MOCK_COMFY_WS=off lehnt den Handshake mit 403 ab
//                              (Fallback-Probe: ComfyUI 0.30.0 tat das fuer Obsidians Origin).
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
import { createHash } from "node:crypto";

const PORT = Number(process.env.MOCK_COMFY_PORT ?? 8189);
const COUNTS_FILE = new URL("../.mock-comfy-counts.json", import.meta.url);

// 1x1-transparentes PNG, roh als Bytes — /view liefert nie JSON, sondern das Bild selbst
// (Content-Type image/png), wie ein echter ComfyUI-Server.
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const counts = { system_stats: 0, prompt: 0, history: 0, view: 0, ws_open: 0, ws_refused: 0, ws_progress: 0 };
// Socket-Beobachtungen fuer Punkt 47: was auf der Leitung ankam, nicht was der Treiber erwartet.
const ws = { origin: null, clientId: null, postClientId: null };
const STEPS = 4;
const STEP_MS = 700;
const sockets = new Map(); // clientId -> net.Socket
let progressRunning = false;
// Der zuletzt EMPFANGENE Graph (das "prompt"-Feld aus POST /prompt) — nicht der Workflow, den
// der Treiber verschickt hat, sondern das, was auf der Leitung wirklich ankam. Das ist der
// Unterschied, den Punkt 38 misst.
let lastGraph = null;
// Jede neue Einreichung ist zunaechst "noch am Rechnen" — genau EIN /history-Aufruf danach
// bekommt {}, jeder weitere den fertigen Eintrag. Bildet nach, dass ein echter Server nicht
// beim ersten Poll schon fertig ist (der Client pollt genau dafuer in einer Schleife).
let pending = false;

const persist = () => writeFileSync(COUNTS_FILE, JSON.stringify({ counts, graph: lastGraph, ws }));
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/** Ein ungemaskter Textrahmen (Server -> Client) nach RFC 6455. */
function textFrame(text) {
  const payload = Buffer.from(text);
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, n >> 8, n & 255]);
  return Buffer.concat([head, payload]);
}

function startProgress(clientId) {
  progressRunning = true;
  let i = 0;
  const timer = setInterval(() => {
    i++;
    // Den Socket erst beim Senden nachschlagen: Renderer oeffnen ihn VOR dem POST, der
    // Handshake ist aber asynchron und kann hinter dem POST ankommen (ein echter ComfyUI
    // sendet ebenfalls erst waehrend der Ausfuehrung, nicht beim Absenden).
    const sock = sockets.get(clientId);
    if (sock && !sock.destroyed) {
      sock.write(textFrame(JSON.stringify({ type: "progress", data: { value: i, max: STEPS, prompt_id: "p1", node: "3" } })));
      // Eine fremde Nachricht dazwischen: der Client muss sie ignorieren.
      if (i === 1) sock.write(textFrame(JSON.stringify({ type: "progress", data: { value: 99, max: 100, prompt_id: "FREMD" } })));
      counts.ws_progress++;
      persist();
    }
    if (i >= STEPS) {
      clearInterval(timer);
      progressRunning = false;
    }
  }, STEP_MS);
}

const server = http
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
        try {
          ws.postClientId = JSON.parse(body).client_id ?? null;
        } catch {
          ws.postClientId = null;
        }
        if (ws.postClientId) startProgress(ws.postClientId);
        persist();
        return json(res, 200, { prompt_id: "p1" });
      });
      return;
    }

    if (path === "/history/p1") {
      counts.history++;
      persist();
      if (progressRunning) return json(res, 200, {});
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
  ;

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/ws" || process.env.MOCK_COMFY_WS === "off") {
    counts.ws_refused++;
    persist();
    socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    return socket.destroy();
  }
  const key = req.headers["sec-websocket-key"];
  const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const clientId = url.searchParams.get("clientId") ?? "";
  sockets.set(clientId, socket);
  ws.origin = req.headers.origin ?? null;
  ws.clientId = clientId;
  counts.ws_open++;
  persist();
  socket.on("data", () => {}); // Rahmen des Clients (Close, Ping) werden nicht gebraucht
  socket.on("close", () => sockets.delete(clientId));
  socket.on("error", () => sockets.delete(clientId));
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`mock comfy auf http://127.0.0.1:${PORT} · Zaehler + letzter Graph: ${COUNTS_FILE.pathname}`),
);
