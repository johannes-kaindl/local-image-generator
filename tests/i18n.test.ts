import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLang, t } from "../src/vendor/kit/i18n";
import { DE, EN, registerI18n } from "../src/i18n/strings";

beforeEach(() => {
  registerI18n();
  setLang("en");
});
afterEach(() => {
  setLang("en");
});

describe("registerI18n + t()", () => {
  it("returns the EN string for a known key by default", () => {
    expect(t("view.title")).toBe("Local Image Generator");
  });

  it("setLang('de') switches t() to the DE translation", () => {
    setLang("de");
    expect(t("view.title")).toBe("Lokaler Bildgenerator");
  });

  it("falls back to the key itself for a missing key", () => {
    expect(t("does.not.exist")).toBe("does.not.exist");
  });

  it("interpolates {0}/{1} positional args", () => {
    expect(t("notice.noteFailed", "img.png", "disk full")).toBe(
      "Image saved to img.png, but the note failed: disk full",
    );
    expect(t("history.recipe", 123, 4, "14:32")).toBe("seed 123 · 4 steps · 14:32");
  });

  it("leaves unmatched placeholders untouched when an arg is missing", () => {
    expect(t("notice.saveFailed")).toBe("Save failed: {0}");
  });
});

describe("EN/DE dictionaries", () => {
  it("define exactly the same set of keys (no drift between languages)", () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(EN).sort());
  });

  it("are both non-empty and cover core keys used across the plugin", () => {
    for (const key of ["cmd.open", "view.title", "generate.button.generate", "history.empty", "modal.cancel"]) {
      expect(EN[key]).toBeTruthy();
      expect(DE[key]).toBeTruthy();
    }
  });

  it("say on the model row that the download is stored per Obsidian profile and shared by all vaults", () => {
    expect(EN["settings.model.desc"]).toMatch(/profile/);
    expect(EN["settings.model.desc"]).toMatch(/all vaults/);
    expect(DE["settings.model.desc"]).toMatch(/Profil/);
    expect(DE["settings.model.desc"]).toMatch(/alle Vaults/);
  });
});
