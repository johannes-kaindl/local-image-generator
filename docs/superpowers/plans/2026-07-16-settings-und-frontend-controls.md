# Settings & Frontend-Controls (0.2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die wiederkehrenden Handgriffe aus dem Smoke-Test verschwinden — Stil-Presets statt Tippen, Seed-Sperre statt Neu-Würfeln, Prompt-Historie statt Erinnern, Create-as-note statt Handarbeit.

**Architecture:** Pure-Kern zuerst (`src/core/`, node-testbar, kein `obsidian`-Import), dann die Obsidian-Schicht darüber. Drei Bausteine werden aus Nachbar-Repos **vendored** statt neu gebaut: der Frontmatter-Serializer (vault-rag), `FolderSuggest` (vault-rag), `collapsibleSection` (obsidian-kit). Das Prompt-Textfeld bleibt die einzige Wahrheit für den Prompt; Chip-Zustände werden daraus abgeleitet, nie parallel geführt.

**Tech Stack:** TypeScript · Obsidian-Plugin-API · vitest · esbuild

**Spec:** `docs/superpowers/specs/2026-07-16-settings-und-frontend-controls-design.md`

## Global Constraints

- **Gate:** `npm run gate` (typecheck + vitest + check:pure + build) muss vor jedem Commit grün sein.
- **Pure-Core-Schnitt:** `src/core/` und `src/vendor/kit/` importieren **nie** `obsidian`. Erzwungen von `scripts/check-pure.mjs`. Alles, was `obsidian` importiert, gehört nach `src/obsidian/`.
- **UI-Texte** ausschließlich über `STRINGS` in `src/core/strings.ts` — Englisch, sentence case. Keine Literale im UI-Code.
- **CSS:** nur Obsidian-Theme-Variablen, Präfix `lig-` (UI-STANDARD §3). Ausnahme: vendorte Kit-Klassen behalten ihr `okit-`-Präfix.
- **Settings-Reihenfolge** (UI-STANDARD §5): Modell zuerst, Gefährliches ans Ende.
- **Commits:** Conventional Commits, deutsch, mit `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Tests:** liegen flach in `tests/<modul>.test.ts`. Keine `vitest.config.ts` vorhanden — nicht anlegen. Nur der Pure-Kern wird getestet; die Obsidian-Schicht (Suggest, Menu, Collapsible, Editor-DOM) bleibt ungetestet, dort liegt keine Entscheidungslogik.
- **Vendored-Dateien** tragen im Kopf einen Kommentar mit Quelle, Datum und Abweichungen vom Original.

---

### Task 1: Settings-Datenmodell erweitern

**Files:**
- Modify: `src/core/settings.ts` (komplett ersetzen)
- Modify: `tests/settings.test.ts:7-9` (bricht sonst — prüft `toEqual({ outputFolder: "" })`)
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: `mergeSettings` aus `src/vendor/kit/settings.ts` (unverändert)
- Produces: `LigSettings` (Felder: `outputFolder`, `noteFolder`, `defaultSteps`, `createMode`, `presets`, `promptHistory`, `sectionsCollapsed`), `StylePreset` (`{id, label, suffix}`), `DEFAULT_SETTINGS`, `DEFAULT_PRESETS`

> **Achtung, echte Falle:** `mergeSettings` klont Arrays nur mit `value.slice()` — die **Preset-Objekte darin bleiben Referenzen auf `DEFAULT_PRESETS`**. Beim ersten Start (kein `presets` in `data.json`) zeigt `settings.presets[0]` also auf dasselbe Objekt wie `DEFAULT_PRESETS[0]`. Wer ein Preset in-place mutiert (`p.label = "x"`), verändert damit die Modul-Konstante. Deshalb gilt in Task 14: Presets werden **immer immutabel ersetzt** (`map` + Spread), nie in-place geändert.

- [ ] **Step 1: Test anpassen und erweitern**

Ersetze `tests/settings.test.ts` vollständig:

```ts
import { describe, expect, it } from "vitest";
import { mergeSettings } from "../src/vendor/kit/settings";
import { DEFAULT_SETTINGS, DEFAULT_PRESETS, type LigSettings } from "../src/core/settings";

