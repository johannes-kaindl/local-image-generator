// Zwei Rollen an einem LLM Endpoint Manager statt zwei Settings-Felder (Entscheidung
// Johannes 2026-09-17, Welle 7). Server- und Comfy-Modus fragen unabhängig voneinander nach
// einem Endpunkt der Capability "image"; ohne installierten Manager bleibt `settings.endpoint`
// die eine Wahrheit für beide Modi — genau das bisherige Verhalten, keine Migration nötig.
import type { EndpointConfig } from "../vendor/kit/endpoint_config";
import {
  resolveEndpointSource,
  type EndpointChoice,
  type EndpointSourceResult,
  type LlmEndpointManagerApi,
} from "../vendor/kit/endpoint-source";

export type EndpointRole = "server" | "comfy";

/** Der bisherige einzelne String als EIN-Element-Fallback-Liste — es gibt (noch) keinen
 *  eigenen Listen-Editor in diesem Plugin (anders als lingotuner/yijing-oracle), nur das
 *  eine Textfeld. Leer heißt „nichts konfiguriert", nicht „ein leerer Eintrag". */
export function localImageEndpoints(endpoint: string): EndpointConfig[] {
  const url = endpoint.trim();
  return url ? [{ url }] : [];
}

/** Ein Durchlauf für eine der beiden Rollen: Manager zuerst (falls installiert und ein
 *  Endpunkt mit Capability "image" liefert), sonst das lokale `endpoint`-Feld. `ping` prüft
 *  EINEN Endpunkt (Aufrufer reicht den bestehenden Erreichbarkeits-Check durch). */
export async function resolveImageEndpoint(
  role: EndpointRole,
  choice: EndpointChoice,
  localEndpoint: string,
  manager: LlmEndpointManagerApi | null,
  ping: (cfg: EndpointConfig) => Promise<boolean>,
): Promise<EndpointSourceResult> {
  return resolveEndpointSource(
    {
      manager,
      local: localImageEndpoints(localEndpoint),
      capability: "image",
      choice,
      caller: `local-image-generator/${role}`,
    },
    ping,
  );
}
