// vendored from obsidian-kit@0.101.0, src/pure/image-gen-provider.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Öffentlicher Vertrag des Fähigkeits-Besitzers `local-image-generator` (Bildgenerierung) —
 *  Muster `pure/endpoint-source.ts`: EINE Quelle, der Besitzer re-exportiert sie, Konsumenten
 *  vendoren. Fehler sind Werte (`ImageGenProviderError`), Methoden fangen selbst — nie werfen.
 *  Form-Guard statt Versionskopie, siehe `audio-provider.ts` (dieselbe Begründung).
 *
 *  Die API abstrahiert über BACKENDS (mobil: Apple-Kurzbefehl/Image Playground, desktop:
 *  DrawThings/A1111/Comfy) — ein Konsument merkt den Unterschied nie (Spec § Leitentscheidung).
 *  Mobil ist der Kurzbefehl-Weg das EINZIGE Backend (Kernversprechen, nicht Kür): stilisierte
 *  Ausgaben (Animation/Illustration/Sketch), keine Fotorealistik, keine Negativ-Prompts/Maße. *
 *  **Abbruch (seit 0.93.0, additiv, v1 bleibt; Muster `describe-provider.ts`):** `generateImage` bekommt ein optionales `signal`, der Fehlercode `aborted` ist neu. Der Vertrag sagt, was ein Anbieter tun muss, wenn er abbricht (Feld `signal`);
 *  ob das Backend dabei wirklich anhält, ist Sache des Anbieters und nicht Vertrag: ein Backend, das nicht anzuhalten ist, liefert trotzdem `aborted`, und für den Aufrufer endet das Warten. **Ein Anbieter vor 0.93.0** kennt `signal`
 *  nicht und ignoriert es: der Aufruf läuft zu Ende und liefert sein Ergebnis. Der Aufrufer, der abbrechen will, hört dann selbst auf zu warten (`Promise.race` gegen sein Signal) und verwirft das späte Ergebnis. Das Kit hat keinen
 *  Aufruf-Helfer, der den Anbieter ruft (`obsidian/capability-apis.ts` liest nur die API), also auch keinen, der das für einen alten Anbieter tut. `aborted` ist kein Fehler des Anbieters, sondern der Wunsch des Nutzers: `imageGenErrorText` zeigt dafür einen eigenen Text. */
export const IMAGE_GEN_PROVIDER_API_VERSION = 1;
/** Plugin-ID des Besitzers (`local-image-generator`): dort liegt die API unter `app.plugins.plugins[id].api`; gelesen mit `readImageGenApi`. */
export const IMAGE_GEN_PLUGIN_ID = "local-image-generator";

export type ImageGenProviderErrorCode = "backend-unavailable" | "timeout" | "busy" | "refused" | "aborted" | "failed";
export interface ImageGenProviderError { error: ImageGenProviderErrorCode; message: string }

export interface GenerateImageOptions {
  /** Vault-Zielordner (ohne Dateinamen) — die Endung wählt das Backend. */
  targetFolder: string;
  /** Beendet den Aufruf. **Pflicht des Anbieters:** ein schon abgebrochenes Signal liefert `aborted`, ohne das Backend zu rufen; ein Abbruch währenddessen ebenso. Kann der Anbieter das Backend nicht anhalten, liefert er trotzdem `aborted` und verwirft das späte Ergebnis (bei `aborted` steht kein neues Bild im Vault). */
  signal?: AbortSignal;
}

export interface ImageGenProviderApi {
  version: 1;
  /** Prompt → Vault-relativer Pfad des erzeugten Bilds. */
  generateImage(prompt: string, opts: GenerateImageOptions): Promise<string | ImageGenProviderError>;
}

const METHODS = ["generateImage"] as const;

export function isImageGenProviderApi(x: unknown): x is ImageGenProviderApi {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== IMAGE_GEN_PROVIDER_API_VERSION) return false;
  return METHODS.every((m) => typeof o[m] === "function");
}
