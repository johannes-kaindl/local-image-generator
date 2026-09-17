import { describe, expect, it } from "vitest";
import { localImageEndpoints, resolveImageEndpoint } from "../src/core/resolve-endpoint";
import { type EndpointConfig } from "../src/vendor/kit/endpoint_config";
import { type LlmEndpointManagerApi } from "../src/vendor/kit/endpoint-source";

const alwaysReachable = async (): Promise<boolean> => true;
const neverReachable = async (): Promise<boolean> => false;

describe("localImageEndpoints — der eine String als Fallback-Liste", () => {
  it("ein gesetzter Endpunkt wird zu einer Ein-Element-Liste", () => {
    expect(localImageEndpoints("http://127.0.0.1:7860")).toEqual([{ url: "http://127.0.0.1:7860" }]);
  });

  it("leer/whitespace bleibt eine leere Liste — kein leerer Eintrag", () => {
    expect(localImageEndpoints("")).toEqual([]);
    expect(localImageEndpoints("   ")).toEqual([]);
  });
});

/** Fake-Manager nach dem Vertrag von `LlmEndpointManagerApi` — reicht fuer die hier
 *  gebrauchten Methoden, die uebrigen sind No-ops (Vorbild: yijing-oracle
 *  tests/resolve-endpoint.test.ts). */
function fakeManager(opts: {
  resolve: LlmEndpointManagerApi["resolve"];
  materialize?: LlmEndpointManagerApi["materialize"];
}): LlmEndpointManagerApi {
  return {
    version: 1,
    list: () => [],
    get: () => null,
    resolve: opts.resolve,
    materialize: opts.materialize ?? (async () => ({ error: "not-found" })),
    models: async () => [],
    importEndpoints: async () => ({ added: [], merged: [], skipped: [] }),
    on: () => () => {},
  };
}

describe("resolveImageEndpoint — ohne Manager (Bestandsverhalten, EIN Feld fuer beide Rollen)", () => {
  it("Server-Rolle: liefert den lokalen Endpunkt", async () => {
    const r = await resolveImageEndpoint("server", {}, "http://127.0.0.1:7860", null, alwaysReachable);
    expect(r.kind).toBe("local");
    expect(r.config?.url).toBe("http://127.0.0.1:7860");
  });

  it("Comfy-Rolle liest DASSELBE lokale Feld — keine Migration, kein zweites Feld", async () => {
    const r = await resolveImageEndpoint("comfy", {}, "http://127.0.0.1:8188", null, alwaysReachable);
    expect(r.kind).toBe("local");
    expect(r.config?.url).toBe("http://127.0.0.1:8188");
  });

  it("kein erreichbarer Endpunkt -> config null, kein Wurf", async () => {
    const r = await resolveImageEndpoint("server", {}, "http://127.0.0.1:7860", null, neverReachable);
    expect(r.config).toBeNull();
  });

  it("leeres Feld -> config null (keine leere URL als Kandidat)", async () => {
    const r = await resolveImageEndpoint("server", {}, "", null, alwaysReachable);
    expect(r.config).toBeNull();
  });
});

describe("resolveImageEndpoint — mit Manager, zwei UNABHAENGIGE Rollen", () => {
  it("Server-Rolle bekommt den Manager-Endpunkt der Server-Wahl", async () => {
    const cfg: EndpointConfig = { url: "http://a1111-vom-manager:7860" };
    const manager = fakeManager({ resolve: async () => ({ id: "e-server", config: cfg, label: "A1111" }) });
    const r = await resolveImageEndpoint("server", { endpointId: "e-server" }, "http://lokal:7860", manager, alwaysReachable);
    expect(r.kind).toBe("manager");
    expect(r.config?.url).toBe("http://a1111-vom-manager:7860");
  });

  it("Comfy-Rolle bekommt eine ANDERE Wahl, unabhaengig von der Server-Rolle", async () => {
    const cfgComfy: EndpointConfig = { url: "http://comfy-vom-manager:8188" };
    const manager = fakeManager({
      materialize: async (id) =>
        id === "e-comfy" ? { id, config: cfgComfy, label: "ComfyUI" } : { error: "not-found" },
      resolve: async () => ({ error: "no-endpoint" }),
    });
    const r = await resolveImageEndpoint("comfy", { endpointId: "e-comfy" }, "http://lokal:8188", manager, alwaysReachable);
    expect(r.kind).toBe("manager");
    expect(r.config?.url).toBe("http://comfy-vom-manager:8188");
  });

  it("Manager ohne passenden Endpunkt: config null, reason gesetzt, KEIN lokaler Ruckfall", async () => {
    const manager = fakeManager({ resolve: async () => ({ error: "secret-missing" }) });
    const r = await resolveImageEndpoint("server", {}, "http://lokal:7860", manager, alwaysReachable);
    expect(r.kind).toBe("manager");
    expect(r.config).toBeNull();
    expect(r.reason).toBe("secret-missing");
  });

  it("beide Rollen rufen mit unterschiedlichem caller — sichtbar am Aufruf, nicht nur am Ergebnis", async () => {
    const seen: string[] = [];
    const manager = fakeManager({
      resolve: async (_capability, opts) => {
        seen.push(opts?.caller ?? "");
        return { error: "no-endpoint" };
      },
    });
    await resolveImageEndpoint("server", {}, "", manager, alwaysReachable);
    await resolveImageEndpoint("comfy", {}, "", manager, alwaysReachable);
    expect(seen).toEqual(["local-image-generator/server", "local-image-generator/comfy"]);
  });
});
