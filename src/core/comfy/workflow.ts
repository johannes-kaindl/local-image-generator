// uebernommen aus yijing-oracle/src/core/comfy/workflow.ts, 2026-09-06
// ComfyUI-Workflow im API-Format lesen und patchen. Pure (kein obsidian-Import).
//
// Der Nutzer hinterlegt einen aus ComfyUI exportierten Graphen; wir finden darin die
// Einfügestellen über die explizite Node-Verlinkung (`"positive": ["6", 0]`), nicht über
// Klassennamen oder Konventionen. Damit trägt derselbe Code SDXL-, Flux- und
// Z-Image-Turbo-Workflows, die strukturell verschieden sind (SDXL lädt Modell/CLIP/VAE
// gemeinsam über CheckpointLoaderSimple, Z-Image-Turbo getrennt über UNETLoader +
// CLIPLoader + VAELoader).

export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
}
export type ComfyGraph = Record<string, ComfyNode>;

export interface WorkflowSlots {
  sampler: string;
  positive: string;
  negative: string;
  latent: string;
  /** Variiert je Sampler: KSampler → "seed", KSamplerAdvanced/SamplerCustom → "noise_seed". */
  seedField: "seed" | "noise_seed";
  /** Anders als in der Quelle NICHT nullable: ein Sampler ohne Steps-Feld wird abgewiesen.
   *  Grund ist die Ergebnis-Notiz — `GenParams.steps` hat keinen Null-Fall, und
   *  es gibt keinen ehrlichen Eintrag fuer "das Plugin hat den Wert nicht bestimmt". */
  stepsField: "steps";
  /** Die im Workflow eingestellte Schrittzahl, als Startwert des Reglers. null, wenn das
   *  Feld ein Verweis auf einen anderen Node ist statt eines Zahlenliterals. */
  workflowSteps: number | null;
}

export type InspectError =
  | { kind: "not-an-object" }
  | { kind: "no-sampler" }
  | { kind: "ambiguous-sampler"; ids: string[] }
  | { kind: "dangling-ref"; field: string; id: string }
  | { kind: "no-steps-field" }
  | { kind: "no-size-fields" };

export type InspectResult =
  | { ok: true; slots: WorkflowSlots }
  | { ok: false; error: InspectError };

const LINK_FIELDS = ["positive", "negative", "latent_image"] as const;

function isNode(v: unknown): v is ComfyNode {
  if (typeof v !== "object" || v === null) return false;
  const n = v as Partial<ComfyNode>;
  return typeof n.class_type === "string" && typeof n.inputs === "object" && n.inputs !== null;
}

/** Ein Verweis im API-Format ist [nodeId, outputIndex]. */
function refTarget(v: unknown): string | null {
  return Array.isArray(v) && typeof v[0] === "string" ? v[0] : null;
}

