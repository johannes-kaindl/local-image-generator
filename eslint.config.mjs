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
    // settings-tab.ts: (1) nennt Modell-EIGENNAMEN (SD-Turbo, FLUX.2) in UI-Labels — die
    // sentence-case-Regel würde daraus fälschlich "Sd-turbo" machen. (2) Das UI nutzt
    // einklappbare Sektionen + state-getriebene Download-Zeilen mit partiellem Re-Render,
    // die nicht auf das deklarative getSettingDefinitions()-Schema abbildbar sind
    // (minAppVersion 1.8.7 < 1.13.0 unterstützt es ohnehin nicht) → display() bleibt.
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
