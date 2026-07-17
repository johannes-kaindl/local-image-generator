# History-Tab + Button-Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der eine Sidebar-View wird ein Tab-Hub (Generate | History); das Seed-Schloss entfällt, „Regenerate" wird „Reroll", und die Historie speichert volle Rezepte (prompt+seed+steps+model+created) mit eigenem Tab, Dedup, Prompt-Gruppierung, Löschen je Eintrag und Reset.

**Architecture:** vault-rags Hub-Muster (`buildInto` + `HubPanel`) wird nach `src/obsidian/hub.ts` vendored; `GeneratorView` wird zur Hülle mit zwei `HubPanel`-Implementierungen (`GeneratePanel`, `HistoryPanel`). Die gesamte Historie-Logik (Dedup, Gruppierung, Löschen, Migration) liegt pure und TDD-getestet in `src/core/`; die DOM-Schicht (Hub/Panels) wird über Gate-Build + Smoke-Test verifiziert (Repo-Konvention — auch der heutige `view.ts` hat keinen Unit-Test).

**Tech Stack:** TypeScript · Obsidian-Plugin · vitest · esbuild.

## Global Constraints

- **Gate vor jedem Commit grün:** `npm run gate` (typecheck + vitest + check:pure + build).
- **Pure-Core-Schnitt:** `src/core/` und `src/vendor/kit/` importieren NIE `obsidian` (Gate: `scripts/check-pure.mjs`, scannt nur diese zwei Wurzeln). `src/obsidian/*` darf `obsidian` importieren.
- **Commit style:** Conventional Commits (deutsch), Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Strings EN-only:** neue UI-Texte kommen nach `src/core/strings.ts` in das `STRINGS`-Objekt, Englisch, sentence case. i18n (DE/EN) ist bewusst eine spätere, eigene Session.
- **HISTORY_LIMIT bleibt 20.**
- **Kein neues Test-Infra:** keine Obsidian-Mock-/vitest-config-Einführung in diesem Plan (out of scope). DOM wird per Build + Smoke verifiziert.
- **Branch:** `feat/history-tab-0.3` (bereits angelegt, Spec liegt committed).

---

## Task 1: Datenmodell, pure History-Funktionen, Migration, Recording

Volles Rezept-Modell end-to-end, gate-grün: `history.ts` bekommt die neuen puren Funktionen, `settings.ts` das Modell + Migration, `main.ts` zeichnet das eingefrorene Rezept auf, und das alte Historie-Menü in `view.ts` wird entfernt (die neue History lebt später im Tab). Nach dieser Task existiert kurzzeitig keine History-UI — das ist gewollt (jeder Commit grün, Feature wächst).

**Files:**
- Modify: `src/core/history.ts` (Funktionen auf `HistoryEntry` umstellen, `groupByPrompt`/`deleteEntry` neu)
- Modify: `src/core/settings.ts` (`HistoryEntry`, `history`, `historyView`, Migration)
- Modify: `src/main.ts:6` (Import) und `src/main.ts:175-178` (Recording)
- Modify: `src/obsidian/view.ts:73-95` (altes History-Menü entfernen) + `:4` (Import `historyLabel` entfernen)
- Test: `tests/history.test.ts`, `tests/settings.test.ts`

**Interfaces:**
- Produces:
  - `interface HistoryEntry { prompt: string; seed: number; steps: number; model: string; created: string }` (in `src/core/settings.ts`)
  - `pushHistory(list: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[]`
  - `groupByPrompt(list: readonly HistoryEntry[]): { prompt: string; entries: HistoryEntry[] }[]`
  - `deleteEntry(list: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[]`
  - `LigSettings.history: HistoryEntry[]`, `LigSettings.historyView: "recent" | "grouped"`

- [ ] **Step 1: Historie-Tests auf `HistoryEntry` umschreiben**

Ersetze `tests/history.test.ts` vollständig (die alten string-basierten `pushHistory`-Tests entfallen, `historyLabel`-Tests bleiben):