export function inspectWorkflow(graph: unknown): InspectResult {
  if (typeof graph !== "object" || graph === null || Array.isArray(graph)) {
    return { ok: false, error: { kind: "not-an-object" } };
  }
  const nodes = graph as Record<string, unknown>;

  // Sampler = der Node, der positive, negative UND latent_image entgegennimmt. Bewusst
  // ohne Klassennamen-Liste: KSampler, KSamplerAdvanced und SamplerCustom erfüllen das
  // gleichermaßen (gemessen an ComfyUI 0.30.0), ebenso künftige Varianten.
  const candidates = Object.keys(nodes).filter((id) => {
    const n = nodes[id];
    return isNode(n) && LINK_FIELDS.every((f) => f in n.inputs);
  });

  if (candidates.length === 0) return { ok: false, error: { kind: "no-sampler" } };
  if (candidates.length > 1) {
    return { ok: false, error: { kind: "ambiguous-sampler", ids: candidates } };
  }

  const samplerId = candidates[0]!;
  const sampler = nodes[samplerId] as ComfyNode;

  const resolved: Record<string, string> = {};
  for (const field of LINK_FIELDS) {
    const target = refTarget(sampler.inputs[field]);
    if (target === null || !isNode(nodes[target])) {
      return { ok: false, error: { kind: "dangling-ref", field, id: String(target ?? "") } };
    }
    resolved[field] = target;
  }

  // Die Regel: nutzbar ist ein Workflow, in den wir alle fuenf Werte setzen
  // koennen, die wir anschliessend in die Notiz schreiben. Die Pruefung sitzt hier und
  // nicht in patchWorkflow, weil patchWorkflow pure bleibt und nicht urteilt — es
  // ueberspringt fehlende Felder stumm, was dort richtig ist.
  if (!("steps" in sampler.inputs)) return { ok: false, error: { kind: "no-steps-field" } };
  const latentInputs = (nodes[resolved.latent_image!] as ComfyNode).inputs;
  if (!("width" in latentInputs) || !("height" in latentInputs)) {
    return { ok: false, error: { kind: "no-size-fields" } };
  }
  const rawSteps = sampler.inputs.steps;

  return {
    ok: true,
    slots: {
      sampler: samplerId,
      positive: resolved.positive!,
      negative: resolved.negative!,
      latent: resolved.latent_image!,
      // Feldnamen AM NODE ablesen, nicht annehmen: ein blind gesetztes `seed` legte bei
      // KSamplerAdvanced ein neues, unbenutztes Feld an — das Bild käme, wäre aber bei
      // jedem Wurf identisch. Ein stiller Fehler, der erst beim Vergleich auffällt.
      seedField: "noise_seed" in sampler.inputs ? "noise_seed" : "seed",
      stepsField: "steps",
      // Ein Verweis auf einen anderen Node (["9", 0]) ist patchbar, aber kein Startwert —
      // nur ein Zahlenliteral zeigt uns, was der Workflow-Autor eingestellt hat.
      workflowSteps: typeof rawSteps === "number" && Number.isInteger(rawSteps) ? rawSteps : null,
    },
  };
}

export interface PatchValues {
  prompt: string;
  negativePrompt: string;
  seed: number;
  /** Anders als in der Quelle nicht nullable — s. WorkflowSlots.stepsField. */
  steps: number;
  width: number;
  height: number;
}

/** Setzt die Reading-Werte in eine **Kopie** des Graphen. Alles, was nicht in `slots`
 *  benannt ist, bleibt unverändert — Sampler-Name, Scheduler, CFG, LoRAs und Upscaler
 *  gehören dem Nutzer und sind bewusst nicht konfigurierbar.
 *
 *  **Aufrufvertrag:** `slots` muss aus `inspectWorkflow()` **desselben Graphen** stammen.
 *  Ein Aufruf mit gecachten Slots gegen einen neu geladenen Graphen produziert undefined.
 *  Die Non-null-Assertions in dieser Funktion beruhen darauf, dass dieser Vertrag eingehalten wird. */
