// uebernommen aus yijing-oracle/tests/comfy-client.test.ts, 2026-09-06
import { describe, expect, it } from "vitest";
import { ComfyClient, type ComfyTransport } from "../src/core/comfy/client";
import { type ImageRequest } from "../src/core/txt2img";
import sdxl from "./fixtures/comfy-sdxl.json";

// KSampler-Graph aus tests/comfy-workflow.test.ts (Task 3, Step 1, dritter Fall) — hier
// wiederholt statt importiert, weil der Test einen minimalen, unabhaengigen Graphen braucht.
const MINIMAL_GRAPH = {
  "1": { class_type: "KSampler", inputs: { positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], seed: 1, steps: 6 } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "" } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "" } },
  "4": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } },
};

const WORKFLOW = JSON.stringify(sdxl);
// Anders als in der Quelle ist `steps` hier nicht nullable — ein konkreter Wert statt
// `null`. Bewusst 9 statt 6: die Fixture (tests/fixtures/comfy-sdxl.json) traegt selbst
// "steps": 6 am Sampler — mit gleichem Wert wuerde Test 1 unten auch dann gruen bleiben,
// wenn client.ts steps gar nicht an patchWorkflow reichte und der Fixture-Wert stehen
// bliebe. Nur ein abweichender Wert belegt, dass wirklich der Request-Wert geschrieben wird.
const REQ: ImageRequest = {
  prompt: "a lake", negativePrompt: "text", width: 768, height: 768, steps: 9, seed: 42,
  cfg: 7, initImageData: null, denoising: null,
};

/** Baut einen Transport-Stub. `historySteps` wird pro Poll-Aufruf der Reihe nach geliefert. */
function stub(opts: {
  promptResponse?: { status: number; json: unknown };
  historySteps?: unknown[];
  base64?: string;
}) {
  const calls: { url: string; body?: unknown }[] = [];
  let poll = 0;
  const history = opts.historySteps ?? [];
  const transport: ComfyTransport = {
    postJson: async (url, body) => {
      calls.push({ url, body });
      return opts.promptResponse ?? { status: 200, json: { prompt_id: "PID", node_errors: {} } };
    },
    getJson: async (url) => {
      calls.push({ url });
      const step = history[Math.min(poll, history.length - 1)];
      poll++;
      return { status: 200, json: step };
    },
    getBase64: async (url) => {
      calls.push({ url });
      return { status: 200, base64: opts.base64 ?? "QkFTRTY0" };
    },
    sleep: async () => {},
    now: (() => { let t = 0; return () => (t += 1000); })(),
  };
  return { transport, calls };
}

const DONE = {
  PID: {
    status: { status_str: "success", completed: true, messages: [] },
    outputs: { "9": { images: [{ filename: "x.png", subfolder: "", type: "output" }] } },
  },
};