```ts
import { describe, expect, it } from "vitest";
import { HISTORY_LIMIT, historyLabel, pushHistory, groupByPrompt, deleteEntry } from "../src/core/history";
import type { HistoryEntry } from "../src/core/settings";

function e(prompt: string, seed: number, steps = 4, created = "2026-07-17T10:00:00"): HistoryEntry {
  return { prompt, seed, steps, model: "sd-turbo", created };
}

describe("pushHistory", () => {
  it("nimmt den ersten Eintrag auf", () => {
    expect(pushHistory([], e("an apple", 1))).toEqual([e("an apple", 1)]);
  });

  it("stellt Neues nach vorn", () => {
    expect(pushHistory([e("a", 1)], e("b", 2))).toEqual([e("b", 2), e("a", 1)]);
  });

  it("dedupliziert nach vollem Rezept (prompt+seed+steps identisch → nach vorn)", () => {
    const list = [e("a", 1), e("b", 2), e("c", 3)];
    expect(pushHistory(list, e("c", 3))).toEqual([e("c", 3), e("a", 1), e("b", 2)]);
  });

  it("behält Variationen: gleicher Prompt, anderer Seed = eigener Eintrag", () => {
    const next = pushHistory([e("a", 1)], e("a", 2));
    expect(next).toEqual([e("a", 2), e("a", 1)]);
  });

  it("behandelt anderen Steps-Wert als eigenes Rezept", () => {
    const next = pushHistory([e("a", 1, 4)], e("a", 1, 2));
    expect(next).toHaveLength(2);
  });

  it("trimmt den Prompt und erkennt das Duplikat trotz Whitespace", () => {
    const next = pushHistory([e("a", 1)], { ...e("  a  ", 1), prompt: "  a  " });
    expect(next).toEqual([e("a", 1)]);
  });

  it("ignoriert leere und reine Whitespace-Prompts", () => {
    expect(pushHistory([e("a", 1)], e("", 9))).toEqual([e("a", 1)]);
    expect(pushHistory([e("a", 1)], e("   ", 9))).toEqual([e("a", 1)]);
  });

  it("schneidet am Limit ab und wirft den ältesten weg", () => {
    const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => e(`p${i}`, i));
    const next = pushHistory(full, e("neu", 999));
    expect(next).toHaveLength(HISTORY_LIMIT);
    expect(next[0]).toEqual(e("neu", 999));
    expect(next.some((x) => x.prompt === `p${HISTORY_LIMIT - 1}`)).toBe(false);
  });

  it("mutiert die Eingabeliste nicht", () => {
    const list = [e("a", 1)];
    pushHistory(list, e("b", 2));
    expect(list).toEqual([e("a", 1)]);
  });
});

describe("groupByPrompt", () => {
  it("gruppiert nach Prompt, Gruppen nach jüngstem Eintrag zuerst, innen neueste zuerst", () => {
    // Liste ist MRU (neueste zuerst): a@t3, b@t2, a@t1
    const list = [e("a", 3, 4, "t3"), e("b", 2, 4, "t2"), e("a", 1, 4, "t1")];
    expect(groupByPrompt(list)).toEqual([
      { prompt: "a", entries: [e("a", 3, 4, "t3"), e("a", 1, 4, "t1")] },
      { prompt: "b", entries: [e("b", 2, 4, "t2")] },
    ]);
  });

  it("liefert eine leere Liste für leere Historie", () => {
    expect(groupByPrompt([])).toEqual([]);
  });
});

describe("deleteEntry", () => {
  it("entfernt genau den passenden Eintrag über Wert (nicht Index)", () => {
    const list = [e("a", 1), e("a", 2), e("b", 3)];
    expect(deleteEntry(list, e("a", 2))).toEqual([e("a", 1), e("b", 3)]);
  });

  it("lässt die Liste unverändert, wenn nichts passt", () => {
    const list = [e("a", 1)];
    expect(deleteEntry(list, e("z", 9))).toEqual([e("a", 1)]);
  });

  it("mutiert die Eingabeliste nicht", () => {
    const list = [e("a", 1)];
    deleteEntry(list, e("a", 1));
    expect(list).toEqual([e("a", 1)]);
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

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npm test -- history`
Expected: FAIL (`groupByPrompt`/`deleteEntry` nicht exportiert, `pushHistory`-Signatur passt nicht, `HistoryEntry` fehlt in settings).

- [ ] **Step 3: `HistoryEntry` + Settings-Felder + Migration in `src/core/settings.ts`**

`HistoryEntry`-Interface direkt über `LigSettings` einfügen:

```ts
/** Ein aufgezeichnetes Rezept in der Historie (volle Reproduktion). */
export interface HistoryEntry {
  prompt: string;
  seed: number;
  steps: number;
  model: string;
  /** Lokaler ISO-8601-Stempel, beim Generier-Erfolg eingefroren (siehe isoStamp). */
  created: string;
}
```

In `LigSettings` die Zeile `promptHistory: string[]` ersetzen durch:

```ts
  /** MRU, neueste zuerst — volle Rezepte. Zustand, kein Regler. */
  history: HistoryEntry[];
  /** Ansicht des Historie-Tabs. */
  historyView: "recent" | "grouped";
```

In `DEFAULT_SETTINGS` `promptHistory: []` ersetzen durch:

```ts
  history: [],
  historyView: "recent",
```

Die Funktion `sanitizePromptHistory` löschen und ersetzen durch:

```ts
function sanitizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (h): h is HistoryEntry =>
      isPlainObject(h) &&
      typeof h["prompt"] === "string" &&
      typeof h["seed"] === "number" &&
      typeof h["steps"] === "number" &&
      typeof h["model"] === "string" &&
      typeof h["created"] === "string",
  );
}

function sanitizeHistoryView(raw: unknown): "recent" | "grouped" {
  return raw === "grouped" ? "grouped" : "recent";
}
```

