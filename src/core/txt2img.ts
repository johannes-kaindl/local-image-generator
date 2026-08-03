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