export function patchWorkflow(graph: ComfyGraph, slots: WorkflowSlots, v: PatchValues): ComfyGraph {
  const out = JSON.parse(JSON.stringify(graph)) as ComfyGraph;

  out[slots.positive]!.inputs.text = v.prompt;
  out[slots.negative]!.inputs.text = v.negativePrompt;
  out[slots.sampler]!.inputs[slots.seedField] = v.seed;
  out[slots.sampler]!.inputs[slots.stepsField] = v.steps;

  // Nicht jeder Latent-Node hat Maße (LatentFromBatch, LatentUpscale mit Verweis).
  // Ein blind gesetztes width/height legte dort ein totes Feld an.
  const latent = out[slots.latent]!.inputs;
  if ("width" in latent) latent.width = v.width;
  if ("height" in latent) latent.height = v.height;

  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Rolle eines ComfyUI-Workflows am Graphen erkennen — Erzeugen, Bearbeiten, Hochskalieren. Pure.
//
// Wie `inspectWorkflow` (workflow.ts) erkennt dieses Modul die Einfügestellen an der Verlinkung der Knoten, nicht an
// Klassennamen. Ein Bild-Eingang ist ein Knoten, dessen Eingang `image` ein Dateiname (String-Literal) ist und der
// selbst keinen Verweis entgegennimmt (ComfyUIs `LoadImage` hat genau diese Form). Die txt2img-Prüfung bleibt
// `inspectWorkflow`; ohne Bild-Eingang entscheidet sie allein.
//
// Bearbeiten ist bewusst eng gefasst: der Bild-Eingang muss in den Latent des Samplers münden, ohne `VAEEncode`
// (das wäre img2img mit Denoise, eine andere Zusage) und ohne ControlNet (dort mündet das Bild nur als Führung in
// die Konditionierung). Beides wird mit eigenem Grund abgewiesen, statt still als „Bearbeiten“ durchzulaufen.
// Einen Negativ-Slot hat Bearbeiten nicht: läuft die Konditionierung durch einen Referenz-Knoten wie
// `ReferenceMultiLatent`, sind von `positive` aus beide Text-Knoten erreichbar und nicht zu trennen.

export type WorkflowRole = "txt2img" | "edit" | "upscale";

export interface EditSlots {
  /** Der Bild-Eingang — bekommt den Namen der hochgeladenen Vorlage. */
  image: string;
  sampler: string;
  /** Der eine Text-Knoten stromaufwärts von `positive` — bekommt die Anweisung. */
  prompt: string;
  seedField: "seed" | "noise_seed";
  stepsField: "steps";
  /** Wie `WorkflowSlots.workflowSteps`: Startwert des Reglers, null bei einem Verweis statt einer Zahl. */
  workflowSteps: number | null;
}

export interface UpscaleSlots {
  image: string;
  /** Knoten mit `width`/`height`, der direkt am Bild-Eingang hängt und vor dem Upscaler liegt (ComfyUIs
   *  `ImageScale`). Das Plugin setzt ihn auf die Maße der Vorlage. null: keiner da — der Workflow läuft, auf
   *  Apple-GPUs liefern die Upscale-Modelle ohne diesen Schritt aber Streifen. */
  prescale: string | null;
}

export type RoleError =
  | InspectError
  | { kind: "ambiguous-image-input"; ids: string[] }
  | { kind: "img2img-unsupported" }
  | { kind: "controlnet-unsupported" }
  | { kind: "image-not-in-latent" }
  | { kind: "no-prompt-node" }
  | { kind: "ambiguous-prompt-node"; ids: string[] }
  | { kind: "no-upscaler" };

export type Classified =
  | { role: "txt2img"; slots: WorkflowSlots }
  | { role: "edit"; slots: EditSlots }
  | { role: "upscale"; slots: UpscaleSlots }
  | { role: null; error: RoleError };

function isImageInput(n: ComfyNode): boolean {
  if (typeof n.inputs.image !== "string") return false;
  return Object.values(n.inputs).every((v) => refTarget(v) === null);
}

/** Alle Knoten, von denen `start` abhängt, `start` eingeschlossen (Breitensuche über jeden Verweis). */
function upstream(nodes: Record<string, unknown>, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const n = nodes[queue.shift()!];
    if (!isNode(n)) continue;
    for (const v of Object.values(n.inputs)) {
      const t = refTarget(v);
      if (t !== null && !seen.has(t)) {
        seen.add(t);
        queue.push(t);
      }
    }
  }
  return seen;
}

