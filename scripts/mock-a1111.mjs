// A1111-Mock für den GUI-Smoke ohne echten Bild-Server (Ersatz-Abnahme, 2026-08-18).
// Kennt die vier Endpunkte, die das Plugin nutzt: /options (Modellname), /progress
// (404 wie Draw Things — Anfragen werden gezählt), /txt2img und /img2img (warten DELAY_MS,
// liefern ein 256×256-Rausch-PNG aus dem Seed der Anfrage, groß genug für Smoke-Punkt 7).
// Zähler landen in .mock-a1111-counts.json — an ihnen misst Smoke-Punkt 19, ob ein Lauf mit
// Vorlage WIRKLICH am img2img-Endpunkt ankommt (der Panel-Zustand kann korrekt sein, während
// die Anfrage woanders landet).
//
//   node scripts/mock-a1111.mjs                # Port 7861
//   MOCK_PORT=7862 MOCK_DELAY_MS=3000 node scripts/mock-a1111.mjs
//
// Fehlermodus zur Laufzeit (fuer Smoke-Punkt 18c): `GET /mock/fail?on=1` laesst txt2img und
// img2img mit HTTP 500 und einer WIEDERERKENNBAREN Meldung antworten, `?on=0` schaltet zurueck.
// Ein Umschalter statt einer Env-Variablen, weil der Punkt den Fehlerfall MITTEN im Lauf
// braucht und der Rest des Laufs echte Bilder erwartet — ein Neustart des Servers waere ein
// zweiter Zustand, den der Treiber nicht kontrolliert. Der Pfad dient dem Treiber zugleich als
// Erkennungsmerkmal: antwortet er nicht, laeuft kein Mock und Punkt 18c weiss, dass er den
// Fehlerfall nicht herstellen kann (echte Bild-Server kann man nicht zum Scheitern bringen).
//
// Danach den Plugin-Endpunkt auf http://127.0.0.1:7861 stellen und `npm run smoke:gui`.
// Erwartung seit 598f050: genau EINE /progress-Anfrage pro Lauf (Poller stoppt nach 404).
import http from "node:http";
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const PORT = Number(process.env.MOCK_PORT ?? 7861);
const DELAY_MS = Number(process.env.MOCK_DELAY_MS ?? 6000);
const COUNTS_FILE = new URL("../.mock-a1111-counts.json", import.meta.url);

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function noisePng(size = 256, seed = 7) {
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16) & 0xff;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let i = 1; i < row.length; i++) row[i] = rnd();
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

// Seed-treu wie ein echter Server: anderer Seed → anderes Bild. Sonst sähe ein Prüfpunkt,
// der auf ein NEUES Bild wartet (Smoke 7/15), nie eines (gemessen 2026-08-19).
const pngFor = (seed) => noisePng(256, Number.isFinite(seed) ? seed : 7);
const counts = { options: 0, progress: 0, txt2img: 0, img2img: 0 };
// Absichtlich auffaellig: Smoke-Punkt 18c prueft, dass GENAU DIESER Text nach einem
// gescheiterten Fremdlauf NICHT in der Statuszeile des Panels steht.
const FAIL_MESSAGE = "mock-a1111: refused on purpose (smoke 18c)";
let failing = false;
const persist = () => writeFileSync(COUNTS_FILE, JSON.stringify(counts));
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

http.createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (path === "/mock/fail") {
    const on = new URL(req.url ?? "/", "http://x").searchParams.get("on");
    if (on !== null) failing = on !== "0" && on !== "false";
    return json(res, 200, { failing });
  }
  if (path === "/sdapi/v1/options") { counts.options++; persist(); return json(res, 200, { model: "mock-model.ckpt" }); }
  if (path === "/sdapi/v1/progress") { counts.progress++; persist(); return json(res, 404, { detail: "Not Found" }); }
  if (path === "/sdapi/v1/txt2img" || path === "/sdapi/v1/img2img") {
    const img2img = path.endsWith("/img2img");
    if (img2img) counts.img2img++; else counts.txt2img++;
    persist();
    // Vor dem Body-Lesen: der Fehlerfall soll so frueh antworten, wie ein ueberlasteter Server
    // es taete. Der Zaehler steigt trotzdem — ein abgelehnter Lauf IST ein Lauf.
    if (failing) return json(res, 500, { error: "MockFailure", detail: FAIL_MESSAGE });
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let seed = 7;
      try {
        const parsed = JSON.parse(body);
        seed = Number(parsed.seed);
        // Formtreue statt blossem Zaehlen: ein img2img ohne init_images ist ein Fehler des
        // Plugins, den ein reiner Endpunkt-Zaehler nicht sehen wuerde.
        if (img2img && !Array.isArray(parsed.init_images)) {
          return json(res, 400, { detail: "img2img without init_images" });
        }
      } catch { /* kein JSON → Default */ }
      setTimeout(() => json(res, 200, { images: [pngFor(seed)] }), DELAY_MS);
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, "127.0.0.1", () => console.log(`mock a1111 auf http://127.0.0.1:${PORT} · txt2img/img2img dauern ${DELAY_MS} ms · Zähler: ${COUNTS_FILE.pathname}`));
