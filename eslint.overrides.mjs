// Repo-eigene ESLint-Abweichungen — der EINZIGE Ort dafuer. Der Kern
// (eslint.config.mjs) ist template-verwaltet, Inline-disables blockt das Lint-Gate.
// Jeder Override braucht eine Begruendung im Kommentar.
//
// Zwei Klassen, zwei Preise (Details: _docs/docs/obsidian-plugin-publishing.md):
// - Kosmetik-/Benennungsregeln (z. B. ui/sentence-case bei Eigennamen/API-Namen):
//   Override ist die richtige Antwort und kostet nichts — der Scanner hat keinen
//   Mangel gefunden, sondern eine Konvention falsch angelegt.
// - Faehigkeitsregeln (z. B. settings-tab/prefer-setting-definitions): der Scanner
//   bewertet den Mangel, nicht die Begruendung — ein Override hier ist gestundete
//   Schuld und kostet die Store-Wertung ("Satisfactory" statt "Passed").
//   Marker fuer solche Faelle: `// STORE-SCHULD:` + wo die Abloesung geplant ist.
export default [
  {
    // Type-aware Linting braucht das Build-tsconfig des Repos. Achtung Falle
    // (json_viewer 1.9.0): ein obsidian→Mock-paths-Alias im referenzierten tsconfig
    // laesst die type-aware Regeln auf einen losen Mock aufloesen → no-unsafe-*-Kaskade.
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
    // technische Beispiel-URL "http://127.0.0.1:7860" — die Regel verlangt dafuer
    // faelschlich "HTTP://…" (falsches Protokoll-Casing). Kein UI-Label, sondern ein
    // Literal-Beispielwert; die Regel kennt diesen Fall nicht.
    //
    // ENTFERNT 2026-08-06 (0.5.1), nachdem die Datei auf das zweigleisige deklarative
    // Schema migriert wurde (aus der Alt-Config uebernommen, weiterhin gueltig):
    // - `prefer-setting-definitions`: getSettingDefinitions() ist jetzt die einzige
    //   Definition, display() zeichnet sie nur nach. Der Override war der Grund, weshalb
    //   0.5.0 im Store-Review "Satisfactory" statt "Passed" bekam — ein per-file-Override
    //   macht `npm run lint` als Review-Vorschau blind (PROF-OBS-06).
    // - `@typescript-eslint/no-deprecated`: setWarning() ist laengst durch applyDestructive
    //   ersetzt, setDynamicTooltip() durch displayFormat + Namens-Suffix. Uebrig bleibt die
    //   display()-DEKLARATION, die die Regel nicht anmahnt (kein Aufruf) — belegt an
    //   vault-rag und 3d-codeblocks, die denselben Fallback ohne diesen Override fahren.
    files: ["src/obsidian/settings-tab.ts"],
    rules: {
      "obsidianmd/ui/sentence-case": "off",
    },
  },
];
