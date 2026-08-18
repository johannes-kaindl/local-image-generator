// A1111-Mock für den GUI-Smoke ohne echten Bild-Server (Ersatz-Abnahme, 2026-08-18).
// Kennt die drei Endpunkte, die das Plugin nutzt: /options (Modellname), /progress
// (404 wie Draw Things — Anfragen werden gezählt), /txt2img (wartet DELAY_MS, liefert ein
// 256×256-Rausch-PNG, groß genug für Smoke-Punkt 7). Zähler landen in .mock-a1111-counts.json.
//
//   node scripts/mock-a1111.mjs                # Port 7861
//   MOCK_PORT=7862 MOCK_DELAY_MS=3000 node scripts/mock-a1111.mjs
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
function noisePng(size = 256) {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;
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

const png = noisePng();
const counts = { options: 0, progress: 0, txt2img: 0 };
const persist = () => writeFileSync(COUNTS_FILE, JSON.stringify(counts));
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

http.createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (path === "/sdapi/v1/options") { counts.options++; persist(); return json(res, 200, { model: "mock-model.ckpt" }); }
  if (path === "/sdapi/v1/progress") { counts.progress++; persist(); return json(res, 404, { detail: "Not Found" }); }
  if (path === "/sdapi/v1/txt2img") {
    counts.txt2img++; persist();
    req.on("data", () => {}); req.on("end", () => setTimeout(() => json(res, 200, { images: [png] }), DELAY_MS));
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, "127.0.0.1", () => console.log(`mock a1111 auf http://127.0.0.1:${PORT} · txt2img dauert ${DELAY_MS} ms · Zähler: ${COUNTS_FILE.pathname}`));
