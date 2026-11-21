import { describe, expect, it } from "vitest";
import { activeEntry, entriesOf, libraryFrom } from "../src/core/comfy/library";
import flux3 from "../comfy/workflows/flux3-klein.api.json";
import flux3Edit from "../comfy/workflows/flux3-klein-edit.api.json";
import upscale from "../comfy/workflows/upscale-4x-ultrasharp.api.json";
import img2img from "./fixtures/comfy/sdxl_img2img_api.json";

const raw = (x: unknown): string => JSON.stringify(x);
const F = "W/flows";

describe("libraryFrom", () => {
  it("leerer Ordner-Name ist nicht konfiguriert", () => {
    expect(libraryFrom("  ", [])).toEqual({ kind: "unconfigured" });
  });

  it("fehlender Ordner", () => {
    expect(libraryFrom(F, null)).toEqual({ kind: "missing", folder: F });
  });

  it("nimmt nur direkte .json-Kinder, sortiert nach Dateiname, und urteilt je Datei", () => {
    const s = libraryFrom(F, [
      { path: `${F}/b.json`, raw: raw(flux3Edit) },
      { path: `${F}/a.api.json`, raw: raw(flux3) },
      { path: `${F}/c.txt`, raw: raw(flux3) },
      { path: `${F}/sub/d.json`, raw: raw(flux3) },
      { path: `${F}/kaputt.json`, raw: "{" },
      { path: `${F}/i2i.json`, raw: raw(img2img) },
    ]);
    expect(s.kind).toBe("ok");
    if (s.kind !== "ok") return;
    expect(s.entries.map((e) => [e.file, e.name, e.classified.role])).toEqual([
      ["a.api.json", "a", "txt2img"],
      ["b.json", "b", "edit"],
      ["i2i.json", "i2i", null],
      ["kaputt.json", "kaputt", null],
    ]);
    const bad = s.entries.find((e) => e.file === "kaputt.json");
    expect(bad?.classified).toEqual({ role: null, error: { kind: "json" } });
    const i2i = s.entries.find((e) => e.file === "i2i.json");
    expect(i2i?.classified).toEqual({ role: null, error: { kind: "img2img-unsupported" } });
  });

  it("ein Ordnerpfad mit Schrägstrich am Ende gilt wie ohne", () => {
    const s = libraryFrom(`${F}/`, [{ path: `${F}/a.json`, raw: raw(flux3) }]);
    expect(s.kind === "ok" && s.entries.length).toBe(1);
  });

  it("a.json und a.api.json erscheinen beide, der Dateiname unterscheidet sie", () => {
    const s = libraryFrom(F, [
      { path: `${F}/a.json`, raw: raw(flux3) },
      { path: `${F}/a.api.json`, raw: raw(flux3) },
    ]);
    expect(s.kind === "ok" && s.entries.map((e) => [e.file, e.name])).toEqual([
      ["a.api.json", "a"],
      ["a.json", "a"],
    ]);
  });
});

describe("entriesOf / activeEntry", () => {
  const lib = libraryFrom(F, [
    { path: `${F}/z-flux.api.json`, raw: raw(flux3) },
    { path: `${F}/a-flux.api.json`, raw: raw(flux3) },
    { path: `${F}/edit.api.json`, raw: raw(flux3Edit) },
    { path: `${F}/up.api.json`, raw: raw(upscale) },
    { path: `${F}/kaputt.json`, raw: "{" },
  ]);

  it("entriesOf liefert nur gültige Einträge der Rolle", () => {
    expect(entriesOf(lib, "txt2img").map((e) => e.file)).toEqual(["a-flux.api.json", "z-flux.api.json"]);
    expect(entriesOf(lib, "edit").map((e) => e.file)).toEqual(["edit.api.json"]);
    expect(entriesOf({ kind: "unconfigured" }, "txt2img")).toEqual([]);
  });

  it("activeEntry nimmt die gewählte Datei", () => {
    const a = activeEntry(lib, "txt2img", "z-flux.api.json");
    expect(a?.file).toBe("z-flux.api.json");
    expect(a?.role).toBe("txt2img");
    expect(a?.json).toBe(raw(flux3));
  });

  it("fehlt die gewählte Datei oder ist sie ungültig, gilt die erste gültige der Rolle", () => {
    expect(activeEntry(lib, "txt2img", "weg.json")?.file).toBe("a-flux.api.json");
    expect(activeEntry(lib, "txt2img", "kaputt.json")?.file).toBe("a-flux.api.json");
    expect(activeEntry(lib, "txt2img", "")?.file).toBe("a-flux.api.json");
  });

  it("eine Datei einer anderen Rolle wird nicht als Auswahl genommen", () => {
    expect(activeEntry(lib, "txt2img", "edit.api.json")?.file).toBe("a-flux.api.json");
  });

  it("ohne gültigen Workflow der Rolle null", () => {
    const only = libraryFrom(F, [{ path: `${F}/a.json`, raw: raw(flux3) }]);
    expect(activeEntry(only, "upscale", "")).toBeNull();
    expect(activeEntry({ kind: "missing", folder: F }, "txt2img", "")).toBeNull();
  });

  it("die Slots der Rolle kommen mit", () => {
    const e = activeEntry(lib, "edit", "");
    expect(e?.role === "edit" && e.slots.prompt).toBe("4");
    const u = activeEntry(lib, "upscale", "");
    expect(u?.role === "upscale" && u.slots.prescale).toBe("6");
  });
});
