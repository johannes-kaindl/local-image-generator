// ComfyUI-Fortschritt per WebSocket: die reine Seite (Nachricht lesen, Adresse bilden).
// Der Socket selbst liegt in `vendor/kit-obsidian/text-socket.ts` (Kit `openTextSocket`, verdrahtet in `obsidian/http.ts`); ob der Lauf gelang, steht weiter
// in /history (`client.ts`) — der Socket liefert nur den Balken, faellt er aus, bleibt der
// Sekundenzaehler.
import type { ComfyProgress } from "./client";

/** `{"type":"progress","data":{"value":3,"max":20,"prompt_id":"…","node":"5"}}` → `{value, max}`.
 *  `null` fuer alles andere. Nachrichten mit fremder `prompt_id` zaehlen nicht: die Queue ist
 *  geteilt, der Socket sieht auch die Auftraege anderer Clients. Fehlt die `prompt_id` (aelteres
 *  ComfyUI), gilt die Nachricht. Binaerrahmen (Vorschaubilder) sind keine Strings und kommen
 *  hier nie an. */
export function parseComfyProgress(raw: string, promptId: string | null): ComfyProgress | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  const m = msg as { type?: unknown; data?: { value?: unknown; max?: unknown; prompt_id?: unknown } } | null;
  if (m?.type !== "progress" || typeof m.data !== "object" || m.data === null) return null;
  const { value, max, prompt_id: pid } = m.data;
  if (typeof pid === "string" && promptId !== null && pid !== promptId) return null;
  if (typeof value !== "number" || typeof max !== "number") return null;
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value < 0 || value > max) return null;
  return { value, max };
}

/** `http(s)://host:port[/…]` → `ws(s)://host:port/ws?clientId=…`; `null` bei anderem Schema. */
export function comfyProgressSocketUrl(base: string, clientId: string): string | null {
  const m = /^(https?):\/\/([^/]+)/i.exec(base.trim());
  if (!m) return null;
  const scheme = m[1]!.toLowerCase() === "https" ? "wss" : "ws";
  return `${scheme}://${m[2]}/ws?clientId=${encodeURIComponent(clientId)}`;
}