describe("ComfyClient", () => {
  it("sendet den gepatchten Workflow und liefert das Bild als Base64", async () => {
    const { transport, calls } = stub({ historySteps: [DONE] });
    const client = new ComfyClient("http://127.0.0.1:8000/", WORKFLOW, transport, { clientId: "CID" });
    const png = await client.generate(REQ);

    expect(png).toBe("QkFTRTY0");
    expect(calls[0]!.url).toBe("http://127.0.0.1:8000/prompt");
    const body = calls[0]!.body as { prompt: Record<string, { inputs: Record<string, unknown> }>; client_id: string };
    expect(body.client_id).toBe("CID");
    expect(body.prompt["6"]!.inputs.text).toBe("a lake");
    expect(body.prompt["3"]!.inputs.seed).toBe(42);
    // 9 statt der Fixture-eigenen 6: nur so belegt die Zeile, dass REQ.steps wirklich
    // an patchWorkflow durchgereicht wird, statt zufaellig mit dem Fixture-Wert zu matchen.
    expect(body.prompt["3"]!.inputs.steps).toBe(9);
  });

  it("pollt, bis outputs da sind", async () => {
    const pending = { PID: { status: { status_str: "running", completed: false, messages: [] }, outputs: {} } };
    const { transport, calls } = stub({ historySteps: [pending, pending, DONE] });
    await new ComfyClient("http://x", WORKFLOW, transport).generate(REQ);
    expect(calls.filter((c) => c.url.includes("/history/")).length).toBe(3);
  });

  it("reicht subfolder und type aus der Antwort an /view durch", async () => {
    const preview = {
      PID: {
        status: { status_str: "success", completed: true, messages: [] },
        outputs: { "9": { images: [{ filename: "y.png", subfolder: "sub", type: "temp" }] } },
      },
    };
    const { transport, calls } = stub({ historySteps: [preview] });
    await new ComfyClient("http://x", WORKFLOW, transport).generate(REQ);
    const view = calls.find((c) => c.url.includes("/view"))!;
    expect(view.url).toContain("filename=y.png");
    expect(view.url).toContain("subfolder=sub");
    expect(view.url).toContain("type=temp");
  });

  it("wirft mit Server-Klartext, wenn ComfyUI den Workflow ablehnt", async () => {
    const { transport } = stub({
      promptResponse: { status: 400, json: { error: { message: "model not found" } } },
    });
    await expect(new ComfyClient("http://x", WORKFLOW, transport).generate(REQ))
      .rejects.toThrow(/model not found/);
  });

  it("wirft bei node_errors trotz HTTP 200", async () => {
    const { transport } = stub({
      promptResponse: { status: 200, json: { prompt_id: "PID", node_errors: { "3": ["bad input"] } } },
    });
    await expect(new ComfyClient("http://x", WORKFLOW, transport).generate(REQ)).rejects.toThrow();
  });

  it("wirft bei einem Ausführungsfehler aus der History", async () => {
    const failed = {
      PID: {
        status: { status_str: "error", completed: false,
                  messages: [["execution_error", { exception_message: "OOM on device" }]] },
        outputs: {},
      },
    };
    const { transport } = stub({ historySteps: [failed] });
    await expect(new ComfyClient("http://x", WORKFLOW, transport).generate(REQ))
      .rejects.toThrow(/OOM on device/);
  });

  // I1 (Final-Review 2026-09-06): der /history-Poll ist der ERGEBNISkanal, nicht die
  // Fortschrittsanzeige. `comfyTransport().getJson` faehrt mit 3 s Zeitlimit und WIRFT beim
  // Ablauf — ein einziger langsamer Poll (ComfyUI stallt seinen Loop beim Modell-Laden und
  // beim VAE-Decode grosser Bilder) beendete damit den ganzen Lauf, waehrend das Bild auf
  // dem Server fertig war. Dieselbe Doktrin wie beim A1111-Fortschritt: „Timeout und 5xx
  // sind voruebergehend und pollen weiter"; die Notbremse ist die Deadline der Schleife.
  it("pollt nach einem geworfenen /history-Aufruf weiter, statt den Lauf zu beenden", async () => {
    const { transport } = stub({ historySteps: [DONE] });
    let versuche = 0;
    const original = transport.getJson;
    transport.getJson = async (url) => {
      versuche++;
      if (versuche === 1) throw new Error("timeout after 3000 ms");
      return original(url);
    };
    const png = await new ComfyClient("http://x", WORKFLOW, transport).generate(REQ);
    expect(png).toBe("QkFTRTY0");
    expect(versuche).toBeGreaterThan(1);
  });

  it("bricht trotz geworfener Polls an der Deadline ab — der Fehler wird nicht verschluckt", async () => {
    const { transport } = stub({ historySteps: [DONE] });
    transport.getJson = async () => { throw new Error("timeout after 3000 ms"); };
    const client = new ComfyClient("http://x", WORKFLOW, transport, { timeoutMs: 3000 });
    // Auf die EIGENE Meldung geprueft, nicht auf /timeout/i: die geworfene Transport-Meldung
    // lautet ebenfalls „timeout after 3000 ms" — ein unspezifisches Muster waere von einem
    // durchgereichten Transport-Fehler nicht zu unterscheiden und damit blind fuer genau den
    // Defekt, gegen den der Test steht.
    await expect(client.generate(REQ)).rejects.toThrow(/comfy: timeout after/);
  });

  it("wirft nach Ablauf des Timeouts", async () => {
    const pending = { PID: { status: { status_str: "running", completed: false, messages: [] }, outputs: {} } };
    const { transport } = stub({ historySteps: [pending] });
    const client = new ComfyClient("http://x", WORKFLOW, transport, { timeoutMs: 3000 });
    await expect(client.generate(REQ)).rejects.toThrow(/timeout/i);
  });

  it("wirft mit klarer Meldung, wenn kein Workflow hinterlegt ist", async () => {
    const { transport } = stub({ historySteps: [DONE] });
    await expect(new ComfyClient("http://x", "", transport).generate(REQ)).rejects.toThrow(/workflow/i);
  });

  it("wirft, wenn der Graph mehrdeutig ist", async () => {
    const two = JSON.parse(WORKFLOW);
    two["11"] = { class_type: "KSampler", inputs: {
      seed: 1, steps: 5, positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } };
    const { transport } = stub({ historySteps: [DONE] });
    await expect(new ComfyClient("http://x", JSON.stringify(two), transport).generate(REQ))
      .rejects.toThrow();
  });

  it("meldet Fortschritt, wenn ein Progress-Kanal übergeben wurde", async () => {
    const seen: { value: number; max: number }[] = [];
    const { transport } = stub({ historySteps: [DONE] });
    const client = new ComfyClient("http://x", WORKFLOW, transport, {
      onProgress: (p) => seen.push(p),
    });
    client.reportProgress({ value: 3, max: 8 });
    await client.generate(REQ);
    expect(seen).toEqual([{ value: 3, max: 8 }]);
  });

  it("ignoriert cfg, initImageData und denoising", async () => {
    const gesendet: unknown[] = [];
    const transport: ComfyTransport = {
      postJson: async (_u, body) => { gesendet.push(body); return { status: 200, json: { prompt_id: "p1" } }; },
      getJson: async () => ({ status: 200, json: { p1: { status: { status_str: "success" }, outputs: { "9": { images: [{ filename: "a.png", subfolder: "", type: "output" }] } } } } }),
      getBase64: async () => ({ status: 200, base64: "AAAA" }),
      sleep: async () => {},
      now: () => 0,
    };
    const client = new ComfyClient("http://127.0.0.1:8188", JSON.stringify(MINIMAL_GRAPH), transport);
    const png = await client.generate({
      prompt: "x", negativePrompt: "", width: 512, height: 512, steps: 6, seed: 1,
      cfg: 7, initImageData: "SOLLTE-NICHT-ANKOMMEN", denoising: 0.5,
    });
    expect(png).toBe("AAAA");
    const body = JSON.stringify(gesendet[0]);
    expect(body).not.toContain("SOLLTE-NICHT-ANKOMMEN");
    expect(body).not.toContain("denoising");
    expect(body).not.toContain("cfg");
  });
});
