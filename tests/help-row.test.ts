// Hilfe-Zeile (UI-STANDARD §8): erstes Element der Settings-Definitionen, beide URLs dieses Repos.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class Empty {}
  return {
    PluginSettingTab: class { constructor(public app: unknown, public plugin: unknown) {} },
    Setting: Empty, Notice: Empty, Modal: Empty, ButtonComponent: Empty, FuzzySuggestModal: Empty, TFile: Empty, AbstractInputSuggest: Empty, TFolder: Empty,
  };
});

import { LigSettingTab } from "../src/obsidian/settings-tab";
import { registerI18n } from "../src/i18n/strings";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { setLang } from "../src/vendor/kit/i18n";

function fakeSetting() {
  const calls = { name: "", desc: "", buttons: [] as { text: string; click: () => void }[], extra: [] as { icon: string; tip: string; click: () => void }[] };
  const setting: Record<string, unknown> = {};
  setting.setName = (n: string) => { calls.name = n; return setting; };
  setting.setDesc = (d: string) => { calls.desc = d; return setting; };
  setting.addButton = (cb: (b: unknown) => void) => {
    const rec = { text: "", click: () => {} };
    const b: Record<string, unknown> = {};
    b.setButtonText = (x: string) => { rec.text = x; return b; };
    b.onClick = (f: () => void) => { rec.click = f; return b; };
    cb(b); calls.buttons.push(rec); return setting;
  };
  setting.addExtraButton = (cb: (b: unknown) => void) => {
    const rec = { icon: "", tip: "", click: () => {} };
    const b: Record<string, unknown> = {};
    b.setIcon = (x: string) => { rec.icon = x; return b; };
    b.setTooltip = (x: string) => { rec.tip = x; return b; };
    b.onClick = (f: () => void) => { rec.click = f; return b; };
    cb(b); calls.extra.push(rec); return setting;
  };
  return { setting, calls };
}

describe("Hilfe-Zeile in den Settings", () => {
  beforeAll(() => { registerI18n(); setLang("en"); });

  const tab = () => new LigSettingTab({} as never, { settings: { ...DEFAULT_SETTINGS } } as never);

  it("ist das ERSTE Element von getSettingDefinitions()", () => {
    const defs = tab().getSettingDefinitions();
    const first = defs[0] as unknown as { name?: string; render?: unknown; type?: string };
    expect(first.type).toBeUndefined(); // keine Gruppe, keine Ueberschrift
    expect(first.name).toBe("Help");
    expect(typeof first.render).toBe("function");
    // und keine zweite Hilfe-Zeile weiter hinten
    expect(defs.filter((d) => (d as { name?: string }).name === "Help")).toHaveLength(1);
  });

  it("oeffnet Doku-Index und Issues dieses Repos", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const first = tab().getSettingDefinitions()[0] as unknown as { render: (s: unknown) => void };
    const { setting, calls } = fakeSetting();
    first.render(setting);
    expect(calls.buttons.map((b) => b.text)).toEqual(["Open documentation"]);
    expect(calls.extra.map((b) => [b.icon, b.tip])).toEqual([["bug", "Report an issue"]]);
    calls.buttons[0]!.click();
    calls.extra[0]!.click();
    expect(open.mock.calls.map((c) => c[0])).toEqual([
      "https://github.com/johannes-kaindl/local-image-generator/blob/main/docs/README.md",
      "https://github.com/johannes-kaindl/local-image-generator/issues",
    ]);
    vi.unstubAllGlobals();
  });

  it("hat deutsche Texte", () => {
    setLang("de");
    const first = tab().getSettingDefinitions()[0] as unknown as { name: string };
    expect(first.name).toBe("Hilfe");
    setLang("en");
  });
});
