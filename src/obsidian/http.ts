// Netz-Helfer über Obsidians requestUrl (CORS-frei) — kapselt den obsidian-Import,
// damit A1111Client pure bleibt. Muster: yijing-oracle/src/obsidian/http.ts.
import { requestUrl } from "obsidian";
import { withTimeout } from "../vendor/kit/timeout";
import { type ComfyTransport } from "../core/comfy/client";

/** Passt zu HttpPostJson in core/txt2img.ts. Default-Timeout 30 min: große Bilder auf
 *  langsamen Servern können Minuten dauern (Spec §3) — der Timeout ist nur die Notbremse gegen
 *  ewiges Hängen, requestUrl kennt weder timeout noch Abort. */
export async function httpPostJson(url: string, body: unknown, timeoutMs = 1_800_000): Promise<{ status: number; json: unknown }> {
  const raced = await withTimeout(
    requestUrl({ url, method: "POST", contentType: "application/json", body: JSON.stringify(body), throw: false }).then((r) => {
      let json: unknown = undefined;
      try { json = r.json; } catch { /* nicht-JSON-Body → json bleibt undefined */ }
      return { status: r.status, json } as const;
    }),
    timeoutMs,
    window,
  );
  if (raced.timedOut) throw new Error(`timeout after ${timeoutMs} ms`);
  return raced.value;
}

/** GET mit kurzem Timeout — für options-/progress-Discovery (Spec §3: 3 s). */
export async function httpGetJson(url: string, timeoutMs = 3000): Promise<{ status: number; json: unknown }> {
  const raced = await withTimeout(
    requestUrl({ url, throw: false }).then((r) => {
      let json: unknown = undefined;
      try { json = r.json; } catch { /* nicht-JSON-Body → json bleibt undefined */ }
      return { status: r.status, json } as const;
    }),
    timeoutMs,
    window,
  );
  if (raced.timedOut) throw new Error(`timeout after ${timeoutMs} ms`);
  return raced.value;
}

/** Binärantwort als Base64 — für ComfyUIs /view, das ein PNG liefert, kein JSON.
 *  `arrayBuffer` ist der einzige Weg, den requestUrl für Bytes anbietet. Der Timeout ist
 *  großzügig wie beim POST: das Bild kann groß sein. */
export async function httpGetBase64(url: string, timeoutMs = 1_800_000): Promise<{ status: number; base64: string }> {
  const raced = await withTimeout(
    requestUrl({ url, throw: false }).then((r) => {
      const bytes = new Uint8Array(r.arrayBuffer);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
      return { status: r.status, base64: r.status === 200 ? btoa(bin) : "" } as const;
    }),
    timeoutMs,
    window,
  );
  if (raced.timedOut) throw new Error(`timeout after ${timeoutMs} ms`);
  return raced.value;
}

/** Fertig verdrahteter Transport für ComfyClient — bündelt die vier Netzwege plus Uhr und
 *  Warten, damit der pure Client nichts davon selbst kennen muss.
 *  uebernommen aus yijing-oracle/src/obsidian/http.ts, 2026-09-06 */
export function comfyTransport(): ComfyTransport {
  return {
    postJson: (url, body) => httpPostJson(url, body),
    // Kurzer Timeout (3 s Default), weil /history im Sekundentakt gepollt wird und ein
    // haengender Poll den naechsten nicht aufhalten soll. Das ist NUR zulaessig, weil
    // `ComfyClient.waitForImage` einen geworfenen Poll faengt und weiterpollt: /history ist
    // der Ergebniskanal, und ohne das Fangen beendete ein einziger langsamer Poll den Lauf,
    // waehrend das Bild auf dem Server fertig ist (I1, Branch-Abschlussreview 2026-09-06).
    // Wer dort das try/catch entfernt, muss diesen Timeout mitentfernen.
    getJson: (url) => httpGetJson(url),
    getBase64: (url) => httpGetBase64(url),
    sleep: (ms) => new Promise((r) => window.setTimeout(r, ms)),
    now: () => Date.now(),
  };
}