Im Rumpf von `sanitizeSettings` die Zeile, die `promptHistory` sanitized, ersetzen durch:

```ts
    history: sanitizeHistory((raw as Record<string, unknown>)["history"]),
    historyView: sanitizeHistoryView((raw as Record<string, unknown>)["historyView"]),
```

> Der alte `promptHistory`-Key aus einer 0.2-`data.json` fällt damit still weg (keine Übernahme) — Alt-Historie wird bewusst verworfen. `mergeSettings` würde `promptHistory` zwar als unbekanntes Feld durchreichen, aber `sanitizeSettings` baut das Ergebnis feldweise neu und nimmt `promptHistory` nicht auf.

**Prüfe** den genauen Aufbau von `sanitizeSettings` in der Datei (feldweiser Neubau) und passe die zwei ersetzten Zeilen an die dort vorhandene Struktur an — nicht raten, die Datei ist die Wahrheit.

- [ ] **Step 4: `src/core/history.ts` auf Rezepte umstellen**

Datei-Inhalt ersetzen (Kopfkommentar + `HISTORY_LIMIT` + `historyLabel` sinngemäß behalten):

```ts
// Prompt-Historie — pure. MRU: neueste zuerst. Dedup nach vollem Rezept (prompt+seed+steps),
// damit Variationen (gleicher Prompt, anderer Seed) erhalten bleiben, aber echte 1:1-
// Wiederholungen kollabieren. Das Limit ist bewusst eine Konstante (YAGNI, kein Regler).
import type { HistoryEntry } from "./settings";

export const HISTORY_LIMIT = 20;

function recipeKey(e: HistoryEntry): string {
  // Modell NICHT im Schlüssel: einmodellig, und ein späterer Modellwechsel soll ein
  // identisches Rezept nicht künstlich verdoppeln. JSON-Tupel als Schlüssel, damit ein
  // Prompt mit Ziffern/Leerzeichen keine falsche Kollision mit Seed/Steps erzeugt.
  return JSON.stringify([e.prompt.trim(), e.seed, e.steps]);
}

/** Nimmt ein Rezept vorn auf; identisches Rezept wandert nach vorn statt zu doppeln.
 *  Leere/Whitespace-Prompts werden ignoriert. Prompt wird getrimmt gespeichert. */
export function pushHistory(list: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const prompt = entry.prompt.trim();
  if (prompt === "") return [...list];
  const normalized: HistoryEntry = { ...entry, prompt };
  const key = recipeKey(normalized);
  return [normalized, ...list.filter((e) => recipeKey(e) !== key)].slice(0, HISTORY_LIMIT);
}

/** Gruppiert nach Prompt. Gruppen nach jüngstem Eintrag zuerst (die Liste ist MRU, also
 *  entspricht das der Reihenfolge des ersten Auftretens), innerhalb der Gruppe neueste zuerst. */
export function groupByPrompt(list: readonly HistoryEntry[]): { prompt: string; entries: HistoryEntry[] }[] {
  const groups: { prompt: string; entries: HistoryEntry[] }[] = [];
  const byPrompt = new Map<string, HistoryEntry[]>();
  for (const e of list) {
    let bucket = byPrompt.get(e.prompt);
    if (!bucket) {
      bucket = [];
      byPrompt.set(e.prompt, bucket);
      groups.push({ prompt: e.prompt, entries: bucket });
    }
    bucket.push(e);
  }
  return groups;
}

/** Entfernt genau den passenden Eintrag über Wert-Gleichheit (nicht Index — Index-Falle
 *  aus REGISTRY Z.84: eine parallele Mutation verschiebt Indizes). */
export function deleteEntry(list: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return list.filter(
    (e) =>
      !(e.prompt === entry.prompt && e.seed === entry.seed && e.steps === entry.steps && e.created === entry.created),
  );
}

/** Einzeiliges, gekürztes Label für die Historie-Anzeige. */
export function historyLabel(prompt: string, max = 60): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
```

- [ ] **Step 5: Historie-Tests laufen lassen — müssen bestehen**

Run: `npm test -- history`
Expected: PASS.

- [ ] **Step 6: Migrations-Tests in `tests/settings.test.ts` ergänzen**

Im `describe("settings", …)`-Block den Test „migriert eine 0.1-data.json …" anpassen: die Zeile `expect(merged.promptHistory).toEqual([]);` entfernen und stattdessen prüfen, dass `sanitizeSettings` die neuen Felder liefert. Neuen `describe`-Block anhängen:

