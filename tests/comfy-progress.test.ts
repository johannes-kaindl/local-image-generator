import { describe, expect, it } from "vitest";
import { comfyProgressSocketUrl, parseComfyProgress } from "../src/core/comfy/progress";

const msg = (data: unknown, type = "progress") => JSON.stringify({ type, data });

describe("parseComfyProgress", () => {
  it("liest value/max einer progress-Nachricht des eigenen Auftrags", () => {
    expect(parseComfyProgress(msg({ value: 3, max: 20, prompt_id: "P", node: "5" }), "P")).toEqual({ value: 3, max: 20 });
  });
  it("ignoriert Nachrichten eines fremden Auftrags (geteilte Queue)", () => {
    expect(parseComfyProgress(msg({ value: 3, max: 20, prompt_id: "FREMD" }), "P")).toBeNull();
  });
  it("nimmt eine Nachricht ohne prompt_id (aelteres ComfyUI) an", () => {
    expect(parseComfyProgress(msg({ value: 1, max: 4 }), "P")).toEqual({ value: 1, max: 4 });
  });
  it("ignoriert andere Typen, Binaerrahmen und kaputtes JSON, ohne zu werfen", () => {
    expect(parseComfyProgress(msg({ value: 1, max: 4 }, "executing"), "P")).toBeNull();
    expect(parseComfyProgress("{kaputt", "P")).toBeNull();
    expect(parseComfyProgress("", "P")).toBeNull();
  });
  it("verwirft unsinnige Zahlen (max 0, value > max, nicht endlich, falscher Typ)", () => {
    expect(parseComfyProgress(msg({ value: 1, max: 0 }), "P")).toBeNull();
    expect(parseComfyProgress(msg({ value: 5, max: 4 }), "P")).toBeNull();
    expect(parseComfyProgress(msg({ value: "1", max: 4 }), "P")).toBeNull();
    expect(parseComfyProgress(msg({ value: -1, max: 4 }), "P")).toBeNull();
  });
});

describe("comfyProgressSocketUrl", () => {
  it("macht aus http ws und aus https wss und haengt clientId an", () => {
    expect(comfyProgressSocketUrl("http://127.0.0.1:8188", "c 1")).toBe("ws://127.0.0.1:8188/ws?clientId=c%201");
    expect(comfyProgressSocketUrl("https://comfy.example/", "x")).toBe("wss://comfy.example/ws?clientId=x");
  });
  it("gibt null zurueck, wenn die URL kein http(s) ist", () => {
    expect(comfyProgressSocketUrl("ftp://x", "c")).toBeNull();
  });
});
