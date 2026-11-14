// Spiegel-URL im Settings-Tab: nur https oder lokales http; ein abgelehnter Wert wird gesagt und zurückgestellt (Welle 34).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const notices = vi.hoisted(() => [] as string[]);
vi.mock("obsidian", () => {
  class Empty {}
  return {
    PluginSettingTab: class { constructor(public app: unknown, public plugin: unknown) {} },
    Notice: class { constructor(msg: string) { notices.push(msg); } },
    Setting: Empty, Modal: Empty, ButtonComponent: Empty, FuzzySuggestModal: Empty, TFile: Empty, AbstractInputSuggest: Empty, TFolder: Empty,
  };
});

import { LigSettingTab } from "../src/obsidian/settings-tab";
import { registerI18n } from "../src/i18n/strings";
import { DEFAULT_SETTINGS, type LigSettings } from "../src/core/settings";
import { setLang } from "../src/vendor/kit/i18n";

describe("Einstellung „Download-Quelle“ (assetBaseUrl)", () => {
  beforeAll(() => { registerI18n(); setLang("en"); });
  beforeEach(() => { notices.length = 0; });

  function build(start: string) {
    const plugin = { settings: { ...DEFAULT_SETTINGS, assetBaseUrl: start } as LigSettings, saveSettings: vi.fn(async () => {}) };
    const tab = new LigSettingTab({} as never, plugin as never);
    const refresh = vi.fn();
    (tab as unknown as { refreshUi: () => void }).refreshUi = refresh;
    return { plugin, tab, refresh };
  }

  it("nimmt https und lokales http an, ohne Meldung", async () => {
    const { plugin, tab, refresh } = build("http://127.0.0.1:7862");
    await tab.setControlValue("assetBaseUrl", "  https://mirror.example.org/models/ ");
    expect(plugin.settings.assetBaseUrl).toBe("https://mirror.example.org/models/");
    await tab.setControlValue("assetBaseUrl", "http://localhost:7862");
    expect(plugin.settings.assetBaseUrl).toBe("http://localhost:7862");
    expect(notices).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("lehnt http auf fremdem Host ab: bisheriger Wert bleibt, Meldung, Feld wird neu gezeichnet", async () => {
    const { plugin, tab, refresh } = build("https://mirror.example.org");
    await tab.setControlValue("assetBaseUrl", "http://mirror.example.org");
    expect(plugin.settings.assetBaseUrl).toBe("https://mirror.example.org");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/not accepted/);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ein leeres Feld setzt auf den Default zurück, ohne Ablehnungsmeldung", async () => {
    const { plugin, tab } = build("https://mirror.example.org");
    await tab.setControlValue("assetBaseUrl", "   ");
    expect(plugin.settings.assetBaseUrl).toBe(DEFAULT_SETTINGS.assetBaseUrl);
    expect(notices).toEqual([]);
  });
});