```ts
describe("Historie-Migration", () => {
  it("verwirft eine alte promptHistory (string[]) und startet leer", () => {
    const s = sanitizeSettings({ promptHistory: ["a", "b", "c"] });
    expect(s.history).toEqual([]);
    expect((s as unknown as Record<string, unknown>)["promptHistory"]).toBeUndefined();
  });

  it("behält eine gültige history und defaultet historyView auf recent", () => {
    const entry = { prompt: "a", seed: 1, steps: 4, model: "sd-turbo", created: "2026-07-17T10:00:00" };
    const s = sanitizeSettings({ history: [entry] });
    expect(s.history).toEqual([entry]);
    expect(s.historyView).toBe("recent");
  });

  it("wirft kaputte history-Einträge weg", () => {
    const s = sanitizeSettings({ history: [{ prompt: "a" }, 42, null] });
    expect(s.history).toEqual([]);
  });

  it("übernimmt historyView='grouped'", () => {
    expect(sanitizeSettings({ historyView: "grouped" }).historyView).toBe("grouped");
    expect(sanitizeSettings({ historyView: "quatsch" }).historyView).toBe("recent");
  });
});
```

> `sanitizeSettings` in diesem Repo nimmt das rohe Objekt und baut feldweise neu — prüfe die echte Signatur (nimmt es `unknown` direkt oder ein bereits gemergtes Objekt?) und ruf es im Test genauso auf, wie es die bestehenden `sanitizeSettings`-Tests weiter unten in der Datei tun.

- [ ] **Step 7: Settings-Tests laufen lassen — müssen bestehen**

Run: `npm test -- settings`
Expected: PASS.

- [ ] **Step 8: Recording in `src/main.ts` umstellen**

Import in Zeile 6 bleibt (`pushHistory`); ergänze den Typ-Import falls nötig aus `./core/settings`. Den `if (succeeded)`-Block (aktuell Zeile 175-178) ersetzen:

```ts
    if (succeeded && this.state.image) {
      // Volles Rezept aus dem beim Erfolg eingefrorenen img.params (kein "jetzt"-Nachziehen).
      const p = this.state.image.params;
      this.settings.history = pushHistory(this.settings.history, {
        prompt: p.prompt,
        seed: p.seed,
        steps: p.steps,
        model: p.model,
        created: p.date,
      });
      void this.saveSettings();
    }
```

- [ ] **Step 9: Altes History-Menü aus `src/obsidian/view.ts` entfernen**

Entferne den `histBtn`-Block (aktuell Zeile 73-95: Button-Erzeugung, `setIcon`, das `Menu` mit `promptHistory`). Entferne den jetzt ungenutzten Import `historyLabel` aus Zeile 4 und `Menu` aus dem `obsidian`-Import in Zeile 3, falls nirgends sonst genutzt. Die `promptRow` bleibt (nur das Textarea, kein History-Knopf mehr).

> Nach dieser Task gibt es vorübergehend keine History-UI. Das ist beabsichtigt — der History-Tab kommt in Task 4.

- [ ] **Step 10: Gate + Commit**

Run: `npm run gate`
Expected: typecheck, alle Tests, check:pure und build grün.

```bash
git add src/core/history.ts src/core/settings.ts src/main.ts src/obsidian/view.ts tests/history.test.ts tests/settings.test.ts
git commit -m "feat(history): volles Rezept-Modell + Dedup/Gruppierung/Delete, altes Menü raus

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Feld 1 — Button-Redesign (Schloss raus, Reroll)

Reine DOM-Änderung am heutigen `view.ts` (noch vor der Hub-Extraktion — kleine Änderung zuerst, dann verschieben). Verifiziert über Build + Smoke.

**Files:**
- Modify: `src/core/strings.ts` (`regenerate` → `reroll`, Schloss-Strings entfernen)
- Modify: `src/obsidian/view.ts` (Schloss-Feld/Button/`applyLock` entfernen, `regenBtn` → Reroll)

**Interfaces:**
- Consumes: `STRINGS` aus Task-1-Stand.
- Produces: `STRINGS.reroll: string`.

- [ ] **Step 1: Strings anpassen**

In `src/core/strings.ts`: `regenerate: "Regenerate",` ersetzen durch `reroll: "Reroll",`. Die Schloss-Strings entfernen (`seedLock`, `seedUnlock`, `seedLockedTooltip` — such nach `seedLock` im Objekt). `randomSeed` bleibt (Würfel).

- [ ] **Step 2: Schloss aus `src/obsidian/view.ts` entfernen**

Entferne: das Feld `private seedLocked = false;`; den kompletten `lock`-Block in `onOpen` (aktuell Zeile 127-140: `const lock = …`, `applyLock`, `applyLock()`, `lock.addEventListener`).

- [ ] **Step 3: `regenBtn` → Reroll**

Den `regenBtn`-Block (aktuell Zeile 155-161) ersetzen:

```ts
    this.regenBtn = actions.createEl("button", { text: STRINGS.reroll });
    this.regenBtn.addEventListener("click", () => {
      // Reroll = neuer Zufalls-Seed + generieren. Der obere "Generate"-Knopf nimmt den
      // Seed aus dem Feld und würfelt nie — so sagt jeder Knopf, was er tut.
      this.seedEl.value = String(randomSeed());
      this.host.generate(Number(this.stepsEl.value), Number(this.seedEl.value));
    });