describe("settings", () => {
  it("liefert Defaults bei null/undefined raw", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(DEFAULT_SETTINGS, undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("übernimmt gespeicherte Werte und behält unbekannte Felder (Forward-Compat)", () => {
    const merged = mergeSettings<LigSettings>(DEFAULT_SETTINGS, { outputFolder: "Art", future: 1 } as unknown);
    expect(merged.outputFolder).toBe("Art");
    expect((merged as unknown as Record<string, unknown>)["future"]).toBe(1);
  });

  it("teilt keine Referenzen mit dem Defaults-Objekt", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {});
    expect(merged).not.toBe(DEFAULT_SETTINGS);
    expect(merged.presets).not.toBe(DEFAULT_SETTINGS.presets);
  });

  it("migriert eine 0.1-data.json ohne Migrationscode (fehlende Felder aus Defaults)", () => {
    const merged = mergeSettings<LigSettings>(DEFAULT_SETTINGS, { outputFolder: "Art" });
    expect(merged.noteFolder).toBe("");
    expect(merged.defaultSteps).toBe(4);
    expect(merged.createMode).toBe("image");
    expect(merged.promptHistory).toEqual([]);
    expect(merged.presets).toHaveLength(DEFAULT_PRESETS.length);
    expect(merged.sectionsCollapsed).toEqual({});
  });

  it("liefert Presets mit eindeutigen IDs", () => {
    const ids = DEFAULT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — `DEFAULT_PRESETS` ist kein Export von `src/core/settings.ts`.

- [ ] **Step 3: Settings implementieren**

Ersetze `src/core/settings.ts` vollständig:

```ts
// Plugin-Settings — pure (Spec §5.1). Leerer outputFolder = Obsidians Attachment-Logik,
// leerer noteFolder = Notiz landet neben dem Bild.

/** Ein Stil-Baustein, der per Chip an den Prompt gehängt wird. */
export interface StylePreset {
  /** Stabil über Umbenennungen hinweg — identifiziert die Zeile im Editor. */
  id: string;
  /** Chip-Beschriftung. */
  label: string;
  /** Wird an den Prompt gehängt; darf selbst kommasepariert mehrteilig sein. */
  suffix: string;
}

export interface LigSettings {
  outputFolder: string;
  noteFolder: string;
  /** Startwert des Steps-Sliders (1..4) — kein Zwang, wird nicht zurückgeschrieben. */
  defaultSteps: number;
  /** Was der Create-Button tut: nur Bild (0.1-Verhalten) oder Bild + Notiz. */
  createMode: "image" | "note";
  presets: StylePreset[];
  /** MRU, neueste zuerst. Zustand, kein Regler — data.json ist der einzige Speicher. */
  promptHistory: string[];
  /** Auf-/Zu-Zustand der Settings-Sektionen, Key → collapsed. */
  sectionsCollapsed: Record<string, boolean>;
}

export const DEFAULT_PRESETS: StylePreset[] = [
  { id: "sumi-e", label: "Sumi-e", suffix: "sumi-e painting, monochrome ink" },
  { id: "watercolor", label: "Watercolor", suffix: "watercolor painting, soft washes" },
  { id: "photo", label: "Photo", suffix: "photograph, natural light, sharp focus" },
  { id: "oil", label: "Oil", suffix: "oil painting, visible brush strokes" },
];

export const DEFAULT_SETTINGS: LigSettings = {
  outputFolder: "",
  noteFolder: "",
  defaultSteps: 4,
  createMode: "image",
  presets: DEFAULT_PRESETS,
  promptHistory: [],
  sectionsCollapsed: {},
};
```

- [ ] **Step 4: Test laufen lassen — muss grün sein**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS (5 Tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/settings.ts tests/settings.test.ts
git commit -m "$(cat <<'EOF'
feat(settings): Datenmodell für Presets, Notiz-Ziel, Create-Modus und Historie

Migration braucht keinen Code — mergeSettings legt fehlende Felder aus den
Defaults auf; bestehende 0.1-data.json laufen unverändert weiter (Test deckt das ab).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Prompt-Historie (pure)

**Files:**
- Create: `src/core/history.ts`
- Test: `tests/history.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces: `HISTORY_LIMIT: number`, `pushHistory(list: readonly string[], prompt: string): string[]`, `historyLabel(prompt: string, max?: number): string`

- [ ] **Step 1: Failing test schreiben**

Erzeuge `tests/history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HISTORY_LIMIT, historyLabel, pushHistory } from "../src/core/history";

describe("pushHistory", () => {
  it("nimmt den ersten Prompt auf", () => {
    expect(pushHistory([], "an apple")).toEqual(["an apple"]);
  });

  it("stellt Neues nach vorn", () => {
    expect(pushHistory(["a"], "b")).toEqual(["b", "a"]);
  });

  it("verschiebt ein Duplikat nach vorn statt es zu doppeln", () => {
    expect(pushHistory(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("trimmt den Prompt und erkennt das Duplikat trotz Whitespace", () => {
    expect(pushHistory(["a"], "  a  ")).toEqual(["a"]);
  });

  it("ignoriert leere und reine Whitespace-Prompts", () => {
    expect(pushHistory(["a"], "")).toEqual(["a"]);
    expect(pushHistory(["a"], "   ")).toEqual(["a"]);
  });

  it("schneidet am Limit ab und wirft den ältesten weg", () => {
    const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => `p${i}`);
    const next = pushHistory(full, "neu");
    expect(next).toHaveLength(HISTORY_LIMIT);
    expect(next[0]).toBe("neu");
    expect(next).not.toContain(`p${HISTORY_LIMIT - 1}`);
  });

  it("mutiert die Eingabeliste nicht", () => {
    const list = ["a"];
    pushHistory(list, "b");
    expect(list).toEqual(["a"]);
  });
});

describe("historyLabel", () => {
  it("lässt kurze Prompts unverändert", () => {
    expect(historyLabel("an apple")).toBe("an apple");
  });

  it("kürzt lange Prompts mit Ellipse", () => {
    const label = historyLabel("x".repeat(80), 10);
    expect(label).toBe("xxxxxxxxx…");
    expect(label).toHaveLength(10);
  });

  it("ersetzt Zeilenumbrüche durch Leerzeichen", () => {
    expect(historyLabel("a\nb")).toBe("a b");
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/history.test.ts`
Expected: FAIL — Modul `../src/core/history` existiert nicht.

- [ ] **Step 3: Implementieren**

Erzeuge `src/core/history.ts`:

```ts
// Prompt-Historie — pure (Spec §7.3). MRU: neueste zuerst, Duplikate wandern nach vorn
// statt zu doppeln. Das Limit ist bewusst eine Konstante und kein Setting — ein Regler
// dafür wurde nicht verlangt (YAGNI), und ein Feld in data.json ohne UI wäre ein Fremdkörper.
export const HISTORY_LIMIT = 20;

/** Nimmt einen Prompt vorn auf. Leere/Whitespace-Prompts werden ignoriert (die Liste
 *  wird nur bei erfolgreicher Generierung gefüttert, aber der Guard hält sie sauber). */
export function pushHistory(list: readonly string[], prompt: string): string[] {
  const trimmed = prompt.trim();
  if (trimmed === "") return [...list];
  return [trimmed, ...list.filter((p) => p !== trimmed)].slice(0, HISTORY_LIMIT);
}

/** Einzeiliges, gekürztes Label für das Historie-Menü. */
export function historyLabel(prompt: string, max = 60): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
```

- [ ] **Step 4: Test laufen lassen — muss grün sein**

Run: `npx vitest run tests/history.test.ts`
Expected: PASS (10 Tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/history.ts tests/history.test.ts
git commit -m "$(cat <<'EOF'
feat(core): Prompt-Historie als pure MRU-Liste

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Stil-Presets (pure)

**Files:**
- Create: `src/core/presets.ts`
- Test: `tests/presets.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces: `presetActive(prompt: string, suffix: string): boolean`, `togglePresetInPrompt(prompt: string, suffix: string): string`

**Semantik (wichtig für die Tests):** Prompt und Suffix werden beide an Kommas in *Bausteine* zerlegt. Ein Preset ist aktiv, wenn **alle** seine Bausteine im Prompt stehen. Das ist nötig, weil ein Suffix selbst mehrteilig sein darf (`"sumi-e painting, monochrome ink"`), und es macht Teilstring-Fehltreffer unmöglich (`"oil"` ist nicht aktiv, nur weil `"oil painting"` dasteht).

- [ ] **Step 1: Failing test schreiben**

Erzeuge `tests/presets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { presetActive, togglePresetInPrompt } from "../src/core/presets";

const SUMI = "sumi-e painting, monochrome ink";

describe("presetActive", () => {
  it("ist inaktiv im leeren Prompt", () => {
    expect(presetActive("", SUMI)).toBe(false);
  });

  it("ist aktiv, wenn alle Bausteine des Suffix im Prompt stehen", () => {
    expect(presetActive("an apple, sumi-e painting, monochrome ink", SUMI)).toBe(true);
  });

  it("ist inaktiv, wenn nur ein Teil der Bausteine dasteht", () => {
    expect(presetActive("an apple, sumi-e painting", SUMI)).toBe(false);
  });

  it("zählt Teilstring-Treffer nicht als aktiv", () => {
    expect(presetActive("an apple, oil painting", "oil")).toBe(false);
  });

  it("ignoriert Whitespace um die Bausteine", () => {
    expect(presetActive("an apple ,  sumi-e painting ,monochrome ink", SUMI)).toBe(true);
  });

  it("ist bei leerem Suffix inaktiv (kein Allquantor auf der leeren Menge)", () => {
    expect(presetActive("an apple", "")).toBe(false);
    expect(presetActive("an apple", "  ,  ")).toBe(false);
  });
});

describe("togglePresetInPrompt", () => {
  it("hängt den Suffix an einen befüllten Prompt", () => {
    expect(togglePresetInPrompt("an apple", SUMI)).toBe("an apple, sumi-e painting, monochrome ink");
  });

  it("setzt den Suffix allein in einen leeren Prompt", () => {
    expect(togglePresetInPrompt("", SUMI)).toBe("sumi-e painting, monochrome ink");
  });

  it("entfernt den Suffix beim zweiten Klick", () => {
    const on = togglePresetInPrompt("an apple", SUMI);
    expect(togglePresetInPrompt(on, SUMI)).toBe("an apple");
  });

  it("ergänzt fehlende Bausteine, statt vorhandene zu doppeln", () => {
    expect(togglePresetInPrompt("an apple, sumi-e painting", SUMI)).toBe(
      "an apple, sumi-e painting, monochrome ink",
    );
  });

  it("normalisiert die Trennung auf ', '", () => {
    expect(togglePresetInPrompt("an apple ,pears", "oil")).toBe("an apple, pears, oil");
  });

  it("lässt den Prompt bei leerem Suffix unangetastet", () => {
    expect(togglePresetInPrompt("an apple", "   ")).toBe("an apple");
  });

  it("hinterlässt einen leeren Prompt, wenn nur der Suffix drin war", () => {
    expect(togglePresetInPrompt(SUMI, SUMI)).toBe("");
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/presets.test.ts`
Expected: FAIL — Modul `../src/core/presets` existiert nicht.

- [ ] **Step 3: Implementieren**

Erzeuge `src/core/presets.ts`:

```ts
// Stil-Presets — pure (Spec §7.1). Das Prompt-Textfeld ist die EINZIGE Wahrheit; der
// Chip-Zustand wird über presetActive daraus abgeleitet und nie parallel geführt. Entfernt
// der Nutzer den Suffix von Hand, geht der Chip dadurch von selbst aus.
//
// Beide Funktionen arbeiten baustein-basiert: Prompt und Suffix werden an Kommas zerlegt.
// Nötig, weil ein Suffix selbst mehrteilig sein darf ("sumi-e painting, monochrome ink");
// nebenbei macht es Teilstring-Fehltreffer unmöglich ("oil" ≠ "oil painting").
//
// Bewusst in Kauf genommen: Teilen sich zwei Presets einen Baustein, entfernt das
// Abschalten des einen ihn auch dem anderen. Das ist selten und sichtbar — die Alternative
// wäre ein Referenzzähler neben dem Textfeld, also genau die zweite Wahrheit, die wir
// vermeiden wollen.

const SEP = ", ";

function splitParts(text: string): string[] {
  return text
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** Aktiv, wenn ALLE Bausteine des Suffix im Prompt stehen. Leerer Suffix → nie aktiv. */
export function presetActive(prompt: string, suffix: string): boolean {
  const suffixParts = splitParts(suffix);
  if (suffixParts.length === 0) return false;
  const promptParts = splitParts(prompt);
  return suffixParts.every((p) => promptParts.includes(p));
}

/** Schaltet den Suffix an/aus. Normalisiert die Trennung auf ", ". */
export function togglePresetInPrompt(prompt: string, suffix: string): string {
  const suffixParts = splitParts(suffix);
  if (suffixParts.length === 0) return prompt;
  const promptParts = splitParts(prompt);
  const next = presetActive(prompt, suffix)
    ? promptParts.filter((p) => !suffixParts.includes(p))
    : [...promptParts, ...suffixParts.filter((p) => !promptParts.includes(p))];
  return next.join(SEP);
}
```

- [ ] **Step 4: Test laufen lassen — muss grün sein**

Run: `npx vitest run tests/presets.test.ts`
Expected: PASS (13 Tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/presets.ts tests/presets.test.ts
git commit -m "$(cat <<'EOF'
feat(core): Stil-Presets — baustein-basiertes Toggle mit dem Prompt als einziger Wahrheit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Frontmatter-Serializer vendoren

**Files:**
- Create: `src/vendor/kit/frontmatter.ts`
- Test: `tests/frontmatter.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces: `FmValue = string | number | string[]`, `serializeFrontmatter(data: Record<string, FmValue>, order: string[]): string`

**Herkunft:** `vault-rag/src/frontmatter.ts` (Stand 2026-07-16). Übernommen wird **nur der Serialisier-Pfad** (`serializeFrontmatter` + Helfer). Die dortigen `parseFrontmatter`/`mergeFrontmatter`/`diffFrontmatter`/`assertParseable` bleiben draußen — hier ungenutzt (YAGNI). **Eine Abweichung vom Original:** `FmValue` kennt zusätzlich `number`, damit `seed: 199801046` nativ und ungequotet landet statt als String (das Original quotet zahl-aussehende Strings absichtlich).

- [ ] **Step 1: Failing test schreiben**

Erzeuge `tests/frontmatter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { serializeFrontmatter, type FmValue } from "../src/vendor/kit/frontmatter";

const ser = (data: Record<string, FmValue>, order: string[]): string => serializeFrontmatter(data, order);

describe("serializeFrontmatter", () => {
  it("rahmt mit --- und endet mit Newline", () => {
    expect(ser({ a: "x" }, ["a"])).toBe("---\na: x\n---\n");
  });

  it("hält die Reihenfolge aus order ein", () => {
    expect(ser({ b: "2", a: "1" }, ["a", "b"])).toBe("---\na: \"1\"\nb: \"2\"\n---\n");
  });

  it("überspringt Keys aus order, die nicht in data stehen", () => {
    expect(ser({ a: "x" }, ["a", "fehlt"])).toBe("---\na: x\n---\n");
  });

  it("schreibt Zahlen nativ und ungequotet", () => {
    expect(ser({ seed: 199801046 }, ["seed"])).toBe("---\nseed: 199801046\n---\n");
  });

  it("quotet Strings, die wie Zahlen aussehen", () => {
    expect(ser({ a: "199801046" }, ["a"])).toBe("---\na: \"199801046\"\n---\n");
  });

  it("quotet Wikilinks — unquoted bräche [[ das YAML", () => {
    expect(ser({ image: "[[a.png]]" }, ["image"])).toBe("---\nimage: \"[[a.png]]\"\n---\n");
  });

  it("quotet Doppelpunkt-mit-Leerzeichen", () => {
    expect(ser({ a: "foo: bar" }, ["a"])).toBe("---\na: \"foo: bar\"\n---\n");
  });

  // Anführungszeichen/Backslashes MITTEN im Wert lösen KEIN Quoting aus — ein
  // YAML-Plain-Scalar darf sie enthalten, und das Original von vault-rag lässt sie
  // deshalb bewusst stehen. (Ein führendes " triggert NEEDS_QUOTE_LEADING sehr wohl.)
  it("lässt Anführungszeichen und Backslashes in der Mitte ungequotet", () => {
    expect(ser({ a: 'he said "hi"' }, ["a"])).toBe('---\na: he said "hi"\n---\n');
    expect(ser({ a: 'back\\slash "q"' }, ["a"])).toBe('---\na: back\\slash "q"\n---\n');
  });

  it("escapt Anführungszeichen und Backslashes, wenn ein anderer Grund Quoting auslöst", () => {
    // Das Komma erzwingt Quoting — erst dann greift das Escaping in quoteScalar.
    expect(ser({ a: 'x, he said "hi"' }, ["a"])).toBe('---\na: "x, he said \\"hi\\""\n---\n');
    expect(ser({ a: 'x, back\\slash' }, ["a"])).toBe('---\na: "x, back\\\\slash"\n---\n');
  });

  it("quotet ein führendes Anführungszeichen", () => {
    expect(ser({ a: '"quoted" start' }, ["a"])).toBe('---\na: "\\"quoted\\" start"\n---\n');
  });

  it("quotet Hash, Kommas und führende Sonderzeichen", () => {
    expect(ser({ a: "tag #x" }, ["a"])).toBe('---\na: "tag #x"\n---\n');
    expect(ser({ a: "x, y" }, ["a"])).toBe('---\na: "x, y"\n---\n');
    expect(ser({ a: "- dash" }, ["a"])).toBe('---\na: "- dash"\n---\n');
  });

  it("quotet YAML-Schlüsselwörter", () => {
    expect(ser({ a: "true" }, ["a"])).toBe('---\na: "true"\n---\n');
    expect(ser({ a: "no" }, ["a"])).toBe('---\na: "no"\n---\n');
  });

  it("quotet führende Emoji", () => {
    expect(ser({ a: "🔥 hot" }, ["a"])).toBe('---\na: "🔥 hot"\n---\n');
  });

  it("emittiert leere Skalare bar (key:)", () => {
    expect(ser({ a: "" }, ["a"])).toBe("---\na:\n---\n");
  });

  it("schreibt Arrays als Flow-Liste", () => {
    expect(ser({ tags: ["a", "b"] }, ["tags"])).toBe("---\ntags: [a, b]\n---\n");
    expect(ser({ tags: [] }, ["tags"])).toBe("---\ntags: []\n---\n");
  });

  it("lässt harmlose Strings unangetastet", () => {
    expect(ser({ a: "an apple" }, ["a"])).toBe("---\na: an apple\n---\n");
  });

  it("lässt einen ISO-Zeitstempel unangetastet", () => {
    expect(ser({ created: "2026-07-16T21:52:43" }, ["created"])).toBe("---\ncreated: 2026-07-16T21:52:43\n---\n");
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/frontmatter.test.ts`
Expected: FAIL — Modul `../src/vendor/kit/frontmatter` existiert nicht.

- [ ] **Step 3: Implementieren**

Erzeuge `src/vendor/kit/frontmatter.ts`:

```ts
/** YAML-Frontmatter serialisieren (yaml_lite: flache Skalare + einfache Listen).
 *
 *  VENDORED aus `vault-rag/src/frontmatter.ts` (Stand 2026-07-16). Übernommen ist NUR der
 *  Serialisier-Pfad; parseFrontmatter/mergeFrontmatter/diffFrontmatter/assertParseable des
 *  Originals bleiben draußen (hier ungenutzt, YAGNI). Bei einem Sync mit dem Original:
 *  dort ist die Quelle der Wahrheit für needsQuoting/quoteScalar.
 *
 *  EINE ABWEICHUNG vom Original: FmValue kennt zusätzlich `number`, damit `seed: 199801046`
 *  nativ und ungequotet landet. Das Original kennt nur string|string[] und quotet
 *  zahl-aussehende Strings absichtlich — beides bleibt hier gültig, Zahlen sind ein
 *  zusätzlicher, expliziter Typ.
 *
 *  Kein obsidian-Import (check:pure). */

export type FmValue = string | number | string[];

// Codepoints, die YAML am Skalar-Anfang missdeuten würde.
const NEEDS_QUOTE_LEADING = /^[\s>|@`%&*!?#\-[{'"]/u;

function startsWithEmoji(s: string): boolean {
  const cp = s.codePointAt(0);
  if (cp === undefined) return false;
  // Symbols & pictographs, dingbats, misc symbols, regional indicators, etc.
  return (
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x1f000 && cp <= 0x1f2ff) ||
    cp === 0x2b50 ||
    cp === 0x2705 ||
    cp === 0x274c
  );
}

function needsQuoting(v: string): boolean {
  if (v === "") return false; // leerer Skalar wird bar emittiert (key:)
  if (v !== v.trim()) return true;
  if (v.includes(": ") || v.endsWith(":")) return true;
  if (v.includes(" #") || v.includes("#")) return true;
  if (v.includes("[[") || v.includes("]]")) return true;
  if (v.includes(",")) return true; // Komma würde den Inline-List-Tokenizer spalten
  if (NEEDS_QUOTE_LEADING.test(v)) return true;
  if (startsWithEmoji(v)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(v)) return true;
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(v)) return true;
  return false;
}

function quoteScalar(v: string): string {
  if (!needsQuoting(v)) return v;
  return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function serializeValue(v: FmValue): string {
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return "[" + v.map(quoteScalar).join(", ") + "]";
  return v === "" ? "" : quoteScalar(v);
}

export function serializeFrontmatter(data: Record<string, FmValue>, order: string[]): string {
  const lines: string[] = ["---"];
  for (const key of order) {
    if (!(key in data)) continue;
    const ser = serializeValue(data[key]!);
    lines.push(ser === "" ? `${key}:` : `${key}: ${ser}`);
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Test + Pure-Gate laufen lassen**

Run: `npx vitest run tests/frontmatter.test.ts && npm run check:pure`
Expected: PASS (17 Tests) und `check:pure OK`

> **Nicht „reparieren", was die Tests scheinbar verlangen:** `needsQuoting` darf **nicht** um
> `v.includes('"')`/`v.includes("\\")` erweitert werden. Anführungszeichen und Backslashes
> mitten im Wert sind in einem YAML-Plain-Scalar legal und parsen sauber zurück — das
> Original lässt sie deshalb absichtlich stehen. Eine solche Erweiterung wäre eine zweite,
> undokumentierte Abweichung vom Original und erschwert den Sync ohne Korrektheitsgewinn.

- [ ] **Step 5: Commit**

```bash
git add src/vendor/kit/frontmatter.ts tests/frontmatter.test.ts
git commit -m "$(cat <<'EOF'
feat(vendor): Frontmatter-Serializer aus vault-rag vendoren (+ native Zahlen)

Nur der Serialisier-Pfad; parse/merge/diff des Originals bleiben draußen (ungenutzt).
Einzige Abweichung: FmValue kennt number, damit seed nativ statt als String landet.

Kit-Extraktion (Regel-der-Drei ist erreicht) läuft separat via /drift-audit.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Notiz-Dateiname, Verzeichnis-Helfer und Zeitstempel

**Files:**
- Modify: `src/core/filename.ts` (anhängen, Bestehendes nicht anfassen)
- Test: `tests/filename.test.ts` (anhängen)

**Interfaces:**
- Consumes: nichts
- Produces: `buildNoteFilename(prompt: string, seed: number): string`, `dirOf(path: string): string`, `isoStamp(d: Date): string`

- [ ] **Step 1: Failing tests anhängen**

Hänge an `tests/filename.test.ts` an (bestehende Tests unverändert lassen, Import-Zeile entsprechend erweitern):

```ts
import { buildNoteFilename, dirOf, isoStamp } from "../src/core/filename";

describe("buildNoteFilename", () => {
  it("baut Slug + Seed nach dem Muster aus dem Smoke-Test", () => {
    expect(buildNoteFilename("Apple - Sumi-e painting", 199801046)).toBe("Apple - Sumi-e painting - 199801046.md");
  });

  it("entfernt in Obsidian verbotene Zeichen", () => {
    expect(buildNoteFilename('a[b]c#d^e|f/g\\h:i*j?k"l<m>n', 1)).toBe("a b c d e f g h i j k l m n - 1.md");
  });

  it("kollabiert Whitespace", () => {
    expect(buildNoteFilename("a   b\n\nc", 1)).toBe("a b c - 1.md");
  });

  it("kürzt überlange Slugs auf 60 Zeichen", () => {
    const name = buildNoteFilename("x".repeat(80), 1);
    expect(name).toBe(`${"x".repeat(60)} - 1.md`);
  });

  it("lässt am Schnitt keinen Trailing-Space stehen", () => {
    const name = buildNoteFilename(`${"x".repeat(59)}   tail`, 1);
    expect(name).toBe(`${"x".repeat(59)} - 1.md`);
  });

  it("fällt bei leerem Slug auf lig-<seed> zurück", () => {
    expect(buildNoteFilename("", 42)).toBe("lig-42.md");
    expect(buildNoteFilename("   ", 42)).toBe("lig-42.md");
    expect(buildNoteFilename("///", 42)).toBe("lig-42.md");
  });

  it("streift führende Punkte (sonst versteckte Datei)", () => {
    expect(buildNoteFilename("...hidden", 1)).toBe("hidden - 1.md");
    expect(buildNoteFilename("...", 1)).toBe("lig-1.md");
  });

  it("behält Umlaute und Unicode", () => {
    expect(buildNoteFilename("Öl auf Leinwand — Größe", 7)).toBe("Öl auf Leinwand — Größe - 7.md");
  });
});

describe("dirOf", () => {
  it("liefert das Verzeichnis eines Pfads", () => {
    expect(dirOf("Art/Bilder/x.png")).toBe("Art/Bilder");
  });

  it("liefert leeren String im Vault-Root", () => {
    expect(dirOf("x.png")).toBe("");
  });
});

describe("isoStamp", () => {
  it("formatiert lokale Zeit als ISO-8601 ohne Zeitzone", () => {
    expect(isoStamp(new Date(2026, 6, 16, 21, 52, 43))).toBe("2026-07-16T21:52:43");
  });

  it("füllt einstellige Werte auf", () => {
    expect(isoStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("2026-01-02T03:04:05");
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/filename.test.ts`
Expected: FAIL — `buildNoteFilename` ist kein Export.

- [ ] **Step 3: Implementieren**

Hänge an `src/core/filename.ts` an:

```ts
// Notiz-Dateiname (Spec §7.4): "<Prompt-Slug, max 60> - <seed>.md", nach Jays
// handgebautem Vorbild aus dem Smoke-Test ("Apple - Sumi-e painting - 199801046.md").
const FORBIDDEN = /[[\]#^|/\\:*?"<>]/g;
const SLUG_MAX = 60;

export function buildNoteFilename(prompt: string, seed: number): string {
  const slug = prompt
    .replace(FORBIDDEN, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SLUG_MAX)
    .replace(/^\.+/, "") // führender Punkt = versteckte Datei
    .trim();
  return slug === "" ? `lig-${seed}.md` : `${slug} - ${seed}.md`;
}

// Verzeichnis eines Vault-Pfads; "" im Root. Pure — kein Vault-Zugriff.
export function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

// Lokaler ISO-8601-Zeitstempel ohne Zeitzone für das Frontmatter-Feld `created`.
// Bewusst lokal, nicht UTC: die Notiz dokumentiert, wann JAY das Bild gemacht hat.
export function isoStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `${date}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
```

- [ ] **Step 4: Test laufen lassen — muss grün sein**

Run: `npx vitest run tests/filename.test.ts`
Expected: PASS (bestehende + 12 neue Tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/filename.ts tests/filename.test.ts
git commit -m "$(cat <<'EOF'
feat(core): Notiz-Dateiname, dirOf und ISO-Zeitstempel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: GenParams + Notiz-Builder (pure)

**Files:**
- Modify: `src/core/viewmodel.ts:12-19` (`GenParams` ergänzen, `PanelState.image` umbauen)
- Create: `src/core/note.ts`
- Modify: `src/core/model-manifest.ts` (`MODEL_ID` ergänzen)
- Modify: `tests/viewmodel.test.ts` (an die neue `image`-Form anpassen)
- Test: `tests/note.test.ts`

**Interfaces:**
- Consumes: `serializeFrontmatter`, `FmValue` (Task 4)
- Produces: `GenParams {prompt: string; seed: number; steps: number; model: string; date: string}`, `PanelState.image: { dataUrl: string; params: GenParams } | null`, `buildImageNote(params: GenParams, imageLink: string): string`, `MODEL_ID: string`

**Warum der Umbau (latenter Bug aus 0.1):** `state.image` hält heute nur `{seed, dataUrl}`, der Prompt lebt live in `state.prompt`, die Steps nur im DOM-Slider. Wer generiert, dann den Prompt ändert und *dann* Create drückt, bekäme den **neuen** Prompt ins Frontmatter — bei einem Bild aus dem alten. Die Parameter werden deshalb beim Generieren eingefroren.

- [ ] **Step 1: Failing test schreiben**

Erzeuge `tests/note.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildImageNote } from "../src/core/note";
import type { GenParams } from "../src/core/viewmodel";

const params = (over: Partial<GenParams> = {}): GenParams => ({
  prompt: "an apple",
  seed: 199801046,
  steps: 4,
  model: "sd-turbo",
  date: "2026-07-16T21:52:43",
  ...over,
});

describe("buildImageNote", () => {
  it("baut Frontmatter + Embed", () => {
    expect(buildImageNote(params(), "Art/lig-20260716-215243-s199801046.png")).toBe(
      [
        "---",
        "prompt: an apple",
        "seed: 199801046",
        "steps: 4",
        "model: sd-turbo",
        "created: 2026-07-16T21:52:43",
        'image: "[[Art/lig-20260716-215243-s199801046.png]]"',
        "---",
        "",
        "![[Art/lig-20260716-215243-s199801046.png]]",
        "",
      ].join("\n"),
    );
  });

  it("schreibt seed und steps als native Zahlen", () => {
    const note = buildImageNote(params(), "x.png");
    expect(note).toContain("seed: 199801046");
    expect(note).toContain("steps: 4");
  });

  it("quotet einen Prompt mit Doppelpunkt", () => {
    expect(buildImageNote(params({ prompt: "style: sumi-e" }), "x.png")).toContain('prompt: "style: sumi-e"');
  });

  it("quotet einen Prompt mit Wikilink-Klammern", () => {
    expect(buildImageNote(params({ prompt: "see [[note]]" }), "x.png")).toContain('prompt: "see [[note]]"');
  });

  // Ein Anführungszeichen MITTEN im Wert löst bewusst KEIN Quoting aus — gültiger
  // YAML-Plain-Scalar, siehe Task 4 ("lässt Anführungszeichen und Backslashes in der
  // Mitte ungequotet"). note.ts delegiert das Quoting vollständig an den Serializer.
  it("lässt Anführungszeichen im Prompt ungequotet (gültiger YAML-Plain-Scalar)", () => {
    expect(buildImageNote(params({ prompt: 'an "apple"' }), "x.png")).toContain('prompt: an "apple"');
  });

  it("quotet einen Prompt mit Komma", () => {
    expect(buildImageNote(params({ prompt: "an apple, sumi-e" }), "x.png")).toContain('prompt: "an apple, sumi-e"');
  });

  it("verkraftet einen leeren Prompt", () => {
    expect(buildImageNote(params({ prompt: "" }), "x.png")).toContain("\nprompt:\n");
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/note.test.ts`
Expected: FAIL — Modul `../src/core/note` existiert nicht.

- [ ] **Step 3: `MODEL_ID` ergänzen**

Hänge an `src/core/model-manifest.ts` an:

```ts
/** Modell-Kennung für das Frontmatter der Ergebnis-Notiz. */
export const MODEL_ID = "sd-turbo";
```

- [ ] **Step 4: `GenParams` ergänzen und `PanelState.image` umbauen**

In `src/core/viewmodel.ts`, direkt vor `export interface PanelState` einfügen:

```ts
/** Die Parameter, aus denen ein Bild entstanden ist — beim Generieren eingefroren, damit
 *  die Ergebnis-Notiz das Bild beschreibt, das man sieht (und nicht den inzwischen
 *  weitergetippten Prompt). */
export interface GenParams {
  prompt: string;
  seed: number;
  steps: number;
  model: string;
  /** Lokaler ISO-8601-Stempel, siehe isoStamp() in filename.ts. */
  date: string;
}
```

Und in `PanelState` die Zeile

```ts
  image: { seed: number; dataUrl: string } | null;
```

ersetzen durch:

```ts
  image: { dataUrl: string; params: GenParams } | null;
```

`buildViewModel` bleibt unverändert — es prüft nur `s.image !== null`.

- [ ] **Step 5: `tests/viewmodel.test.ts` an die neue Form anpassen**

Suche im Test nach Stellen, die ein `image`-Objekt bauen (z. B. `image: { seed: 1, dataUrl: "x" }`), und ersetze sie durch:

```ts
image: { dataUrl: "x", params: { prompt: "p", seed: 1, steps: 4, model: "sd-turbo", date: "2026-07-16T21:52:43" } },
```

Run: `npx vitest run tests/viewmodel.test.ts`
Expected: PASS — falls FAIL, wurde eine `image`-Stelle übersehen.

- [ ] **Step 6: Notiz-Builder implementieren**

Erzeuge `src/core/note.ts`:

```ts
// Ergebnis-Notiz (Spec §7.4) — pure Builder: Frontmatter + Embed. Kein Vault-Zugriff;
// Pfad und Link kommen von außen. Muster übernommen von image-to-markdown/src/img_to_md.ts
// (lines[]-Builder, IO injiziert) — dessen schwaches Escaping aber NICHT: das Quoting
// kommt aus dem vendorten Serializer.
import { serializeFrontmatter, type FmValue } from "../vendor/kit/frontmatter";
import type { GenParams } from "./viewmodel";

const FM_ORDER = ["prompt", "seed", "steps", "model", "created", "image"];

/** @param imageLink Vault-Pfad des Bildes, so wie er in `![[…]]` stehen soll. */
export function buildImageNote(params: GenParams, imageLink: string): string {
  const data: Record<string, FmValue> = {
    prompt: params.prompt,
    seed: params.seed,
    steps: params.steps,
    model: params.model,
    created: params.date,
    // Der Serializer quotet das selbst (needsQuoting kennt "[["), aber der Link muss als
    // Wikilink im Wert stehen — unquoted bräche "[[" das YAML.
    image: `[[${imageLink}]]`,
  };
  return `${serializeFrontmatter(data, FM_ORDER)}\n![[${imageLink}]]\n`;
}
```

- [ ] **Step 7: Tests + Pure-Gate laufen lassen**

Run: `npx vitest run && npm run check:pure`
Expected: PASS (alle Tests) und `check:pure OK`

- [ ] **Step 8: Commit**

```bash
git add src/core/note.ts src/core/viewmodel.ts src/core/model-manifest.ts tests/note.test.ts tests/viewmodel.test.ts
git commit -m "$(cat <<'EOF'
feat(core): GenParams einfrieren + Notiz-Builder

state.image hielt nur {seed,dataUrl}; Prompt und Steps lagen woanders und konnten sich
zwischen Generieren und Speichern ändern. Mit Create-as-note hätte das still falsches
Frontmatter geschrieben. Die Parameter werden jetzt beim Generieren eingefroren.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Engine-Wiring auf GenParams umstellen

**Files:**
- Modify: `src/main.ts:20-27` (State-Init), `src/main.ts:135-158` (`generate`), `src/main.ts:179-197` (`saveImage`)
- Modify: `src/obsidian/view.ts` (nur falls `state.image.seed` gelesen wird — prüfen)

**Interfaces:**
- Consumes: `GenParams` (Task 6), `MODEL_ID` (Task 6), `isoStamp` (Task 5)
- Produces: `state.image` trägt jetzt `params`; `ViewHost` unverändert

Dieser Task hat **keine eigenen Tests** — er ist reines Wiring in der Obsidian-Schicht, deren Logik in Task 6 bereits pure getestet ist. Verifikation läuft über `npm run gate` (typecheck fängt jede vergessene Lesestelle).

- [ ] **Step 1: `generate` umbauen**

In `src/main.ts`, Imports ergänzen:

```ts
import { buildImageFilename, dedupeFilename, isoStamp } from "./core/filename";
import { MODEL_ID, totalApproxBytes, MODEL_FILES } from "./core/model-manifest";
```

(`totalApproxBytes`/`MODEL_FILES` nur, falls dort schon importiert — sonst weglassen.)

Ersetze den Rumpf von `generate`:

```ts
  private async generate(steps: number, seed: number): Promise<void> {
    if (this.state.run.kind === "running") return;
    // Prompt HIER festhalten: zwischen Start und Ende kann der Nutzer weitertippen,
    // und die Ergebnis-Notiz muss das Bild beschreiben, das entstanden ist.
    const prompt = this.state.prompt;
    this.state.run = { kind: "running", step: 0, total: steps };
    this.refreshView();
    try {
      const engine = await this.ensureEngine();
      const result = await engine.generate({ prompt, steps, seed }, (step, total) => {
        this.state.run = { kind: "running", step, total };
        this.refreshView();
      });
      this.state.image = {
        dataUrl: rgbaToDataUrl(result.rgba, result.width, result.height),
        params: { prompt, seed: result.seed, steps, model: MODEL_ID, date: isoStamp(new Date()) },
      };
      this.state.run = { kind: "idle" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.state.run = { kind: "error", message: msg };
      // Sessions freigeben und verwerfen, nächster Lauf lädt neu (Spec §8).
      // Fire-and-forget: der Fehlerpfad soll den UI-Refresh nicht blockieren.
      void this.engine?.dispose().catch(() => {});
      this.engine = null;
      new Notice(STRINGS.oomHint);
    } finally {
      this.refreshView();
    }
  }
```

- [ ] **Step 2: `saveImage` an `params.seed` anpassen**

In `src/main.ts` die Zeile

```ts
      const path = await this.resolveImagePath(buildImageFilename(new Date(), img.seed));
```

ersetzen durch:

```ts
      const path = await this.resolveImagePath(buildImageFilename(new Date(), img.params.seed));
```

- [ ] **Step 3: Gate laufen lassen**

Run: `npm run gate`
Expected: PASS. Meldet der Typecheck weitere `img.seed`/`state.image.seed`-Stellen (z. B. in `view.ts`), analog auf `params.seed` umstellen.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/obsidian/view.ts
git commit -m "$(cat <<'EOF'
refactor(main): Generierungs-Parameter beim Generieren einfrieren

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Strings ergänzen

**Files:**
- Modify: `src/core/strings.ts:26-35` (Settings-Block erweitern, `cancel`/`confirm` bleiben am Ende)

**Interfaces:**
- Consumes: nichts
- Produces: neue `STRINGS`-Keys für Tasks 9–14

Reiner Text-Task ohne Tests — vorgezogen, damit die folgenden UI-Tasks nicht jeweils an `strings.ts` herummodellieren und sich in die Quere kommen.

- [ ] **Step 1: Keys ergänzen**

In `src/core/strings.ts` **vor** `cancel: "Cancel",` einfügen:

```ts
  seedLock: "Lock seed",
  seedUnlock: "Unlock seed",
  seedLockedTooltip: "Seed is locked — Regenerate keeps it",
  presetsLabel: "Styles",
  history: "Recent prompts",
  historyEmpty: "No prompts yet",
  settingsNoteFolder: "Note folder",
  settingsNoteFolderDesc: "Where result notes are saved. Leave empty to put them next to the image.",
  settingsCreateMode: "Create button",
  settingsCreateModeDesc: "Whether Create saves just the image, or also a note with the settings in its frontmatter and the image embedded.",
  settingsCreateModeImage: "Image only",
  settingsCreateModeNote: "Image + note",
  settingsDefaultSteps: "Default steps",
  settingsDefaultStepsDesc: "Starting value of the steps slider. SD-Turbo is trained for 1–4 steps.",
  settingsPresetsHeading: "Styles",
  settingsPresetsDesc: "Style chips shown under the prompt. Clicking a chip appends its text to the prompt.",
  settingsPresetLabel: "Label",
  settingsPresetSuffix: "Prompt text",
  settingsPresetAdd: "Add style",
  settingsPresetDelete: "Delete style",
  settingsDangerHeading: "Danger zone",
  saved: (path: string) => `Saved: ${path}`,
  noteFailed: (msg: string, imagePath: string) => `Image saved to ${imagePath}, but the note failed: ${msg}`,
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/strings.ts
git commit -m "$(cat <<'EOF'
feat(strings): Texte für Presets, Seed-Sperre, Historie und Notiz-Settings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Seed-Sperre + Default-Steps in der View

**Files:**
- Modify: `src/obsidian/view.ts:9-15` (`ViewHost` um `getSettings` erweitern), `:69-95` (Controls), `:105-109` (Regen-Handler)
- Modify: `src/main.ts:33-48` (Host-Objekt)
- Modify: `styles.css`

**Interfaces:**
- Consumes: `LigSettings` (Task 1), `STRINGS.seedLock`/`seedUnlock`/`seedLockedTooltip` (Task 8)
- Produces: `ViewHost.getSettings(): LigSettings` — nutzen Tasks 10 und 11 ebenfalls

- [ ] **Step 1: `ViewHost` erweitern**

In `src/obsidian/view.ts` den Import ergänzen und das Interface erweitern:

```ts
import type { LigSettings } from "../core/settings";

export interface ViewHost {
  getPanelState(): PanelState;
  getSettings(): LigSettings;
  setPrompt(p: string): void;
  generate(steps: number, seed: number): void;
  saveImage(mode: "create" | "insert"): void;
  openSettings(): void;
}
```

In `src/main.ts` im `host`-Objekt ergänzen (direkt nach `getPanelState`):

```ts
      getSettings: () => this.settings,
```

- [ ] **Step 2: Feld für den Sperr-Zustand ergänzen**

In `src/obsidian/view.ts` bei den privaten Feldern ergänzen:

```ts
  private seedLocked = false;
```

- [ ] **Step 3: Slider-Startwert + Schloss bauen**

In `onOpen` die Steps-Zeile

```ts
    this.stepsEl = controls.createEl("input", {
      cls: "lig-steps",
      attr: { type: "range", min: "1", max: "4", step: "1", value: "1" },
    });
    this.stepsValueEl = controls.createSpan({ text: "1", cls: "lig-steps-value" });
```

ersetzen durch:

```ts
    // Startwert aus den Settings — danach gehört der Slider dem Nutzer, wir schreiben
    // nichts zurück (die Einstellung ist ein Startwert, kein Zwang).
    const startSteps = String(this.host.getSettings().defaultSteps);
    this.stepsEl = controls.createEl("input", {
      cls: "lig-steps",
      attr: { type: "range", min: "1", max: "4", step: "1", value: startSteps },
    });
    this.stepsValueEl = controls.createSpan({ text: startSteps, cls: "lig-steps-value" });
```

Und direkt **nach** dem `dice`-Block (nach dessen `addEventListener`) einfügen:

```ts
    const lock = controls.createEl("button", { cls: "clickable-icon lig-lock" });
    const applyLock = (): void => {
      setIcon(lock, this.seedLocked ? "lock" : "unlock");
      const label = this.seedLocked ? STRINGS.seedUnlock : STRINGS.seedLock;
      setTooltip(lock, this.seedLocked ? STRINGS.seedLockedTooltip : label);
      lock.setAttribute("aria-label", label);
      lock.setAttribute("aria-pressed", String(this.seedLocked));
      lock.toggleClass("is-active", this.seedLocked);
    };
    applyLock();
    lock.addEventListener("click", () => {
      this.seedLocked = !this.seedLocked;
      applyLock();
    });
```

- [ ] **Step 4: Regen-Handler auf die Sperre hören lassen**

Ersetze den `regenBtn`-Handler:

```ts
    this.regenBtn.addEventListener("click", () => {
      // Gesperrt = denselben Seed behalten, damit man den Prompt variieren und die
      // Wirkung der Worte sehen kann. Der Würfel bleibt davon unberührt.
      if (!this.seedLocked) this.seedEl.value = String(randomSeed());
      this.host.generate(Number(this.stepsEl.value), Number(this.seedEl.value));
    });
```

- [ ] **Step 5: CSS ergänzen**

Hänge an `styles.css` an:

```css
.lig-lock.is-active { color: var(--text-accent); }
```

- [ ] **Step 6: Gate laufen lassen**

Run: `npm run gate`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/obsidian/view.ts src/main.ts styles.css
git commit -m "$(cat <<'EOF'
feat(view): Seed-Sperre + Default-Steps aus den Settings

Regenerate würfelte den Seed bedingungslos neu — damit ließ sich der Prompt nicht bei
festem Seed variieren.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Stil-Presets als Chips

**Files:**
- Modify: `src/obsidian/view.ts` (Chip-Zeile in `onOpen`, `renderChips` in `refresh`)
- Modify: `styles.css`

**Interfaces:**
- Consumes: `togglePresetInPrompt`, `presetActive` (Task 3), `ViewHost.getSettings` (Task 9), `STRINGS.presetsLabel` (Task 8)
- Produces: nichts für spätere Tasks

**Warum die Signatur-Prüfung:** `refresh()` läuft bei **jedem Tastendruck** im Prompt (`view.ts:64-67`). Die Chips komplett neu zu bauen wäre DOM-Churn pro Zeichen und würde einen laufenden Klick zerreißen. Deshalb: Chips nur neu bauen, wenn sich die Preset-Liste tatsächlich geändert hat (Signatur-Vergleich); sonst nur die Aktiv-Klasse aktualisieren.

- [ ] **Step 1: Imports und Felder ergänzen**

In `src/obsidian/view.ts`:

```ts
import { presetActive, togglePresetInPrompt } from "../core/presets";
```

Bei den privaten Feldern:

```ts
  private chipsEl!: HTMLElement;
  private chipEls: { suffix: string; el: HTMLElement }[] = [];
  private presetSig = "";
```

- [ ] **Step 2: Chip-Zeile in `onOpen` anlegen**

Direkt **nach** dem `this.promptEl.addEventListener("input", …)`-Block einfügen:

```ts
    this.chipsEl = root.createDiv({ cls: "lig-row lig-chips" });
```

- [ ] **Step 3: `renderChips` implementieren**

Als neue private Methode in der Klasse (z. B. direkt vor `refresh`):

```ts
  private renderChips(): void {
    const presets = this.host.getSettings().presets;
    const sig = presets.map((p) => `${p.id} ${p.label} ${p.suffix}`).join("");
    if (sig !== this.presetSig) {
      // Nur neu bauen, wenn sich die Liste wirklich geändert hat — refresh() läuft
      // bei jedem Tastendruck, ein Rebuild pro Zeichen wäre unnötiger DOM-Churn.
      this.presetSig = sig;
      this.chipsEl.empty();
      this.chipEls = [];
      if (presets.length > 0) this.chipsEl.createSpan({ text: STRINGS.presetsLabel, cls: "lig-label" });
      for (const p of presets) {
        const el = this.chipsEl.createEl("button", { text: p.label, cls: "lig-chip" });
        el.setAttribute("type", "button");
        el.addEventListener("click", () => {
          const next = togglePresetInPrompt(this.promptEl.value, p.suffix);
          this.promptEl.value = next;
          this.host.setPrompt(next);
          this.refresh();
        });
        this.chipEls.push({ suffix: p.suffix, el });
      }
    }
    // Aktiv-Zustand IMMER aus dem Textfeld ableiten — es ist die einzige Wahrheit.
    for (const chip of this.chipEls) {
      const active = presetActive(this.promptEl.value, chip.suffix);
      chip.el.toggleClass("is-active", active);
      chip.el.setAttribute("aria-pressed", String(active));
    }
  }
```

- [ ] **Step 4: `renderChips` in `refresh` aufrufen**

In `refresh()` als erste Zeile nach `const state = this.host.getPanelState();`:

```ts
    this.renderChips();
```

- [ ] **Step 5: CSS ergänzen**

Hänge an `styles.css` an:

```css
.lig-chips { gap: var(--size-4-1); }
.lig-chip {
  padding: var(--size-2-1) var(--size-4-2);
  border-radius: var(--radius-l);
  font-size: var(--font-ui-smaller);
  background: var(--background-modifier-hover);
  color: var(--text-muted);
  border: 1px solid transparent;
  cursor: pointer;
}
.lig-chip:hover { color: var(--text-normal); }
.lig-chip.is-active {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  border-color: var(--interactive-accent);
}
```

- [ ] **Step 6: Gate laufen lassen**

Run: `npm run gate`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/obsidian/view.ts styles.css
git commit -m "$(cat <<'EOF'
feat(view): Stil-Presets als Chips unter dem Prompt

Chip-Zustand wird aus dem Textfeld abgeleitet, nicht parallel geführt — wer den Suffix
von Hand entfernt, sieht den Chip von selbst ausgehen.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Prompt-Historie

**Files:**
- Modify: `src/obsidian/view.ts` (Historie-Button in `onOpen`)
- Modify: `src/main.ts` (`generate` — Eintrag bei Erfolg)
- Modify: `styles.css`

**Interfaces:**
- Consumes: `historyLabel`, `pushHistory` (Task 2), `ViewHost.getSettings` (Task 9), `STRINGS.history`/`historyEmpty` (Task 8)
- Produces: nichts für spätere Tasks

- [ ] **Step 1: Historie-Button in der View**

In `src/obsidian/view.ts` Import ergänzen:

```ts
import { ItemView, Menu, setIcon, setTooltip, WorkspaceLeaf } from "obsidian";
import { historyLabel } from "../core/history";
```

Die Prompt-Textarea steht heute direkt in `root`. Damit der Button daneben passt, wird sie in eine Zeile gewickelt. Ersetze in `onOpen`:

```ts
    this.promptEl = root.createEl("textarea", {
      cls: "lig-prompt",
      attr: { placeholder: STRINGS.promptPlaceholder, rows: "3" },
    });
```

durch:

```ts
    const promptRow = root.createDiv({ cls: "lig-prompt-row" });
    this.promptEl = promptRow.createEl("textarea", {
      cls: "lig-prompt",
      attr: { placeholder: STRINGS.promptPlaceholder, rows: "3" },
    });
    const histBtn = promptRow.createEl("button", { cls: "clickable-icon lig-history" });
    histBtn.setAttribute("type", "button");
    setIcon(histBtn, "history");
    setTooltip(histBtn, STRINGS.history);
    histBtn.setAttribute("aria-label", STRINGS.history);
    histBtn.addEventListener("click", (evt) => {
      const menu = new Menu();
      const items = this.host.getSettings().promptHistory;
      if (items.length === 0) {
        menu.addItem((i) => i.setTitle(STRINGS.historyEmpty).setDisabled(true));
      } else {
        for (const p of items) {
          menu.addItem((i) =>
            i.setTitle(historyLabel(p)).onClick(() => {
              this.promptEl.value = p;
              this.host.setPrompt(p);
              this.refresh();
            }),
          );
        }
      }
      menu.showAtMouseEvent(evt);
    });
```

- [ ] **Step 2: Eintrag bei erfolgreicher Generierung**

In `src/main.ts` Import ergänzen:

```ts
import { pushHistory } from "./core/history";
```

In `generate`, direkt **nach** `this.state.run = { kind: "idle" };` (also im try-Zweig nach dem Setzen von `state.image`):

```ts
      // Erst bei Erfolg aufnehmen — sonst füllt sich die Liste mit Halbsätzen und
      // Fehlversuchen. saveSettings bewusst fire-and-forget: ein langsamer Schreibvorgang
      // darf das fertige Bild nicht aufhalten.
      this.settings.promptHistory = pushHistory(this.settings.promptHistory, prompt);
      void this.saveSettings();
```

- [ ] **Step 3: CSS ergänzen**

Hänge an `styles.css` an:

```css
.lig-prompt-row { display: flex; align-items: flex-start; gap: var(--size-4-1); }
.lig-prompt-row .lig-prompt { flex: 1 1 auto; }
```

- [ ] **Step 4: Gate laufen lassen**

Run: `npm run gate`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/obsidian/view.ts src/main.ts styles.css
git commit -m "$(cat <<'EOF'
feat(view): Prompt-Historie als Menü neben dem Prompt

Einträge entstehen nur bei erfolgreicher Generierung.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Create-as-note

**Files:**
- Modify: `src/main.ts:179-197` (`saveImage` umbauen, `createNote` ergänzen)

**Interfaces:**
- Consumes: `buildImageNote` (Task 6), `buildNoteFilename`/`dirOf`/`dedupeFilename` (Task 5), `GenParams` (Task 6), `STRINGS.saved`/`noteFailed` (Task 8), `settings.createMode`/`noteFolder` (Task 1)
- Produces: nichts für spätere Tasks

**Fehler-Semantik (Spec §8):** Das Bild wird zuerst geschrieben. Scheitert danach die Notiz, bleibt das Bild bestehen und der Nutzer bekommt eine Meldung, die **beides** sagt — nicht das irreführende „Save failed", das den Eindruck erweckt, gar nichts sei entstanden.

- [ ] **Step 1: Imports ergänzen**

In `src/main.ts`:

```ts
import { buildImageFilename, buildNoteFilename, dedupeFilename, dirOf, isoStamp } from "./core/filename";
import { buildImageNote } from "./core/note";
import type { GenParams, PanelState } from "./core/viewmodel";
```

(`PanelState` steht dort bereits als Type-Import — zusammenführen, nicht doppelt importieren.)

- [ ] **Step 2: `createNote` ergänzen**

Als neue private Methode direkt **vor** `saveImage`:

```ts
  // Ergebnis-Notiz neben/statt dem Bild anlegen. Spiegelt resolveImagePath: fehlender
  // Zielordner wird angelegt, Kollisionen bekommen -2, -3, … angehängt.
  private async createNote(params: GenParams, imagePath: string): Promise<TFile> {
    const configured = this.settings.noteFolder.trim();
    const folder = configured === "" ? dirOf(imagePath) : normalizePath(configured);
    if (folder !== "" && !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
      await this.app.vault.createFolder(folder).catch(() => undefined);
    }
    const name = buildNoteFilename(params.prompt, params.seed);
    const path = dedupeFilename(
      folder === "" ? name : normalizePath(`${folder}/${name}`),
      (p) => this.app.vault.getAbstractFileByPath(p) !== null,
    );
    return this.app.vault.create(path, buildImageNote(params, imagePath));
  }
```

- [ ] **Step 3: `saveImage` umbauen**

Ersetze `saveImage` vollständig:

```ts
  private async saveImage(mode: "create" | "insert"): Promise<void> {
    const img = this.state.image;
    if (!img) return;
    let file: TFile;
    try {
      const path = await this.resolveImagePath(buildImageFilename(new Date(), img.params.seed));
      file = await this.app.vault.createBinary(path, dataUrlToBytes(img.dataUrl));
    } catch (e) {
      new Notice(STRINGS.saveFailed(e instanceof Error ? e.message : String(e)));
      return;
    }

    if (mode === "insert") {
      const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
      if (editor) editor.replaceSelection(`![[${file.path}]]`);
      else new Notice(STRINGS.insertNeedsEditor);
      new Notice(STRINGS.saved(file.path));
      return;
    }

    if (this.settings.createMode !== "note") {
      await this.app.workspace.getLeaf(true).openFile(file);
      new Notice(STRINGS.saved(file.path));
      return;
    }

    // Ab hier ist das Bild bereits geschrieben. Ein Fehler in der Notiz darf es NICHT
    // entwerten — deshalb eigener try und eine Meldung, die beides benennt.
    try {
      const note = await this.createNote(img.params, file.path);
      await this.app.workspace.getLeaf(true).openFile(note);
      new Notice(STRINGS.saved(note.path));
    } catch (e) {
      new Notice(STRINGS.noteFailed(e instanceof Error ? e.message : String(e), file.path));
    }
  }
```

- [ ] **Step 4: Gate laufen lassen**

Run: `npm run gate`
Expected: PASS. Meldet der Typecheck `file` als möglicherweise nicht zugewiesen, prüfe, dass der erste `catch`-Zweig mit `return` endet.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "$(cat <<'EOF'
feat(main): Create legt optional eine Ergebnis-Notiz mit Frontmatter an

Bild zuerst, Notiz danach: scheitert die Notiz, bleibt das Bild erhalten und die Meldung
benennt beides statt irreführend "Save failed" zu sagen.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Collapsible + FolderSuggest vendoren

**Files:**
- Create: `src/obsidian/collapsible.ts`
- Create: `src/obsidian/folder-suggest.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: nichts
- Produces: `collapsibleSection(containerEl, opts): HTMLElement`, `CollapsibleStorage`, `CollapsibleOptions`, `resolveCollapsed(key, defaultCollapsed, storage)`, `FolderSuggest` — alle von Task 14 genutzt

**Warum `src/obsidian/` und nicht `src/vendor/kit/`:** beide importieren `obsidian`. `scripts/check-pure.mjs` scannt `src/core` und `src/vendor/kit` und würde hart fehlschlagen.

**Warum das CSS mit muss:** das Kit-Original exportiert am Ende ein `COLLAPSIBLE_CSS`-Snippet mit dem Kommentar „das Kit injiziert bewusst kein CSS selbst (asset-/seiteneffektfrei)". Wer nur die Funktion kopiert, bekommt eine Sektion ohne Chevron-Styling, deren Body sich **nie versteckt** (`.is-collapsed { display: none }` fehlt dann). Das Snippet wandert deshalb wörtlich in `styles.css` — und der `COLLAPSIBLE_CSS`-Export entfällt beim Vendoren, weil er hier keinen Konsumenten hätte.

- [ ] **Step 1: `collapsible.ts` anlegen**

Erzeuge `src/obsidian/collapsible.ts`:

```ts
/** Einklappbare Settings-Sektion.
 *  VENDORED aus `obsidian-kit/src/obsidian/collapsible.ts` (Stand 2026-07-16).
 *  Abweichung: der `COLLAPSIBLE_CSS`-Export des Originals entfällt — das Snippet steht
 *  wörtlich in unserer styles.css (das Kit injiziert bewusst kein CSS selbst).
 *  Liegt in src/obsidian/ und NICHT in src/vendor/kit/, weil es `obsidian` importiert
 *  und check:pure dort hart fehlschlägt. */
import { setIcon } from "obsidian";

/** Optionaler Persistenz-Callback für den Auf-/Zu-Zustand. Der Consumer verdrahtet ihn
 *  an seinen eigenen Speicher (z. B. data.json); das Kit bleibt storage-agnostisch. */
export interface CollapsibleStorage {
  /** Persistierter Zustand, oder `undefined` wenn für den Key noch nichts gespeichert ist
   *  (dann greift `defaultCollapsed`). */
  getCollapsed(key: string): boolean | undefined;
  setCollapsed(key: string, collapsed: boolean): void;
}

export interface CollapsibleOptions {
  /** Sichtbarer Sektions-Titel (im setHeading-Look). */
  title: string;
  /** Startzustand ohne persistierten Wert. Default: true (eingeklappt). */
  defaultCollapsed?: boolean;
  /** Stabiler Schlüssel für die Persistenz (nur mit storage wirksam). */
  key?: string;
  storage?: CollapsibleStorage;
}

/** Löst den initialen Collapsed-Zustand auf: persistierter Wert falls gesetzt, sonst
 *  defaultCollapsed. Pure — kein DOM. */
export function resolveCollapsed(
  key: string | undefined,
  defaultCollapsed: boolean,
  storage?: CollapsibleStorage,
): boolean {
  const stored = key && storage ? storage.getCollapsed(key) : undefined;
  return stored ?? defaultCollapsed;
}

/** Rendert eine einklappbare Sektion (klickbarer Header + Body) in containerEl und gibt den
 *  Body-Container zurück — der Consumer baut seine Inhalte dort hinein. */
export function collapsibleSection(containerEl: HTMLElement, opts: CollapsibleOptions): HTMLElement {
  const defaultCollapsed = opts.defaultCollapsed ?? true;
  let collapsed = resolveCollapsed(opts.key, defaultCollapsed, opts.storage);

  const section = containerEl.createDiv({ cls: "okit-collapsible" });
  const header = section.createDiv({ cls: "okit-collapsible-header" });
  // a11y: der Header ist funktional ein Aufklapp-Schalter — fokussierbar + rollen-/
  // zustands-annotiert, damit er per Tastatur und von Screenreadern bedienbar ist.
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  const chevron = header.createSpan({ cls: "okit-collapsible-chevron" });
  header.createSpan({ cls: "okit-collapsible-title", text: opts.title });
  const body = section.createDiv({ cls: "okit-collapsible-body" });

  const apply = (): void => {
    setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
    header.setAttribute("aria-expanded", String(!collapsed));
    body.toggleClass("is-collapsed", collapsed);
    section.toggleClass("is-collapsed", collapsed);
  };
  apply();

  const toggle = (): void => {
    collapsed = !collapsed;
    if (opts.key && opts.storage) opts.storage.setCollapsed(opts.key, collapsed);
    apply();
  };

  header.addEventListener("click", () => {
    toggle();
  });
  header.addEventListener("keydown", (evt: KeyboardEvent) => {
    // Enter/Leertaste sind die Standard-Aktivierung eines role="button"; bei der Leertaste
    // sonst scrollt die Seite, daher preventDefault (bei Enter unschädlich).
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      toggle();
    }
  });

  return body;
}
```

- [ ] **Step 2: `folder-suggest.ts` anlegen**

Erzeuge `src/obsidian/folder-suggest.ts`:

```ts
/** Autocomplete-Suggest für Vault-Ordner in einem Text-Input-Feld.
 *  VENDORED aus `vault-rag/src/settings.ts` (Stand 2026-07-16, dort modul-privat —
 *  hier exportiert). Zwei Details des Originals sind bewusst erhalten, weil sie beim
 *  Neubau typischerweise fehlen:
 *  (1) `dispatchEvent(new Event("input"))` — ohne das feuert Obsidians Setting-onChange
 *      nach einer Klick-Auswahl NICHT, der gewählte Ordner würde also nie gespeichert.
 *  (2) `slice(0, 20)` — deckelt die Vorschlagsliste in großen Vaults. */
import { AbstractInputSuggest, type App, type TFolder } from "obsidian";

export class FolderSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private textInputEl: HTMLInputElement,
  ) {
    super(app, textInputEl);
  }

  getSuggestions(query: string): string[] {
    const q = query.toLowerCase();
    return this.app.vault
      .getAllFolders()
      .map((f: TFolder) => f.path)
      .filter((p: string) => p.toLowerCase().includes(q))
      .slice(0, 20);
  }

  renderSuggestion(path: string, el: HTMLElement): void {
    el.setText(path);
  }

  selectSuggestion(path: string, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(path);
    this.textInputEl.dispatchEvent(new Event("input"));
    this.close();
  }
}
```

- [ ] **Step 3: CSS des Kit-Snippets übernehmen**

Hänge an `styles.css` an (wörtlich aus `COLLAPSIBLE_CSS` des Kit-Originals — Präfix `okit-` bleibt, damit ein späterer Sync mit dem Kit trivial bleibt):

```css
/* vendored aus obsidian-kit COLLAPSIBLE_CSS (das Kit injiziert bewusst kein CSS selbst) */
.okit-collapsible-header {
  display: flex; align-items: center; gap: var(--size-4-2);
  cursor: pointer; padding: var(--size-4-2) 0;
  font-weight: var(--font-semibold); color: var(--text-normal);
  border-bottom: 1px solid var(--background-modifier-border);
}
.okit-collapsible-header:hover { color: var(--text-accent); }
.okit-collapsible-header:focus-visible {
  outline: 2px solid var(--interactive-accent);
  outline-offset: 2px;
  border-radius: var(--radius-s);
}
.okit-collapsible-chevron { display: inline-flex; color: var(--text-muted); }
.okit-collapsible-body { padding-top: var(--size-4-2); }
.okit-collapsible-body.is-collapsed { display: none; }
```

- [ ] **Step 4: Gate laufen lassen**

Run: `npm run gate`
Expected: PASS. Meldet der Typecheck `getAllFolders` als unbekannt, ist die `obsidian`-Typdefinition zu alt: `npm i -D obsidian@latest` und erneut versuchen.

- [ ] **Step 5: Commit**

```bash
git add src/obsidian/collapsible.ts src/obsidian/folder-suggest.ts styles.css
git commit -m "$(cat <<'EOF'
feat(vendor): Collapsible (obsidian-kit) und FolderSuggest (vault-rag) vendoren

Beide importieren obsidian → src/obsidian/, nicht src/vendor/kit/ (check:pure).
Das CSS-Snippet des Kit-Collapsible wandert mit in styles.css — ohne es klappt die
Sektion nie zu.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Settings-Tab umbauen + Preset-Editor

**Files:**
- Create: `src/obsidian/preset-editor.ts`
- Modify: `src/obsidian/settings-tab.ts` (komplett ersetzen)

**Interfaces:**
- Consumes: `collapsibleSection`, `CollapsibleStorage` (Task 13), `FolderSuggest` (Task 13), `StylePreset`/`LigSettings` (Task 1), alle `settings*`-STRINGS (Task 8)
- Produces: nichts

> **Der Fallstrick, den dieser Task explizit vermeidet:** Obsidians `onChange` feuert **pro Tastendruck**. Ein Editor, der bei jeder Änderung speichert *und neu rendert*, verliert nach jedem Buchstaben den Fokus und arbeitet mit stale Render-Indizes. Deshalb: Textfelder committen auf **`blur`**, und neu gerendert wird **nur** bei Hinzufügen/Löschen. (Quelle: `_docs/LESSONS.md`, vim-dojo 0.5.0 — dort exakt dieser Bug, Fix = commit-on-blur.)
>
> **Und die zweite Falle:** Presets werden **immer immutabel ersetzt** (`map` + Spread), nie in-place mutiert. `mergeSettings` klont Arrays nur flach (`value.slice()`), sodass die Preset-Objekte beim ersten Start noch auf `DEFAULT_PRESETS` zeigen — ein `p.label = "x"` würde die Modul-Konstante verändern.

- [ ] **Step 1: Preset-Editor anlegen**

Erzeuge `src/obsidian/preset-editor.ts`:

```ts
// Preset-Editor für den Settings-Tab (Spec §7.5).
import { Setting } from "obsidian";
import type { StylePreset } from "../core/settings";
import { STRINGS } from "../core/strings";

export interface PresetEditorHost {
  getPresets(): StylePreset[];
  setPresets(next: StylePreset[]): Promise<void>;
  /** Nur bei Hinzufügen/Löschen aufrufen — NIE bei Textänderungen. */
  rerender(): void;
}

// Immer immutabel ersetzen, nie in-place mutieren: mergeSettings klont Arrays nur flach,
// die Preset-Objekte können also noch DEFAULT_PRESETS aus src/core/settings.ts sein.
async function patch(host: PresetEditorHost, id: string, change: Partial<StylePreset>): Promise<void> {
  await host.setPresets(host.getPresets().map((p) => (p.id === id ? { ...p, ...change } : p)));
}

export function renderPresetEditor(containerEl: HTMLElement, host: PresetEditorHost): void {
  for (const preset of host.getPresets()) {
    const setting = new Setting(containerEl);

    setting.addText((t) => {
      t.setPlaceholder(STRINGS.settingsPresetLabel).setValue(preset.label);
      t.inputEl.setAttribute("aria-label", STRINGS.settingsPresetLabel);
      // Commit auf blur, NICHT über onChange: onChange feuert pro Tastendruck; speichern
      // und neu rendern je Zeichen würde den Fokus nach jedem Buchstaben verlieren
      // (Lesson vim-dojo 0.5.0). Hier bewusst KEIN rerender.
      t.inputEl.addEventListener("blur", () => {
        void patch(host, preset.id, { label: t.getValue().trim() });
      });
    });

    setting.addText((t) => {
      t.setPlaceholder(STRINGS.settingsPresetSuffix).setValue(preset.suffix);
      t.inputEl.setAttribute("aria-label", STRINGS.settingsPresetSuffix);
      t.inputEl.addClass("lig-preset-suffix");
      t.inputEl.addEventListener("blur", () => {
        void patch(host, preset.id, { suffix: t.getValue().trim() });
      });
    });

    setting.addExtraButton((b) =>
      b
        .setIcon("trash")
        .setTooltip(STRINGS.settingsPresetDelete)
        .onClick(() => {
          void (async () => {
            await host.setPresets(host.getPresets().filter((p) => p.id !== preset.id));
            host.rerender();
          })();
        }),
    );
  }

  new Setting(containerEl).addButton((b) =>
    b.setButtonText(STRINGS.settingsPresetAdd).onClick(() => {
      void (async () => {
        const fresh: StylePreset = { id: crypto.randomUUID(), label: "", suffix: "" };
        await host.setPresets([...host.getPresets(), fresh]);
        host.rerender();
      })();
    }),
  );
}
```

- [ ] **Step 2: Settings-Tab ersetzen**

Ersetze `src/obsidian/settings-tab.ts` vollständig:

```ts
// Settings (UI-STANDARD §5): Modell zuerst, Ausgabe, Presets, Gefährliches ans Ende.
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { totalApproxBytes, MODEL_FILES } from "../core/model-manifest";
import { STRINGS } from "../core/strings";
import { collapsibleSection, type CollapsibleStorage } from "./collapsible";
import { ConfirmModal } from "./confirm-modal";
import { FolderSuggest } from "./folder-suggest";
import { renderPresetEditor } from "./preset-editor";
import type LocalImageGeneratorPlugin from "../main";

export class LigSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: LocalImageGeneratorPlugin,
  ) {
    super(app, plugin);
  }

  // Auf-/Zu-Zustand landet in data.json (der Kit-Baustein bleibt storage-agnostisch).
  private storage: CollapsibleStorage = {
    getCollapsed: (key) => this.plugin.settings.sectionsCollapsed[key],
    setCollapsed: (key, collapsed) => {
      this.plugin.settings.sectionsCollapsed[key] = collapsed;
      void this.plugin.saveSettings();
    },
  };

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderModel(collapsibleSection(containerEl, {
      title: STRINGS.settingsModelHeading,
      key: "model",
      defaultCollapsed: false,
      storage: this.storage,
    }));

    this.renderOutput(collapsibleSection(containerEl, {
      title: STRINGS.settingsOutputHeading,
      key: "output",
      defaultCollapsed: false,
      storage: this.storage,
    }));

    const presets = collapsibleSection(containerEl, {
      title: STRINGS.settingsPresetsHeading,
      key: "presets",
      defaultCollapsed: true,
      storage: this.storage,
    });
    presets.createEl("p", { text: STRINGS.settingsPresetsDesc, cls: "setting-item-description" });
    renderPresetEditor(presets, {
      getPresets: () => this.plugin.settings.presets,
      setPresets: async (next) => {
        this.plugin.settings.presets = next;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      },
      rerender: () => this.display(),
    });

    this.renderDanger(collapsibleSection(containerEl, {
      title: STRINGS.settingsDangerHeading,
      key: "danger",
      defaultCollapsed: true,
      storage: this.storage,
    }));
  }

  private renderModel(el: HTMLElement): void {
    const gb = (totalApproxBytes(MODEL_FILES) / 1e9).toFixed(1);
    const modelSetting = new Setting(el)
      .setName("SD-Turbo (ONNX, fp16)")
      .setDesc(STRINGS.settingsModelDesc);
    void this.plugin.modelStore.isComplete().then((complete) => {
      if (complete) {
        modelSetting.addExtraButton((b) => b.setIcon("circle-check").setTooltip("Downloaded"));
      } else {
        modelSetting.addButton((b) =>
          b
            .setButtonText(`${STRINGS.settingsDownload} (~${gb} GB)`)
            .setCta()
            .onClick(async () => {
              b.setDisabled(true);
              try {
                await this.plugin.downloadModel((pct) => b.setButtonText(`${pct}%`));
                new Notice("Model downloaded");
              } catch (e) {
                new Notice(String(e instanceof Error ? e.message : e));
              }
              this.display();
            }),
        );
      }
    });
  }

  private renderOutput(el: HTMLElement): void {
    new Setting(el)
      .setName(STRINGS.settingsOutputFolder)
      .setDesc(STRINGS.settingsOutputFolderDesc)
      .addText((t) => {
        new FolderSuggest(this.app, t.inputEl);
        t.setValue(this.plugin.settings.outputFolder).onChange(async (v) => {
          this.plugin.settings.outputFolder = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName(STRINGS.settingsNoteFolder)
      .setDesc(STRINGS.settingsNoteFolderDesc)
      .addText((t) => {
        new FolderSuggest(this.app, t.inputEl);
        t.setValue(this.plugin.settings.noteFolder).onChange(async (v) => {
          this.plugin.settings.noteFolder = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName(STRINGS.settingsCreateMode)
      .setDesc(STRINGS.settingsCreateModeDesc)
      .addDropdown((d) => {
        d.addOption("image", STRINGS.settingsCreateModeImage);
        d.addOption("note", STRINGS.settingsCreateModeNote);
        d.setValue(this.plugin.settings.createMode).onChange(async (v) => {
          this.plugin.settings.createMode = v === "note" ? "note" : "image";
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName(STRINGS.settingsDefaultSteps)
      .setDesc(STRINGS.settingsDefaultStepsDesc)
      .addSlider((s) =>
        s
          .setLimits(1, 4, 1)
          .setValue(this.plugin.settings.defaultSteps)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.defaultSteps = v;
            await this.plugin.saveSettings();
          }),
      );
  }

  private renderDanger(el: HTMLElement): void {
    new Setting(el).setName(STRINGS.settingsDelete).addButton((b) =>
      b
        .setButtonText(STRINGS.settingsDelete)
        .setWarning()
        .onClick(() => {
          new ConfirmModal(this.app, STRINGS.settingsDeleteConfirm, STRINGS.confirm, async () => {
            await this.plugin.modelStore.deleteAll();
            this.plugin.onModelDeleted();
            this.display();
          }).open();
        }),
    );
  }
}
```

- [ ] **Step 3: `refreshViews` in `main.ts` öffentlich machen**

Der Preset-Editor muss die Chips aktualisieren können. In `src/main.ts` die Methode

```ts
  private refreshView(): void {
```

umbenennen in:

```ts
  refreshViews(): void {
```

und **alle** internen Aufrufe von `this.refreshView()` auf `this.refreshViews()` anpassen (Vorkommen in `initStatus`, `downloadModel`, `onModelDeleted`, `generate`).

Run: `grep -n "refreshView\b" src/main.ts`
Expected: keine Treffer mehr (nur noch `refreshViews`).

- [ ] **Step 4: CSS ergänzen**

Hänge an `styles.css` an:

```css
.lig-preset-suffix { flex: 1 1 14em; }
```

- [ ] **Step 5: Gate laufen lassen**

Run: `npm run gate`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/obsidian/settings-tab.ts src/obsidian/preset-editor.ts src/main.ts styles.css
git commit -m "$(cat <<'EOF'
feat(settings): einklappbare Sektionen, Ordner-Autocomplete, Preset-Editor

Preset-Textfelder committen auf blur statt onChange — onChange feuert pro Tastendruck,
Speichern+Rerender je Zeichen frisst den Fokus (Lesson vim-dojo 0.5.0). Presets werden
immutabel ersetzt, weil mergeSettings Arrays nur flach klont.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Deploy + manueller Smoke-Test

**Files:** keine

- [ ] **Step 1: Gate + Deploy**

```bash
npm run gate
OBSIDIAN_PLUGIN_DIR="/Users/Shared/10_ObsidianVaults/10_Pallas/.obsidian/plugins/local-image-generator" npm run deploy
```

Expected: Gate grün, drei Dateien kopiert (`main.js`, `manifest.json`, `styles.css`).

- [ ] **Step 2: Übergabe an Jay**

Der manuelle Test läuft nicht hier — er kommt als `/user-handover`-Note mit abhakbarer Checkliste. Zu prüfen sind:

1. Obsidian neu laden (Cmd+R), Sidebar öffnen → Chip-Zeile mit vier Stilen sichtbar.
2. Chip klicken → Suffix erscheint im Prompt, Chip leuchtet. Erneut klicken → verschwindet.
3. Suffix von Hand aus dem Prompt löschen → Chip geht von selbst aus.
4. Generieren, Seed sperren, Prompt ändern, „Regenerate" → **derselbe** Seed im Feld.
5. Uhr-Icon → der eben generierte Prompt steht in der Liste, Klick setzt ihn zurück.
6. Settings → alle vier Sektionen klappen auf/zu und **überleben das Schließen** der Settings.
7. Settings → Ausgabe → Ordnerfeld tippen → Autocomplete zeigt Vault-Ordner, Klick speichert.
8. Settings → Create-Button auf „Image + note", Notiz-Ordner auf `00_Inbox`.
9. Generieren → Create → Notiz öffnet sich, Frontmatter stimmt (Prompt, Seed, Steps, Modell, Datum), Bild ist eingebettet.
10. Preset-Editor: Label ändern, Feld verlassen → Wert bleibt, **Fokus springt nicht weg**. Sidebar zeigt das neue Label.
11. Preset hinzufügen/löschen → Chips folgen.

---

## Selbst-Review

**Spec-Abdeckung** — jede Anforderung hat einen Task:

| Spec | Task |
|---|---|
| §5.1 Settings-Datenmodell | 1 |
| §5.2 GenParams / image-Umbau | 6, 7 |
| §6 `history.ts` | 2 |
| §6 `presets.ts` | 3 |
| §6 `note.ts` | 6 |
| §6 `vendor/kit/frontmatter.ts` | 4 |
| §6 `folder-suggest.ts` | 13 |
| §6 `collapsible.ts` | 13 |
| §6 `preset-editor.ts` | 14 |
| §6 `filename.ts` (`buildNoteFilename`) | 5 |
| §7.1 Stil-Presets | 3, 10 |
| §7.2 Seed-Sperre | 9 |
| §7.3 Prompt-Historie | 2, 11 |
| §7.4 Create-as-note | 6, 12 |
| §7.5 Settings-Tab | 13, 14 |
| §8 Fehlerpfade | 12 (Notiz-Fehler entwertet Bild nicht), 14 (defensiver Preset-Render) |
| §9 Tests | 1–6 |

**Abweichung von §6 der Spec, bewusst:** Die Spec stellt eine Auslagerung der Prompt-Leiste nach `src/obsidian/prompt-controls.ts` in Aussicht, „wenn `view.ts` über ~250 Zeilen geht". Nach Tasks 9–11 liegt `view.ts` bei geschätzt ~230 Zeilen — der Split ist deshalb **nicht** eingeplant. Reißt die Datei die Schwelle doch, gehört er als eigener Refactor-Task hinterher, nicht in einen Feature-Task.

**Ergänzung gegenüber §6:** `MODEL_ID` (Task 6, in `model-manifest.ts`) und `isoStamp`/`dirOf` (Task 5, in `filename.ts`) stehen nicht in der Spec-Dateitabelle. Beides sind Ein-Zeilen-Helfer für Frontmatter-Werte, die keine eigene Datei rechtfertigen.

**Fehlender §8-Punkt, nachgetragen:** „Presets in data.json beschädigt → defensiv filtern" ist in Task 14 nur als Kommentar erwähnt, nicht als Code. Bewusste Entscheidung: `renderPresetEditor` liest `label`/`suffix` ausschließlich über `setValue()`, das auch mit `undefined` nicht wirft; ein kaputter Eintrag erscheint als leere Zeile und ist löschbar. Ein zusätzlicher Filter würde stille Datenverluste erzeugen (Eintrag verschwindet ohne Meldung) — die leere, löschbare Zeile ist das ehrlichere Verhalten.

**Typ-Konsistenz geprüft:** `GenParams` (Task 6) wird in 6, 7, 12 identisch verwendet · `ViewHost.getSettings` (Task 9) in 9, 10, 11 · `FolderSuggest`/`collapsibleSection` (Task 13) in 14 · `pushHistory`/`historyLabel` (Task 2) in 11 · `togglePresetInPrompt`/`presetActive` (Task 3) in 10 · `buildImageNote` (Task 6) in 12 · `buildNoteFilename`/`dirOf` (Task 5) in 12 · `refreshViews` (Task 14, Step 3) wird nur dort und im Preset-Host aufgerufen.
