# Spec: Modell-Settings konsolidieren + Generate-Gating bei unverändertem Rezept

**Datum:** 2026-07-19 · **Status:** genehmigt (Brainstorming mit Jay, autonome Umsetzung freigegeben)

## 1. Ziel & Kontext

Zwei unabhängige, kleine Punkte aus dem 0.4.1-Backlog (Cockpit, aus Jays Smoke-Feedback zu
Multi-Modell 0.4), in einer Session zusammengefasst statt zwei Specs für je drei Zeilen Text:

1. **Settings-Konsolidierung** — SD-Turbo und FLUX.2 klein 4B haben aktuell zwei getrennte
   `collapsibleSection()`-Sektionen im Settings-Tab. Verwirrt: „Model" wirkt wie SD-Turbo allein,
   FLUX steht daneben unter einem eigenen, hartkodierten Titel.
2. **Generate-Gating** — „Generate" nimmt Prompt/Seed/Steps/Größe unverändert aus den Feldern; bei
   gesperrtem (unverändertem) Rezept erzeugt ein erneuter Klick byte-identisch dasselbe Bild wie
   das bereits angezeigte. Der Button bleibt trotzdem aktiv — kein Hinweis, dass ein Klick nichts
   Neues bringt. **Reroll** (würfelt den Seed neu) ist davon nicht betroffen und bleibt unverändert
   aktiv.

**Explizit außerhalb dieses Scopes:** ein erklärender Tooltip am ausgegrauten Generate-Button (Jay
im Brainstorming verworfen — der Button erklärt sich für keinen der bestehenden Sperrgründe
(GPU-Check, Busy, fehlendes Modell, leerer Prompt), eine Erklärung nur für diesen einen neuen Grund
wäre inkonsistent). Kein drittes Modell, kein generischer Katalog-Loop im Settings-Tab (YAGNI — nur
zwei Modelle existieren, beide mit strukturell verschiedenem Rendering).

## 2. Architektur

### 2.1 Settings-Konsolidierung (`src/obsidian/settings-tab.ts`)

Die zwei `collapsibleSection()`-Aufrufe (`key: "model"` + `key: "mflux"`) werden zu **einer**
Sektion mit `key: "model"`, Titel `t("settings.model.heading")`. Innen bleiben `renderModel()`
(SD-Turbo) und `renderFlux()` (FLUX) inhaltlich unverändert — jede bekommt aber eine native
Obsidian-Zwischenüberschrift davor:

```ts
new Setting(el).setName("SD-Turbo").setHeading();
// … bestehender renderModel()-Inhalt …
new Setting(el).setName("FLUX.2 klein 4B (mflux)").setHeading();
// … bestehender renderFlux()-Inhalt …
```

`this.fluxSectionEl` entfällt, `this.modelSectionEl` wird der einzige Container für beide Blöcke.
`refreshModel()` (aufgerufen von `main.ts` bei jeder Download-Fortschritts-Änderung) rendert
künftig beide Blöcke in denselben Container neu:

```ts
refreshModel(): void {
  const el = this.modelSectionEl;
  if (el?.isConnected) {
    el.empty();
    this.renderModel(el);
    this.renderFlux(el);
  }
}
```

Der alte `"mflux"`-Collapse-Key bleibt ungenutzt in `data.json` liegen (kein Migrationscode nötig —
verwaiste Keys sind bereits tolerant, `sanitizeSettings`-Muster prüft nur bekannte Keys nach).

### 2.2 Generate-Gating (`src/core/viewmodel.ts`, `src/obsidian/view.ts`, `src/obsidian/generate-panel.ts`, `src/main.ts`)

**Datenmodell.** `PanelState` (pure, `src/core/viewmodel.ts`) bekommt vier neue Felder — das
aktuell in den DOM-Feldern stehende, noch nicht generierte Rezept:

```ts
export interface PanelState {
  // … bestehende Felder …
  seed: number;
  steps: number;
  width: number;
  height: number;
}
```

**Pure Vergleichslogik.** Ein neuer Helper neben `formatElapsed`/`formatBytes`:

```ts
function recipeUnchanged(s: PanelState): boolean {
  const p = s.image?.params;
  return (
    p !== undefined &&
    p.prompt === s.prompt &&
    p.model === s.selectedModel &&
    p.seed === s.seed &&
    p.steps === s.steps &&
    p.width === s.width &&
    p.height === s.height
  );
}
```