```

Prüfe, dass das Feld weiterhin `private regenBtn!: HTMLButtonElement;` heißt (Umbenennen optional; wenn du es zu `rerollBtn` umbenennst, alle Vorkommen mitziehen).

- [ ] **Step 4: Gate**

Run: `npm run gate`
Expected: grün.

- [ ] **Step 5: Smoke-Hinweis + Commit**

Kein Unit-Test (DOM). Deploy für den späteren Sammel-Smoke-Test: `OBSIDIAN_PLUGIN_DIR=<vault>/.obsidian/plugins/local-image-generator npm run deploy` (optional hier, Pflicht am Branch-Ende).

```bash
git add src/core/strings.ts src/obsidian/view.ts
git commit -m "feat(view): Seed-Schloss raus, Regenerate wird Reroll

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Hub vendoren + GeneratePanel extrahieren + view.ts als Hülle

Der große Umbau: vault-rags Hub-Muster übernehmen, den gesamten View-Inhalt in ein `GeneratePanel` verschieben, `view.ts` auf die Hülle reduzieren. Am Ende ist der View ein Tab-Hub mit **einem** Tab (Generate). Verifiziert über Build + Smoke.

**Files:**
- Create: `src/obsidian/hub.ts` (aus vault-rag kopiert + angepasst)
- Create: `src/obsidian/generate-panel.ts` (aus `view.ts` extrahiert)
- Modify: `src/obsidian/view.ts` (Hülle)
- Modify: `src/core/strings.ts` (Tab-Label `tabGenerate`)
- Modify: `styles.css` (Hub-Tab-Leiste)

**Interfaces:**
- Produces:
  - `type TabId = "generate" | "history"` (in `hub.ts`)
  - `interface HubPanel { readonly id: TabId; readonly label: string; readonly icon: string; mount(container: HTMLElement): void; onShow?(): void; onHide?(): void; destroy(): void }`
  - `interface HubController { setTab(id: TabId): void; currentTab(): TabId; destroy(): void }`
  - `buildInto(root: HTMLElement, panels: HubPanel[], defaultTab: TabId): HubController`
  - `class GeneratePanel implements HubPanel` mit Konstruktor `(host: ViewHost)`

- [ ] **Step 1: `hub.ts` aus vault-rag kopieren + anpassen**

Lies `../vault-rag/src/hub_panel.ts` und `../vault-rag/src/hub_view.ts`. Erstelle `src/obsidian/hub.ts` mit:
- dem `HubPanel`-Interface aus `hub_panel.ts`, aber **`onFileOpen` weglassen** (kein kontextsensitives Panel bei uns) und `TabId = "generate" | "history"`.
- der reinen `buildInto`-Funktion aus `hub_view.ts` (der `static buildInto`-Rumpf) als **freie Funktion** `export function buildInto(...)`, **ohne** die `notifyFileOpen`-Teile. CSS-Präfix `vault-rag-hub` → `lig-hub`. Kopfkommentar ergänzen: `// Vendored aus vault-rag/src/hub_view.ts (Hub-Muster, REGISTRY Z.82). Kit-Extraktion via /drift-audit.`
- `HubController` auf `{ setTab, currentTab, destroy }` reduzieren (kein `notifyFileOpen`).

