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

  it("signal: bricht die WARTESCHLEIFE ab, nachdem der Auftrag schon in der Queue liegt", async () => {
    // Die ehrliche Haelfte der Zusage: der Auftrag ist abgeschickt und ComfyUI rechnet ihn
    // fertig — wir hoeren nur auf hinzusehen. Gemessen daran, dass NACH dem Abbruch kein
    // weiterer /history-Poll mehr kommt; der POST dagegen ist bereits passiert.
    const ctl = new AbortController();
    const pending = { PID: { status: { status_str: "running" }, outputs: {} } };
    const { transport, calls } = stub({ historySteps: [pending, pending, pending] });
    const echterGetJson = transport.getJson;
    transport.getJson = async (url) => {
      ctl.abort(); // beim ERSTEN Poll abbrechen
      return echterGetJson(url);
    };
    await expect(
      new ComfyClient("http://x", WORKFLOW, transport).generate({ ...REQ, signal: ctl.signal }),
    ).rejects.toThrow(/abgebrochen|aborted/i);
    expect(calls.filter((c) => c.url.includes("/prompt"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes("/history"))).toHaveLength(1);
  });

  it("signal: schickt einen VORHER abgebrochenen Auftrag gar nicht erst in die Queue", async () => {
    const { transport, calls } = stub({ historySteps: [DONE] });
    await expect(
      new ComfyClient("http://x", WORKFLOW, transport).generate({ ...REQ, signal: AbortSignal.abort() }),
    ).rejects.toThrow(/abgebrochen|aborted/i);
    expect(calls).toHaveLength(0);
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

  describe("Fortschritts-Socket (optional, nur der Balken)", () => {
    /** Socket-Double: merkt sich Adresse und Reihenfolge gegenueber dem POST. */
    function mitSocket(opts: { wirft?: boolean } = {}) {
      const { transport, calls } = stub({ historySteps: [DONE] });
      const ereignisse: string[] = [];
      let onMessage: (data: string) => void = () => {};
      let geschlossen = 0;
      const post = transport.postJson;
      transport.postJson = async (u, b) => { ereignisse.push("post"); return post(u, b); };
      transport.openProgress = (url, cb) => {
        ereignisse.push(`open ${url}`);
        if (opts.wirft) throw new Error("Socket nicht moeglich");
        onMessage = cb;
        return { close: () => { geschlossen++; } };
      };
      return { transport, calls, ereignisse, senden: (d: string) => onMessage(d), geschlossen: () => geschlossen };
    }

    it("oeffnet den Socket VOR dem POST, mit derselben clientId, und schliesst ihn danach", async () => {
      const m = mitSocket();
      await new ComfyClient("http://127.0.0.1:8000", WORKFLOW, m.transport, { clientId: "CID", onProgress: () => {} }).generate(REQ);
      expect(m.ereignisse).toEqual(["open ws://127.0.0.1:8000/ws?clientId=CID", "post"]);
      expect(m.geschlossen()).toBe(1);
    });

    it("meldet value/max des eigenen Auftrags an onProgress, fremde nicht", async () => {
      const m = mitSocket();
      const got: unknown[] = [];
      const client = new ComfyClient("http://x", WORKFLOW, m.transport, { clientId: "CID", onProgress: (p) => got.push(p) });
      const hist = m.transport.getJson;
      m.transport.getJson = async (u) => {
        m.senden(JSON.stringify({ type: "progress", data: { value: 2, max: 6, prompt_id: "PID" } }));
        m.senden(JSON.stringify({ type: "progress", data: { value: 5, max: 6, prompt_id: "FREMD" } }));
        return hist(u);
      };
      await client.generate(REQ);
      expect(got).toEqual([{ value: 2, max: 6 }]);
    });

    it("schliesst den Socket auch, wenn der Lauf scheitert", async () => {
      const m = mitSocket();
      m.transport.postJson = async () => ({ status: 500, json: {} });
      await expect(new ComfyClient("http://x", WORKFLOW, m.transport, { clientId: "CID", onProgress: () => {} }).generate(REQ)).rejects.toThrow();
      expect(m.geschlossen()).toBe(1);
    });

    it("ein Socket, der sich nicht oeffnen laesst, beendet den Lauf nicht (Fallback: Polling)", async () => {
      const m = mitSocket({ wirft: true });
      const png = await new ComfyClient("http://x", WORKFLOW, m.transport, { clientId: "CID", onProgress: () => {} }).generate(REQ);
      expect(png).toBe("QkFTRTY0");
    });

    it("ohne clientId oder ohne openProgress im Transport wird kein Socket versucht", async () => {
      const m = mitSocket();
      await new ComfyClient("http://x", WORKFLOW, m.transport).generate(REQ);
      expect(m.ereignisse).toEqual(["post"]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Bearbeiten und Hochskalieren: Vorlage hochladen, Graph patchen, Ergebnisgröße aus dem PNG.
import { classifyWorkflow } from "../src/core/comfy/workflow";
import type { ActiveWorkflow } from "../src/core/comfy/library";
import flux3Edit from "../comfy/workflows/flux3-klein-edit.api.json";
import upscaleWf from "../comfy/workflows/upscale-4x-ultrasharp.api.json";

function active(file: string, graph: unknown): ActiveWorkflow {
  const c = classifyWorkflow(JSON.parse(JSON.stringify(graph)));
  if (c.role === null) throw new Error("fixture invalid");
  return { file, name: file, json: JSON.stringify(graph), ...c };
}
const EDIT = active("flux3-klein-edit.api.json", flux3Edit);
const UPSCALE = active("upscale-4x-ultrasharp.api.json", upscaleWf);

const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
function pngBytes(w: number, h: number): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0, 1, 2, 3, 4]);
}
const b64 = (b: Uint8Array): string => Buffer.from(b).toString("base64");

function stubWithUpload(opts: { uploadStatus?: number; resultBase64?: string; uploadJson?: unknown } = {}) {
  const base = stub({ historySteps: [DONE], base64: opts.resultBase64 ?? b64(pngBytes(64, 32)) });
  const uploads: { url: string; body: Uint8Array; contentType: string }[] = [];
  base.transport.postBytes = async (url, body, contentType) => {
    uploads.push({ url, body, contentType });
    return { status: opts.uploadStatus ?? 200, json: opts.uploadJson ?? { name: "lig-x.png", subfolder: "", type: "input" } };
  };
  return { ...base, uploads };
}
const latin1 = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join("");
const sentGraph = (calls: { url: string; body?: unknown }[]): Record<string, { inputs: Record<string, unknown> }> =>
  (calls.find((c) => c.url.endsWith("/prompt"))!.body as { prompt: Record<string, { inputs: Record<string, unknown> }> }).prompt;

describe("ComfyClient — Vorlage hochladen", () => {
  it("lädt per multipart an /upload/image, Name aus dem Inhalts-Hash, overwrite=true", async () => {
    const { transport, uploads } = stubWithUpload();
    const client = new ComfyClient("http://h:8000", "", transport);
    const png = pngBytes(10, 10);
    const name = await client.uploadImage(png);
    expect(name).toBe("lig-x.png");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.url).toBe("http://h:8000/upload/image");
    expect(uploads[0]!.contentType.startsWith("multipart/form-data; boundary=")).toBe(true);
    const body = latin1(uploads[0]!.body);
    expect(body).toMatch(/filename="lig-[0-9a-f]{16}\.png"/);
    expect(body).toContain('name="overwrite"\r\n\r\ntrue');
    expect(body).toContain('name="type"\r\n\r\ninput');
  });

  it("derselbe Inhalt ergibt denselben Dateinamen, anderer Inhalt einen anderen", async () => {
    const { transport, uploads } = stubWithUpload();
    const client = new ComfyClient("http://h:8000", "", transport);
    await client.uploadImage(pngBytes(10, 10));
    await client.uploadImage(pngBytes(10, 10));
    await client.uploadImage(pngBytes(11, 10));
    const names = uploads.map((u) => /filename="([^"]+)"/.exec(latin1(u.body))![1]);
    expect(names[0]).toBe(names[1]);
    expect(names[2]).not.toBe(names[0]);
  });

  it("ein Unterordner in der Antwort geht in den Namen ein", async () => {
    const { transport } = stubWithUpload({ uploadJson: { name: "a.png", subfolder: "sub", type: "input" } });
    expect(await new ComfyClient("http://h", "", transport).uploadImage(pngBytes(1, 1))).toBe("sub/a.png");
  });

  it("HTTP 500 beim Upload ist ein Fehler mit Status", async () => {
    const { transport } = stubWithUpload({ uploadStatus: 500 });
    await expect(new ComfyClient("http://h", "", transport).uploadImage(pngBytes(1, 1))).rejects.toThrow(/upload.*500/);
  });
});

describe("ComfyClient — Bearbeiten und Hochskalieren", () => {
  it("runEdit sendet Anweisung, Seed, Steps und den Upload-Namen, Größe kommt aus dem Ergebnis-PNG", async () => {
    const { transport, calls } = stubWithUpload();
    const r = await new ComfyClient("http://h", "", transport).runEdit(EDIT, { imagePng: pngBytes(1536, 896), prompt: "make it rain", seed: 5, steps: 12 });
    expect(r).toEqual({ base64: b64(pngBytes(64, 32)), width: 64, height: 32 });
    const g = sentGraph(calls);
    expect(g["4"]!.inputs.text).toBe("make it rain");
    expect(g["7"]!.inputs.seed).toBe(5);
    expect(g["7"]!.inputs.steps).toBe(12);
    expect(g["11"]!.inputs.image).toBe("lig-x.png");
  });

  it("runUpscale setzt die Zwischenskalierung auf die Maße der Vorlage", async () => {
    const { transport, calls } = stubWithUpload({ resultBase64: b64(pngBytes(2560, 1920)) });
    const r = await new ComfyClient("http://h", "", transport).runUpscale(UPSCALE, { imagePng: pngBytes(640, 480) });
    expect(r.width).toBe(2560);
    const g = sentGraph(calls);
    expect(g["6"]!.inputs.width).toBe(640);
    expect(g["6"]!.inputs.height).toBe(480);
    expect(g["1"]!.inputs.image).toBe("lig-x.png");
  });

  it("ein Ergebnis, das kein PNG ist, ist ein Fehler statt einer erfundenen Größe", async () => {
    const { transport } = stubWithUpload({ resultBase64: b64(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(40).fill(0)])) });
    await expect(new ComfyClient("http://h", "", transport).runUpscale(UPSCALE, { imagePng: pngBytes(4, 4) })).rejects.toThrow(/not a PNG/);
  });

  it("eine Vorlage, die kein PNG ist, wird vor dem Upload abgewiesen", async () => {
    const { transport, uploads } = stubWithUpload();
    await expect(new ComfyClient("http://h", "", transport).runUpscale(UPSCALE, { imagePng: new Uint8Array(40) })).rejects.toThrow(/init image is not a PNG/);
    expect(uploads).toHaveLength(0);
  });

  it("ein schon abgebrochenes Signal lädt nichts hoch", async () => {
    const { transport, uploads } = stubWithUpload();
    const ac = new AbortController();
    ac.abort();
    await expect(new ComfyClient("http://h", "", transport).runEdit(EDIT, { imagePng: pngBytes(4, 4), prompt: "x", seed: 1, steps: 1, signal: ac.signal })).rejects.toThrow(/aborted/);
    expect(uploads).toHaveLength(0);
  });

  it("eine Vorlage über 2048 px Kante wird vor dem Upload abgewiesen (das 4-fache Ergebnis sprengte die Base64-Strecke)", async () => {
    const { transport, uploads } = stubWithUpload();
    await expect(new ComfyClient("http://h", "", transport).runUpscale(UPSCALE, { imagePng: pngBytes(4032, 3024) })).rejects.toThrow(/4032.*2048/);
    expect(uploads).toHaveLength(0);
    // genau an der Grenze geht es
    await expect(new ComfyClient("http://h", "", transport).runUpscale(UPSCALE, { imagePng: pngBytes(2048, 1152) })).resolves.toBeDefined();
  });

  it("ein Workflow der falschen Rolle wird abgewiesen", async () => {
    const { transport } = stubWithUpload();
    await expect(new ComfyClient("http://h", "", transport).runEdit(UPSCALE, { imagePng: pngBytes(4, 4), prompt: "x", seed: 1, steps: 1 })).rejects.toThrow(/role/);
  });
});