Verwendet in **beiden** Zweigen von `buildViewModel()`:

```ts
generateEnabled: !gpuBlocked && !busy && s.model.kind === "ready" && s.prompt.trim().length > 0 && !recipeUnchanged(s),
// mflux-Zweig analog, ohne gpuBlocked
```

**Wiring bis zum DOM.** `ViewHost` (`src/obsidian/view.ts`) bekommt eine neue Methode:

```ts
setRecipe(steps: number, seed: number, width: number, height: number): void;
```

`main.ts` implementiert sie als reines Feld-Update auf `this.state` (kein `saveSettings()`,
kein `refreshViews()` — das übernimmt der Aufrufer über das ohnehin folgende `refresh()`).

`GeneratePanel.refresh()` (`src/obsidian/generate-panel.ts`) ruft `setRecipe()` mit den aktuellen
DOM-Werten **vor** `getPanelState()`, sodass jeder bestehende `refresh()`-Aufruf (Prompt-Eingabe,
Chip-Klick, Modellwechsel, `applyRecipe()`, initiales `mount()`) das Rezept automatisch mitzieht.
Zusätzlich braucht es `refresh()`-Aufrufe an drei Stellen, die bisher nur den DOM-Wert setzen, aber
nicht syncen:

- `stepsEl`-Input-Listener (setzt heute nur `stepsValueEl`-Text) → `this.refresh()` ergänzen.
- `seedEl` hat aktuell **keinen** Input-Listener → neu: `addEventListener("input", () => this.refresh())`.
- `sizeEl` (Größen-Dropdown, in `rebuildSizeDropdown()` gebaut) hat aktuell **keinen**
  Change-Listener → neu: `addEventListener("change", () => this.refresh())`.
- Würfel-Button (setzt `seedEl.value` programmatisch) → `this.refresh()` ergänzen.

`regenBtn` (Reroll) braucht **keine** Änderung: er ist schon heute nicht an `vm.generateEnabled`
gebunden (`refresh()` setzt nur `this.generateBtn.disabled`), bleibt also unverändert klickbar. Der
neue Seed, den Reroll setzt, wird über den nachfolgenden `refreshViews()`-Aufruf aus `main.ts`
(innerhalb von `generate()`/`generateOrt()`/`generateMflux()`) ohnehin nachgezogen.

## 3. Tests

Passend zum bestehenden Repo-Muster (kein Obsidian-Mock; `settings-tab.ts` bleibt ungetestet,
Gate-Typecheck + manueller Smoke-Test decken den Obsidian-Layer ab):

- **`tests/viewmodel.test.ts`** — neue Fälle für `recipeUnchanged()`-Wirkung über `buildViewModel()`:
  - Rezept identisch zum letzten Bild (Prompt/Modell/Seed/Steps/Größe) → `generateEnabled === false`,
    für ORT- **und** mflux-Zweig.
  - Ein einzelnes Feld geändert (z.B. Seed) → `generateEnabled === true`.
  - Bestehende Fixtures (`base`, `fluxState`) bekommen die vier neuen Pflichtfelder mit Werten, die
    zu keinem der bestehenden Tests zufällig ein Rezept-Match erzeugen (kein `image`-State in den
    Fixtures selbst — nur der neue Testfall setzt `image` bewusst passend).

## 4. Sweep-Scope (Dateien)

- `src/obsidian/settings-tab.ts` — Sektionen zusammengelegt, `renderModel`/`renderFlux` bekommen
  vorangestellte `setHeading()`-Zeilen, `refreshModel()` rendert beide Blöcke.
- `src/core/viewmodel.ts` — `PanelState` um `seed`/`steps`/`width`/`height` erweitert,
  `recipeUnchanged()` neu, in beiden `generateEnabled`-Berechnungen verwendet.
- `src/obsidian/view.ts` — `ViewHost.setRecipe(...)` neu.
- `src/main.ts` — `this.state`-Initialwerte um die vier Felder ergänzt, `setRecipe()` implementiert.
- `src/obsidian/generate-panel.ts` — `refresh()` ruft `setRecipe()` vor `getPanelState()`; drei neue
  bzw. ergänzte Listener (Steps, Seed, Größe, Würfel).

**Nicht betroffen:** `src/core/models.ts`, `src/obsidian/mflux-*`, `src/i18n/strings.ts` (kein neuer
Text nötig — die bestehende `settings.model.heading`-Übersetzung deckt den zusammengelegten Titel
bereits ab).