> Kopieren, nicht abtippen: Übernimm den Fallback-Kommentar („Persistierter Layout-State kann einen Tab referenzieren, dessen Panel nicht gebaut wurde …") und die `onShow`/`onHide`-Reihenfolge **wörtlich** aus der Quelle. Abgetippter Plan-Code ist ungetesteter Code (vim-dojo-Lesson) — die Quelle ist getestet.

- [ ] **Step 2: `GeneratePanel` extrahieren**

Erstelle `src/obsidian/generate-panel.ts`: `export class GeneratePanel implements HubPanel`. Verschiebe **den kompletten Aufbau** aus `view.ts` (`onOpen`-Rumpf ab `const promptRow …` bis inkl. Status-Zeile, plus `renderChips`, `refresh`, die privaten Element-Felder, `randomSeed`, `ViewHost`-Import) in dieses Panel:
- `id = "generate"`, `label = STRINGS.tabGenerate`, `icon = "image-plus"`.
- `mount(container: HTMLElement)`: der bisherige `onOpen`-Aufbau, aber in `container` statt `this.contentEl` (Zeile `const root = this.contentEl.createDiv(...)` → `const root = container.createDiv(...)`). Ruft am Ende `this.refresh()`.
- `refresh()` und `renderChips()` unverändert übernehmen.
- Konstruktor `(private readonly host: ViewHost)`.
- `destroy()`: leer lassen (kein Timer) oder `{}`.

> Der `ViewHost`-Import wandert nach `generate-panel.ts` (oder bleibt in `view.ts` und wird re-exportiert). Halte `ViewHost` als exportierten Typ erreichbar für `main.ts` (heute aus `view.ts`). Am einfachsten: `ViewHost` in `view.ts` belassen und in `generate-panel.ts` importieren.

- [ ] **Step 3: `view.ts` auf die Hülle reduzieren**

`GeneratorView` behält `getViewType/getDisplayText/getIcon`, `VIEW_TYPE`, `ViewHost`. `onOpen`:

```ts
  async onOpen(): Promise<void> {
    const generate = new GeneratePanel(this.host);
    this.panels = [generate];
    this.ctrl = buildInto(this.contentEl, this.panels, this.restoreTab);
  }
```

Felder `private ctrl: HubController | null = null;`, `private panels: HubPanel[] = [];`, `private restoreTab: TabId = "generate";`. `refresh()` delegiert an das GeneratePanel: eine Referenz halten (`this.generatePanel`) und `refresh()` weiterreichen — `main.ts` ruft `view.refresh()` (siehe `refreshViews`).

```ts
  refresh(): void {
    this.generatePanel?.refresh();
  }
```

`onClose`: `this.ctrl?.destroy(); this.contentEl.empty();`.

Tab-Persistenz via `getState`/`setState` (aus vault-rags `hub_view.ts` übernehmen — `getState` liefert `{ tab }`, `setState` liest `tab` und ruft `ctrl.setTab`).

> `main.ts:refreshViews` ruft `view.refresh()` — die Signatur muss erhalten bleiben. Prüfe `main.ts:71-76`.

- [ ] **Step 4: Tab-Label-String + Hub-CSS**

`src/core/strings.ts`: `tabGenerate: "Generate",` ergänzen (Tab-Label; `viewTitle` bleibt für den Leaf-Titel).

`styles.css`: Hub-Tab-Leiste ergänzen (Klassen aus `hub.ts`, Präfix `lig-hub`):

```css
.lig-hub-tabs { display: flex; border-bottom: 1px solid var(--background-modifier-border); }
.lig-hub-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; background: none; border: none; cursor: pointer; color: var(--text-muted); }
.lig-hub-tab.is-active { color: var(--text-normal); font-weight: 600; box-shadow: inset 0 -2px 0 var(--interactive-accent); }
.lig-hub-tab-icon { display: inline-flex; }
.lig-hub-panel.is-hidden { display: none; }
```

> Gotcha (collapsible-Lesson, REGISTRY Z.79): ohne die `.is-hidden { display:none }`-Regel togglet der Hub nichts — CSS zwingend mitliefern.

- [ ] **Step 5: Gate + Smoke + Commit**

Run: `npm run gate` → grün. Deploy + Smoke: der Generate-Tab funktioniert wie zuvor (Prompt, Chips, Steps, Seed, Generate, Reroll, Create/Insert, Status).

```bash
git add src/obsidian/hub.ts src/obsidian/generate-panel.ts src/obsidian/view.ts src/core/strings.ts styles.css
git commit -m "feat(view): Tab-Hub (vault-rag-Muster vendored), GeneratePanel extrahiert

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: HistoryPanel + Host-Verträge + History-Tab-UI

Das zweite Panel: Liste mit Umschalter, Rezept-Laden, Löschen je Eintrag, Reset. Host-Methoden in `main.ts`. Verifiziert über Build + Smoke.

**Files:**
- Create: `src/obsidian/history-panel.ts`
- Modify: `src/obsidian/view.ts` (HistoryPanel in die Panels-Liste, Tab-Wechsel-Zugriff)
- Modify: `src/obsidian/view.ts` `ViewHost`-Interface (neue Methoden)
- Modify: `src/main.ts` (Host-Methoden implementieren)
- Modify: `src/core/strings.ts` (History-Strings)
- Modify: `styles.css` (History-Zeilen/Gruppen/Umschalter)

**Interfaces:**
- Consumes: `HubPanel`, `TabId`, `buildInto` (Task 3); `groupByPrompt`, `deleteEntry` (Task 1); `HistoryEntry` (Task 1); `ConfirmModal` (`src/obsidian/confirm-modal.ts`).
- Produces: `ViewHost` erweitert um
  - `restoreRecipe(entry: HistoryEntry): void`
  - `deleteHistoryEntry(entry: HistoryEntry): void`
  - `clearHistory(): void`
  - `setHistoryView(v: "recent" | "grouped"): void`
  - `showTab(id: TabId): void` (Tab-Wechsel aus dem Panel)
  - `class HistoryPanel implements HubPanel`

- [ ] **Step 1: History-Strings ergänzen**

`src/core/strings.ts`:

```ts
  tabHistory: "History",
  historyEmpty: "No history yet. Generate an image to start.",
  historyViewRecent: "Recent",
  historyViewGrouped: "By prompt",
  historyClear: "Clear all",
  historyClearConfirm: "Clear the entire generation history? This cannot be undone.",
  historyDelete: "Delete entry",
  historyRecipe: (seed: number, steps: number, time: string) => `seed ${seed} · ${steps} steps · ${time}`,
  historyVariations: (n: number) => (n === 1 ? "1 variation" : `${n} variations`),
```

- [ ] **Step 2: `ViewHost` erweitern (`src/obsidian/view.ts`)**

Im `ViewHost`-Interface ergänzen:

```ts
  restoreRecipe(entry: HistoryEntry): void;
  deleteHistoryEntry(entry: HistoryEntry): void;
  clearHistory(): void;
  setHistoryView(v: "recent" | "grouped"): void;
  showTab(id: TabId): void;
```

Import `HistoryEntry` aus `../core/settings`, `TabId` aus `./hub`.

- [ ] **Step 3: `HistoryPanel` bauen (`src/obsidian/history-panel.ts`)**

`export class HistoryPanel implements HubPanel` mit `id = "history"`, `label = STRINGS.tabHistory`, `icon = "history"`, Konstruktor `(private readonly host: ViewHost)`. `mount(container)` baut Kopf (Umschalter `[Recent | By prompt]` + „Clear all") und einen Listen-Container; `render()` liest `host.getSettings().history` + `host.getSettings().historyView` und rendert:

- **recent:** pro Eintrag eine Zeile (`historyLabel(entry.prompt)` + Metazeile `STRINGS.historyRecipe(seed, steps, HH:MM aus created)` + Papierkorb-Button). Klick auf die Zeile → `host.restoreRecipe(entry)`. Papierkorb → `host.deleteHistoryEntry(entry)` + `render()`. `stopPropagation` auf dem Papierkorb, damit der Klick nicht als Zeilen-Klick zählt.
- **grouped:** `groupByPrompt(history)` → pro Gruppe eine einklappbare Kopfzeile (`historyLabel(group.prompt)` + `STRINGS.historyVariations(group.entries.length)`, ▾/▸ per lokalem `Set<string>` collapsed-State), darunter die Variationszeilen (Metazeile + Papierkorb, Klick = restore).
- Leer: `STRINGS.historyEmpty`.

Umschalter-Klick → `host.setHistoryView(v)` + `render()`. „Clear all" → `host.clearHistory()` (der Host zeigt die Rückfrage) + `render()`. `onShow()` ruft `render()` (Historie kann sich im Generate-Tab geändert haben). `destroy()` leer.

Zeit-Formatierung: `new Date(entry.created)` → `HH:MM` lokal (z.B. `d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })`).

> Muster für DOM-Zeilen-Editoren mit Löschen/Klick: `src/obsidian/preset-editor.ts` im selben Repo — gleiche `createEl`/`clickable-icon`/`setIcon`-Idiome übernehmen. Papierkorb-Icon: `setIcon(btn, "trash-2")`.

- [ ] **Step 4: Panel in die Hülle (`src/obsidian/view.ts`)**

`onOpen`: HistoryPanel instanziieren und in die Panels-Liste aufnehmen: `this.panels = [generate, new HistoryPanel(this.host)]`. `showTab` (falls die View sie dem Host bereitstellt) delegiert an `this.ctrl?.setTab(id)`. `refresh()` erweitern, sodass auch das HistoryPanel neu rendert, wenn nötig — am einfachsten: beide Panels halten und in `refresh()` das Generate-Panel refreshen; das History-Panel rendert über `onShow`/eigene Host-Callbacks.

- [ ] **Step 5: Host-Methoden in `src/main.ts`**

Im `host: ViewHost`-Objekt ergänzen:

```ts
      restoreRecipe: (entry) => {
        this.state.prompt = entry.prompt;
        host.setPrompt(entry.prompt); // no-op safe; oder direkt state setzen
        this.pendingRecipe = { prompt: entry.prompt, seed: entry.seed, steps: entry.steps };
        this.refreshViews();
      },
      deleteHistoryEntry: (entry) => {
        this.settings.history = deleteEntry(this.settings.history, entry);
        void this.saveSettings();
        this.refreshViews();
      },
      clearHistory: () => {
        new ConfirmModal(this.app, STRINGS.historyClearConfirm, () => {
          this.settings.history = [];
          void this.saveSettings();
          this.refreshViews();
        }).open();
      },
      setHistoryView: (v) => {
        this.settings.historyView = v;
        void this.saveSettings();
      },
      showTab: (id) => {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
          const view = leaf.view;
          if (view instanceof GeneratorView) view.showTab(id);
        }
      },
