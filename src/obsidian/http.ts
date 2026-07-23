// Netz-Helfer über Obsidians requestUrl (CORS-frei) — kapselt den obsidian-Import,
// damit Txt2ImgClient pure bleibt. Muster: yijing-oracle/src/obsidian/http.ts.
import { requestUrl } from "obsidian";

/** Passt zu HttpPostJson in core/txt2img.ts. Default-Timeout 30 min: große Bilder auf
 *  langsamen Servern können Minuten dauern (Spec §3) — der Timeout ist nur die Notbremse gegen
 *  ewiges Hängen, requestUrl kennt weder timeout noch Abort. */
export async function httpPostJson(url: string, body: unknown, timeoutMs = 1_800_000): Promise<{ status: number; json: unknown }> {
  let timer: number | undefined;
  const timeout = new Promise<"__timeout__">((resolve) => {
    timer = window.setTimeout(() => resolve("__timeout__"), timeoutMs);
  });
  try {
    const raced = await Promise.race([
      requestUrl({ url, method: "POST", contentType: "application/json", body: JSON.stringify(body), throw: false }).then((r) => {
        let json: unknown = undefined;
        try { json = r.json; } catch { /* nicht-JSON-Body → json bleibt undefined */ }
        return { status: r.status, json } as const;
      }),
      timeout,
    ]);
    if (raced === "__timeout__") throw new Error(`timeout after ${timeoutMs} ms`);
    return raced;
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

/** GET mit kurzem Timeout — für options-/progress-Discovery (Spec §3: 3 s). */
export async function httpGetJson(url: string, timeoutMs = 3000): Promise<{ status: number; json: unknown }> {
  let timer: number | undefined;
  const timeout = new Promise<"__timeout__">((resolve) => {
    timer = window.setTimeout(() => resolve("__timeout__"), timeoutMs);
  });
  try {
    const raced = await Promise.race([
      requestUrl({ url, throw: false }).then((r) => {
        let json: unknown = undefined;
        try { json = r.json; } catch { /* nicht-JSON-Body → json bleibt undefined */ }
        return { status: r.status, json } as const;
      }),
      timeout,
    ]);
    if (raced === "__timeout__") throw new Error(`timeout after ${timeoutMs} ms`);
    return raced;
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
