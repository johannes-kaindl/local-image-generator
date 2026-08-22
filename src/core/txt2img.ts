// A1111-kompatibler txt2img-Client (Spec §3) — pure, HTTP injiziert; Referenz:
// yijing-oracle/src/obsidian/image-client.ts. Deckt Draw Things, A1111, Forge, SD.Next.
import { normalizeEndpoint } from "../vendor/kit/endpoint";

export type HttpPostJson = (url: string, body: unknown) => Promise<{ status: number; json: unknown }>;

export interface ImageRequest {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  cfg: number;
  /** Die BYTES der Vorlage (Base64-PNG ohne `data:`-Praefix), null bei txt2img. Heisst
   *  bewusst anders als `GenParams.initImage` (dort: der Vault-PFAD) — der Auftrag traegt
   *  das Bild, das Rezept nur seine Herkunft. Bei gleichem Namen haette der Spread
   *  `{ ...params, … }` in runGeneration still einen Pfad als Bilddaten verschickt; als
   *  Pflichtfeld mit eigenem Namen faengt das der Typecheck ab. */
  initImageData: string | null;
  /** Nur bei img2img gesetzt (A1111: `denoising_strength`). */
  denoising: number | null;
}

export interface ImageBackend {
  /** Liefert das Bild als Base64-PNG; wirft Error mit Klartext bei Fehlschlag. */
  generate(req: ImageRequest): Promise<string>;
}

export class Txt2ImgClient implements ImageBackend {
  constructor(
    private readonly endpoint: string,
    private readonly post: HttpPostJson,
  ) {}

  async generate(req: ImageRequest): Promise<string> {
    const url = `${normalizeEndpoint(this.endpoint)}/sdapi/v1/txt2img`;
    const { status, json } = await this.post(url, {
      prompt: req.prompt,
      negative_prompt: req.negativePrompt,
      width: req.width,
      height: req.height,
      steps: req.steps,
      seed: req.seed,
      cfg_scale: req.cfg,
    });
    if (status !== 200) throw new Error(`txt2img HTTP ${status}`);
    const images = (json as { images?: unknown })?.images;
    const first: unknown = Array.isArray(images) ? images[0] : undefined;
    if (typeof first !== "string" || !first) throw new Error("txt2img: empty result");
    return first;
  }
}

/** Aktives Modell aus GET /sdapi/v1/options. Zwei Schreibweisen im Feld:
 *  A1111/Forge/SD.Next liefern `sd_model_checkpoint`, Draw Things liefert `model`
 *  (verifiziert am laufenden Server, 2026-08-03: `model: "flux_2_dev_i8x.ckpt"`, kein
 *  sd_model_checkpoint). `sd_model_checkpoint` hat Vorrang — es ist das spezifischere
 *  A1111-Feld, `model` ist im Options-Objekt ein generischerer Name.
 *  null nur, wenn keins von beiden brauchbar ist → UI zeigt "(im Server gewählt)". */
export function parseOptionsModel(json: unknown): string | null {
  const o = json as { sd_model_checkpoint?: unknown; model?: unknown } | null;
  for (const v of [o?.sd_model_checkpoint, o?.model]) {
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
}

/** Fortschritt aus GET /sdapi/v1/progress als ganze Prozent — null bei fremder Form
 *  (Fallback der Statuszeile: Sekundenzähler statt Prozent, Spec §3). */
export function parseProgressPct(json: unknown): number | null {
  const v = (json as { progress?: unknown } | null)?.progress;
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null;
}

export type HttpGetJson = (url: string) => Promise<{ status: number; json: unknown }>;

/** Ein Poller pro Lauf für GET /sdapi/v1/progress. Draw Things kennt den Endpunkt nicht
 *  (404, gemessen 2026-08-04 und 2026-08-17) — nach dem ersten 404 wird nicht mehr gefragt,
 *  sonst gingen pro Bild ~240 garantiert vergebliche Anfragen gegen einen rechnenden
 *  Server. Nur 404 heißt „kennt den Endpunkt nicht"; Timeout und 5xx sind vorübergehend
 *  und schalten nichts ab. poll() liefert immer null statt zu werfen — die Statuszeile
 *  zählt dann Sekunden. */
export class ProgressPoller {
  private unsupported = false;

  constructor(
    private readonly endpoint: string,
    private readonly get: HttpGetJson,
  ) {}

  async poll(): Promise<number | null> {
    if (this.unsupported) return null;
    try {
      const { status, json } = await this.get(`${normalizeEndpoint(this.endpoint)}/sdapi/v1/progress`);
      if (status === 404) { this.unsupported = true; return null; }
      return status === 200 ? parseProgressPct(json) : null;
    } catch {
      return null;
    }
  }
}