```

**Rezept ins Generate-Panel füllen:** Der Klick muss Prompt+Seed+Steps in die *DOM-Felder* des GeneratePanel schreiben und zum Generate-Tab wechseln. Da die Felder im Panel liegen, ist der saubere Weg eine Panel-Methode `applyRecipe({prompt, seed, steps})`, die `promptEl/seedEl/stepsEl` setzt + `refresh()`. `restoreRecipe` im Host ruft dann `view.applyRecipe(...)` + `view.showTab("generate")` (analog zu `showTab`, über `getLeavesOfType`). Ersetze den `pendingRecipe`-Zwischenschritt oben durch diesen direkten Aufruf — prüfe beim Bauen, welcher Weg mit der finalen Panel-Struktur aus Task 3 zusammenpasst, und wähle den, der ohne neuen globalen Zustand auskommt.

Imports in `main.ts` ergänzen: `deleteEntry` aus `./core/history`, `ConfirmModal` aus `./obsidian/confirm-modal`, `HistoryEntry`/`TabId` als Typen. Prüfe die `ConfirmModal`-Signatur in `src/obsidian/confirm-modal.ts` (Konstruktor-Argumente) und ruf sie genau so.

- [ ] **Step 6: History-CSS (`styles.css`)**

```css
.lig-hist-head { display: flex; align-items: center; gap: 8px; padding: 8px; }
.lig-hist-seg { display: flex; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); overflow: hidden; }
.lig-hist-seg button { padding: 3px 10px; background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: var(--font-smaller); }
.lig-hist-seg button.is-active { background: var(--background-modifier-hover); color: var(--text-normal); }
.lig-hist-clear { margin-left: auto; font-size: var(--font-smaller); color: var(--text-muted); background: none; border: none; cursor: pointer; }
.lig-hist-row, .lig-hist-var { border-top: 1px solid var(--background-modifier-border); padding: 7px 9px; cursor: pointer; }
.lig-hist-row:hover, .lig-hist-var:hover { background: var(--background-modifier-hover); }
.lig-hist-var { padding-left: 22px; }
.lig-hist-prompt { line-height: 1.25; margin-bottom: 3px; }
.lig-hist-meta { display: flex; align-items: center; font-size: var(--font-smaller); color: var(--text-muted); }
.lig-hist-meta .clickable-icon { margin-left: auto; }
.lig-hist-group { display: flex; align-items: center; gap: 6px; padding: 6px 9px; border-top: 1px solid var(--background-modifier-border); font-weight: 600; cursor: pointer; }
.lig-hist-group .lig-hist-count { font-weight: 400; color: var(--text-muted); font-size: var(--font-smaller); }
.lig-hist-empty { padding: 16px 9px; color: var(--text-muted); }
```

- [ ] **Step 7: Gate + Smoke + Commit**

Run: `npm run gate` → grün. Deploy + Smoke: History-Tab zeigt Einträge nach Generieren; Umschalter Recent/By-prompt; Zeile klicken lädt Rezept + wechselt zu Generate; Papierkorb löscht eine Zeile; „Clear all" fragt nach und leert.

```bash
git add src/obsidian/history-panel.ts src/obsidian/view.ts src/main.ts src/core/strings.ts styles.css
git commit -m "feat(history): History-Tab mit Recent/Gruppiert, Restore, Löschen, Reset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Abschluss (nach Task 4)

