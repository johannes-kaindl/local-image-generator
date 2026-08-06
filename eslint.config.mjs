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
    // settings-tab.ts: sentence-case — der Server-Endpoint-Feld-Placeholder ist die
    // technische Beispiel-URL "http://127.0.0.1:7860" — die Regel verlangt dafür fälschlich
    // "HTTP://…" (falsches Protokoll-Casing). Kein UI-Label, sondern ein Literal-
    // Beispielwert; die Regel kennt diesen Fall nicht.
    //
    // ENTFERNT 2026-08-06 (0.5.1), nachdem die Datei auf das zweigleisige deklarative
    // Schema migriert wurde:
    // - `prefer-setting-definitions`: getSettingDefinitions() ist jetzt die einzige
    //   Definition, display() zeichnet sie nur nach. Der Override war der Grund, weshalb
    //   0.5.0 im Store-Review "Satisfactory" statt "Passed" bekam — ein per-file-Override
    //   macht `npm run lint` als Review-Vorschau blind (PROF-OBS-06).
    // - `@typescript-eslint/no-deprecated`: setWarning() ist längst durch applyDestructive
    //   ersetzt, setDynamicTooltip() durch displayFormat + Namens-Suffix. Übrig bleibt die
    //   display()-DEKLARATION, die die Regel nicht anmahnt (kein Aufruf) — belegt an
    //   vault-rag und 3d-codeblocks, die denselben Fallback ohne diesen Override fahren.
    files: ["src/obsidian/settings-tab.ts"],
    rules: {
      "obsidianmd/ui/sentence-case": "off",
    },
  },
);
