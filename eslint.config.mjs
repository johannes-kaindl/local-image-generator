// Obsidian-Guideline-Gate: type-checked gegen ECHTE obsidian-Typen, plus der offizielle
// Store-Review-Linter (eslint-plugin-obsidianmd). Läuft im `gate`/`lint` lokal, damit
// Store-Findings HIER auffallen statt erst im Community-Store-Bot.
//
// KEIN Inline-`// eslint-disable` — der Store-Review verbietet sie. Genuin unvermeidbare
// Ausnahmen NUR als file-scoped Override unten, jeweils mit Begründung.
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  { ignores: ["main.js", "node_modules/"] },
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // settings-tab.ts (Stand Task 7, 2026-07-23):
    // (1) sentence-case: der Server-Endpoint-Feld-Placeholder ist die technische Beispiel-
    // URL "http://127.0.0.1:7860" — die Regel verlangt dafür fälschlich "HTTP://…"
    // (falsches Protokoll-Casing). Kein UI-Label, sondern ein Literal-Beispielwert; die
    // Regel kennt diesen Fall nicht.
    // NICHT mehr Teil der Begründung: Modell-EIGENNAMEN (SD-Turbo, FLUX.2) — die
    // Download-/mflux-Sektionen samt ihrer Labels sind mit dem Thin-Client-Umbau entfallen.
    //
    // (2) prefer-setting-definitions: die Legacy-Cache-Zeile (Spec §4) wird NACH einem
    // asynchronen hasLegacyCache()-Check bedingt angehängt und nach dem Löschen wieder aus
    // dem DOM entfernt (display()) — state-getrieben, nicht auf das deklarative
    // getSettingDefinitions()-Schema abbildbar → display() bleibt.
    // NICHT mehr Teil der Begründung: die alten Download-Zeilen (refreshModel(), Task 5
    // entfallen) — der ursprüngliche Auslöser dieses Overrides ist weg, aber die
    // Legacy-Cache-Zeile braucht ihn aus demselben strukturellen Grund weiter.
    //
    // NICHT mehr Teil der Begründung: die einklappbaren Sektionen (2026-07-20 entfernt)
    // und "minAppVersion 1.8.7 < 1.13.0". Letzteres war sachlich falsch — obsidian.d.ts:6630
    // sieht display() ausdrücklich als Fallback für <1.13 vor, Koexistenz hebt den Floor
    // nicht an (PROF-OBS-06).
    files: ["src/obsidian/settings-tab.ts"],
    rules: {
      "obsidianmd/ui/sentence-case": "off",
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      // display()/setWarning()/setDynamicTooltip() sind ab 1.13 deprecated, aber ihre
      // Ersätze (getSettingDefinitions/setDestructive/inline-Slider-Wert) verlangen 1.13
      // (obsidianmd/no-unsupported-api). Bei minAppVersion 1.8.7 sind die klassischen APIs
      // die einzige lauffähige Wahl — die Deprecation-Hinweise sind hier versionsbedingt.
      "@typescript-eslint/no-deprecated": "off",
    },
  },
);