- **Whole-Branch-Review** (superpowers:requesting-code-review) — die 0.1/0.2-Historie zeigt: der teuerste Fehler wird erst hier gefunden.
- **Jays Smoke-Test** als `/user-handover` (nicht als loser Text): Generate+Reroll, mehrere Variationen, Tab-Wechsel, beide History-Ansichten, Löschen/Reset, Neustart von Obsidian (Migration der alten `data.json` → leere Historie, kein Absturz).
- **Kein Version-Bump / kein Release** in diesem Plan (gehört zum Release-Schritt).
- **Backlog-Zeiger offen:** i18n (DE/EN, Sonnet), Robustheits-Block 4/5/6 (Sonnet).

## Selbst-Review gegen die Spec

- §2 Hub-Vendoring → Task 3 ✓ · §3 Feld 1 → Task 2 ✓ · §4.1 Datenmodell → Task 1 ✓ · §4.2 Migration → Task 1 (Step 3/6) ✓ · §4.3 Aufzeichnung → Task 1 (Step 8) ✓ · §4.4 Pure-Core → Task 1 ✓ · §4.5 UI → Task 4 ✓ · §4.6 Host-Verträge → Task 4 ✓ · §5 Styles → Task 3 (Hub) + Task 4 (History) ✓ · §6 Tests → pure in Task 1, DOM via Build+Smoke (bewusste Abweichung, siehe Global Constraints) · §7 Dateien → alle abgedeckt.