export function classifyWorkflow(graph: unknown): Classified {
  if (typeof graph !== "object" || graph === null || Array.isArray(graph)) {
    return { role: null, error: { kind: "not-an-object" } };
  }
  const nodes = graph as Record<string, unknown>;
  const ids = Object.keys(nodes);
  const node = (id: string): ComfyNode | null => (isNode(nodes[id]) ? nodes[id] : null);

  const images = ids.filter((id) => {
    const n = node(id);
    return n !== null && isImageInput(n);
  });
  if (images.length > 1) return { role: null, error: { kind: "ambiguous-image-input", ids: images } };
  if (images.length === 0) {
    const r = inspectWorkflow(graph);
    return r.ok ? { role: "txt2img", slots: r.slots } : { role: null, error: r.error };
  }
  const image = images[0]!;

  const samplers = ids.filter((id) => {
    const n = node(id);
    return n !== null && LINK_FIELDS.every((f) => f in n.inputs);
  });

  if (samplers.length === 0) {
    const upscaler = ids.find((id) => refTarget(node(id)?.inputs.upscale_model) !== null);
    if (upscaler === undefined) return { role: null, error: { kind: "no-upscaler" } };
    const before = upstream(nodes, upscaler);
    const prescale = ids.find((id) => {
      const n = node(id);
      return n !== null && before.has(id) && typeof n.inputs.width === "number" && typeof n.inputs.height === "number"
        && refTarget(n.inputs.image) === image;
    });
    return { role: "upscale", slots: { image, prescale: prescale ?? null } };
  }
  if (samplers.length > 1) return { role: null, error: { kind: "ambiguous-sampler", ids: samplers } };
  const samplerId = samplers[0]!;
  const sampler = node(samplerId)!;

  if (ids.some((id) => refTarget(node(id)?.inputs.control_net) !== null)) {
    return { role: null, error: { kind: "controlnet-unsupported" } };
  }
  const latentId = refTarget(sampler.inputs.latent_image);
  const latent = latentId === null ? null : node(latentId);
  if (latentId === null || latent === null) {
    return { role: null, error: { kind: "dangling-ref", field: "latent_image", id: String(latentId ?? "") } };
  }
  if (refTarget(latent.inputs.pixels) !== null) return { role: null, error: { kind: "img2img-unsupported" } };
  if (!upstream(nodes, latentId).has(image)) return { role: null, error: { kind: "image-not-in-latent" } };

  const positiveId = refTarget(sampler.inputs.positive);
  if (positiveId === null || node(positiveId) === null) {
    return { role: null, error: { kind: "dangling-ref", field: "positive", id: String(positiveId ?? "") } };
  }
  const reach = upstream(nodes, positiveId);
  const texts = ids.filter((id) => reach.has(id) && "text" in (node(id)?.inputs ?? {}));
  if (texts.length === 0) return { role: null, error: { kind: "no-prompt-node" } };
  if (texts.length > 1) return { role: null, error: { kind: "ambiguous-prompt-node", ids: texts } };

  if (!("steps" in sampler.inputs)) return { role: null, error: { kind: "no-steps-field" } };
  const rawSteps = sampler.inputs.steps;
  return {
    role: "edit",
    slots: {
      image,
      sampler: samplerId,
      prompt: texts[0]!,
      seedField: "noise_seed" in sampler.inputs ? "noise_seed" : "seed",
      stepsField: "steps",
      workflowSteps: typeof rawSteps === "number" && Number.isInteger(rawSteps) ? rawSteps : null,
    },
  };
}

/** Anweisung, Seed, Steps und den Namen der hochgeladenen Vorlage in eine **Kopie** setzen; alles andere bleibt.
 *  **Aufrufvertrag** wie bei `patchWorkflow`: `slots` stammt aus `classifyWorkflow` desselben Graphen. */
export function patchEdit(
  graph: ComfyGraph,
  slots: EditSlots,
  v: { prompt: string; seed: number; steps: number; imageName: string },
): ComfyGraph {
  const out = JSON.parse(JSON.stringify(graph)) as ComfyGraph;
  out[slots.prompt]!.inputs.text = v.prompt;
  out[slots.sampler]!.inputs[slots.seedField] = v.seed;
  out[slots.sampler]!.inputs[slots.stepsField] = v.steps;
  out[slots.image]!.inputs.image = v.imageName;
  return out;
}

/** Den Namen der hochgeladenen Vorlage und — falls vorhanden — die Maße der Zwischenskalierung in eine **Kopie**
 *  setzen. Die Maße sind die der Vorlage: die Zwischenskalierung soll das Bild nicht verändern, nur umlegen.
 *  **Aufrufvertrag** wie bei `patchEdit`. */
export function patchUpscale(
  graph: ComfyGraph,
  slots: UpscaleSlots,
  v: { imageName: string; width: number; height: number },
): ComfyGraph {
  const out = JSON.parse(JSON.stringify(graph)) as ComfyGraph;
  out[slots.image]!.inputs.image = v.imageName;
  if (slots.prescale !== null) {
    out[slots.prescale]!.inputs.width = v.width;
    out[slots.prescale]!.inputs.height = v.height;
  }
  return out;
}
