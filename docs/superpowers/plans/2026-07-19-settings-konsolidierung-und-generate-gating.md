# Settings-Konsolidierung + Generate-Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modell-Settings von zwei getrennten Sektionen zu einer zusammenlegen, und den
Generate-Button ausgrauen, wenn Prompt/Seed/Steps/Größe exakt dem zuletzt erzeugten Bild
entsprechen (Reroll bleibt aktiv).

**Architecture:** (b) ist reines UI-Layout in `settings-tab.ts` — zwei `collapsibleSection()` →
eine, mit `setHeading()`-Zwischentiteln pro Modell. (c) erweitert die pure `PanelState`
(`viewmodel.ts`) um das aktuell im DOM stehende, noch nicht generierte Rezept
(seed/steps/width/height), vergleicht es pure gegen das zuletzt erzeugte Bild und zieht das
Ergebnis über einen neuen `ViewHost.setRecipe()`-Call bis zum DOM durch.

**Tech Stack:** TypeScript, Obsidian Plugin API, Vitest (nur für `src/core/`, kein
Obsidian-Mock im Repo).

## Global Constraints

- Gate (`npm run gate` = typecheck + vitest + check:pure + build) muss vor jedem Commit grün sein.
- `src/core/` und `src/vendor/kit/` importieren nie `obsidian` (Gate: `scripts/check-pure.mjs`).
- Commit-Style: Conventional Commits, deutsch, mit `Co-Authored-By`-Trailer.
- Kein Tooltip am ausgegrauten Generate-Button (Spec §1, explizit außerhalb des Scopes).
- Kein generischer Katalog-Loop im Settings-Tab — nur zwei Modelle, strukturell verschiedenes
  Rendering (Spec §1, YAGNI).
- `settings-tab.ts` und `generate-panel.ts`/`view.ts`/`main.ts` bleiben ungetestet (kein
  Obsidian-Mock im Repo) — Gate-Typecheck + manueller Smoke-Test decken den Obsidian-Layer ab
  (bestehendes Repo-Muster, siehe `docs/superpowers/specs/2026-07-18-robustheits-block-design.md`
  §6).

---

## Task 1: Settings-Konsolidierung — zwei Sektionen zu einer

**Files:**
- Modify: `src/obsidian/settings-tab.ts`

**Interfaces:**
- Keine neuen Typen. `LigSettingTab.refreshModel()` (aufgerufen aus `src/main.ts`) bleibt in
  Name und Signatur unverändert (`refreshModel(): void`), rendert intern nur beide Blöcke statt
  einem.

- [ ] **Step 1: `fluxSectionEl`-Feld entfernen**

In `src/obsidian/settings-tab.ts`, Zeile 14, das Feld löschen:

```ts
// VORHER (Zeilen 13-14):
export class LigSettingTab extends PluginSettingTab {
  private modelSectionEl: HTMLElement | null = null;
  private fluxSectionEl: HTMLElement | null = null;

// NACHHER:
export class LigSettingTab extends PluginSettingTab {
  private modelSectionEl: HTMLElement | null = null;
```

- [ ] **Step 2: `display()` — beide Sektionen zu einer zusammenlegen**

Ersetze in `display()` (aktuell Zeilen 36-50):

```ts
// VORHER:
    this.modelSectionEl = collapsibleSection(containerEl, {
      title: t("settings.model.heading"),
      key: "model",
      defaultCollapsed: false,
      storage: this.storage,
    });
    this.renderModel(this.modelSectionEl);

    this.fluxSectionEl = collapsibleSection(containerEl, {
      title: "FLUX.2 klein 4B (mflux)", // Eigenname + Toolname — unübersetzt
      key: "mflux",
      defaultCollapsed: false,
      storage: this.storage,
    });
    this.renderFlux(this.fluxSectionEl);
```

```ts
// NACHHER:
    this.modelSectionEl = collapsibleSection(containerEl, {
      title: t("settings.model.heading"),
      key: "model",
      defaultCollapsed: false,
      storage: this.storage,
    });
    this.renderModel(this.modelSectionEl);
    this.renderFlux(this.modelSectionEl);
```

- [ ] **Step 3: `refreshModel()` — beide Blöcke in denselben Container rendern**

Ersetze (aktuell Zeilen 91-102):

```ts
// VORHER:
  refreshModel(): void {
    const el = this.modelSectionEl;
    if (el?.isConnected) {
      el.empty();
      this.renderModel(el);
    }
    const fx = this.fluxSectionEl;
    if (fx?.isConnected) {
      fx.empty();
      this.renderFlux(fx);
    }
  }
```

```ts
// NACHHER:
  refreshModel(): void {
    const el = this.modelSectionEl;
    if (el?.isConnected) {
      el.empty();
      this.renderModel(el);
      this.renderFlux(el);
    }
  }
```

- [ ] **Step 4: `renderModel()` — Zwischenüberschrift „SD-Turbo" voranstellen**

Ergänze am Anfang von `renderModel()` (aktuell Zeilen 104-109), vor der bestehenden
`modelSetting`-Zeile:

```ts
// VORHER:
  private renderModel(el: HTMLElement): void {
    const gb = (totalApproxBytes(MODEL_FILES) / 1e9).toFixed(1);
    const model = this.plugin.getState().model;
    const modelSetting = new Setting(el)
      .setName("SD-Turbo (ONNX, fp16)")
      .setDesc(t("settings.model.desc"));
```

```ts
// NACHHER:
  private renderModel(el: HTMLElement): void {
    new Setting(el).setName("SD-Turbo").setHeading();
    const gb = (totalApproxBytes(MODEL_FILES) / 1e9).toFixed(1);
    const model = this.plugin.getState().model;
    const modelSetting = new Setting(el)
      .setName("SD-Turbo (ONNX, fp16)")
      .setDesc(t("settings.model.desc"));
```

- [ ] **Step 5: `renderFlux()` — Zwischenüberschrift „FLUX.2 klein 4B (mflux)" voranstellen**

Ergänze am Anfang von `renderFlux()` (aktuell Zeilen 140-144), vor dem Kommentar
`// 1) Binary-Status + Pfad-Feld`:

```ts
// VORHER:
  private renderFlux(el: HTMLElement): void {
    const mflux = this.plugin.getState().mflux;

    // 1) Binary-Status + Pfad-Feld
    const status = new Setting(el).setName(t("settings.mflux.binary"));
```

```ts
// NACHHER:
  private renderFlux(el: HTMLElement): void {
    new Setting(el).setName("FLUX.2 klein 4B (mflux)").setHeading();
    const mflux = this.plugin.getState().mflux;

    // 1) Binary-Status + Pfad-Feld
    const status = new Setting(el).setName(t("settings.mflux.binary"));
```

- [ ] **Step 6: Gate laufen lassen**

Run: `npm run gate`
Expected: PASS (typecheck + alle bestehenden Tests unverändert grün + check:pure + build) —
`settings-tab.ts` hat keine eigene Testsuite, das ist erwartet (Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add src/obsidian/settings-tab.ts
git commit -m "$(cat <<'EOF'
refactor(settings): Modell-Sektionen zu einer zusammengelegt

SD-Turbo und FLUX.2 standen bisher in zwei getrennten Settings-Sektionen
("Model" vs. eigener FLUX-Titel) — Jays Smoke-Feedback 0.4: verwirrt. Jetzt
eine "Model"-Sektion mit nativen Zwischenüberschriften pro Modell.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure Rezept-Vergleich (`recipeUnchanged`) + PanelState-Erweiterung

**Files:**
- Modify: `src/core/viewmodel.ts`
- Modify: `tests/viewmodel.test.ts`

**Interfaces:**
- Produces: `PanelState` bekommt vier neue Pflichtfelder `seed: number`, `steps: number`,
  `width: number`, `height: number`. `recipeUnchanged(s: PanelState): boolean` (nicht
  exportiert — nur intern von `buildOrtViewModel`/`buildMfluxViewModel` verwendet).
- Consumes: nichts Neues — arbeitet nur mit bereits vorhandenen `PanelState`/`GenParams`-Typen.

- [ ] **Step 1: `PanelState` erweitern + Test-Fixtures nachziehen**

In `src/core/viewmodel.ts`, `PanelState` (aktuell Zeilen 49-60) erweitern:

```ts
// VORHER:
export interface PanelState {
  gpu: GpuState;
  model: ModelState;
  run: RunState;
  image: { dataUrl: string; params: GenParams } | null;
  editorActive: boolean;
  prompt: string;
  /** ID aus dem Modell-Katalog (Spec §3) — bestimmt, ob buildViewModel den ORT- oder
   *  den mflux-Zweig baut. */
  selectedModel: string;
  mflux: MfluxPanelState;
}
```

```ts
// NACHHER:
export interface PanelState {
  gpu: GpuState;
  model: ModelState;
  run: RunState;
  image: { dataUrl: string; params: GenParams } | null;
  editorActive: boolean;
  prompt: string;
  /** ID aus dem Modell-Katalog (Spec §3) — bestimmt, ob buildViewModel den ORT- oder
   *  den mflux-Zweig baut. */
  selectedModel: string;
  mflux: MfluxPanelState;
  /** Aktuell im DOM eingestelltes, noch nicht generiertes Rezept (generate-panel.ts
   *  zieht das bei jedem refresh() nach) — Grundlage für das Generate-Gating (§Task 2). */
  seed: number;
  steps: number;
  width: number;
  height: number;
}
```

In `tests/viewmodel.test.ts` die beiden Fixtures (aktuell Zeilen 13-36) um dieselben vier Felder
ergänzen:

```ts
// VORHER:
const base: PanelState = {
  gpu: "ok",
  model: { kind: "ready" },
  run: { kind: "idle" },
  image: null,
  editorActive: true,
  prompt: "a cat",
  selectedModel: "sd-turbo",
  mflux: MFLUX_OK,
};

function fluxState(over: Partial<PanelState> = {}): PanelState {
  return {
    gpu: "no-webgpu", // absichtlich kaputt: darf FLUX nicht blocken
    model: { kind: "missing" }, // SD-Turbo-Gewichte fehlen: darf FLUX nicht blocken
    run: { kind: "idle" },
    image: null,
    editorActive: false,
    prompt: "an apple",
    selectedModel: "flux2-klein-4b",
    mflux: MFLUX_OK,
    ...over,
  };
}
```

```ts
// NACHHER:
const base: PanelState = {
  gpu: "ok",
  model: { kind: "ready" },
  run: { kind: "idle" },
  image: null,
  editorActive: true,
  prompt: "a cat",
  selectedModel: "sd-turbo",
  mflux: MFLUX_OK,
  seed: 1,
  steps: 4,
  width: 512,
  height: 512,
};

function fluxState(over: Partial<PanelState> = {}): PanelState {
  return {
    gpu: "no-webgpu", // absichtlich kaputt: darf FLUX nicht blocken
    model: { kind: "missing" }, // SD-Turbo-Gewichte fehlen: darf FLUX nicht blocken
    run: { kind: "idle" },
    image: null,
    editorActive: false,
    prompt: "an apple",
    selectedModel: "flux2-klein-4b",
    mflux: MFLUX_OK,
    seed: 1,
    steps: 4,
    width: 512,
    height: 512,
    ...over,
  };
}
```

- [ ] **Step 2: Failing Tests für das Gating schreiben**

In `tests/viewmodel.test.ts`, neues `describe`-Block am Ende der Datei einfügen, VOR dem
`describe("formatElapsed", ...)`-Block (nach dem schließenden `});` von
`describe("buildViewModel — mflux (FLUX.2)", ...)`, Zeile 143):

```ts
describe("buildViewModel — Generate-Gating (unverändertes Rezept)", () => {
  it("ORT: identisches Rezept zum letzten Bild → Generate disabled, Reroll unberührt", () => {
    const state: PanelState = {
      ...base,
      seed: 42,
      steps: 4,
      width: 512,
      height: 512,
      image: {
        dataUrl: "data:",
        params: {
          prompt: base.prompt,
          seed: 42,
          steps: 4,
          model: base.selectedModel,
          width: 512,
          height: 512,
          date: "2026-07-19T10:00:00",
        },
      },
    };
    expect(buildViewModel(state).generateEnabled).toBe(false);
  });
  it("ORT: ein geändertes Feld (Seed) → Generate wieder enabled", () => {
    const state: PanelState = {
      ...base,
      seed: 42,
      steps: 4,
      width: 512,
      height: 512,
      image: {
        dataUrl: "data:",
        params: {
          prompt: base.prompt,
          seed: 42,
          steps: 4,
          model: base.selectedModel,
          width: 512,
          height: 512,
          date: "2026-07-19T10:00:00",
        },
      },
    };
    expect(buildViewModel({ ...state, seed: 43 }).generateEnabled).toBe(true);
  });
  it("mflux: identisches Rezept zum letzten Bild → Generate disabled", () => {
    const state = fluxState({
      seed: 7,
      steps: 4,
      width: 768,
      height: 768,
      image: {
        dataUrl: "data:",
        params: {
          prompt: "an apple",
          seed: 7,
          steps: 4,
          model: "flux2-klein-4b",
          width: 768,
          height: 768,
          date: "2026-07-19T10:00:00",
        },
      },
    });
    expect(buildViewModel(state).generateEnabled).toBe(false);
  });
  it("mflux: geänderte Größe → Generate wieder enabled", () => {
    const state = fluxState({
      seed: 7,
      steps: 4,
      width: 768,
      height: 768,
      image: {
        dataUrl: "data:",
        params: {
          prompt: "an apple",
          seed: 7,
          steps: 4,
          model: "flux2-klein-4b",
          width: 768,
          height: 768,
          date: "2026-07-19T10:00:00",
        },
      },
    });
    expect(buildViewModel({ ...state, width: 512, height: 512 }).generateEnabled).toBe(true);
  });
});
```

- [ ] **Step 3: RED verifizieren**

Run: `npx vitest run tests/viewmodel.test.ts`
Expected: FAIL — die vier neuen Tests scheitern mit `expected true to be false` (ORT/mflux
„identisches Rezept"-Fälle), weil `recipeUnchanged` noch nicht existiert. Alle bisherigen Tests
bleiben grün.

- [ ] **Step 4: `recipeUnchanged` implementieren und in beide Zweige verdrahten**

In `src/core/viewmodel.ts`, neuen Helper direkt vor `buildOrtViewModel` einfügen (nach
`formatBytes`, aktuell Zeile 83):

```ts
/** Prüft, ob Prompt/Modell/Seed/Steps/Größe exakt dem zuletzt erzeugten Bild entsprechen —
 *  ein erneuter Klick auf Generate würde dann byte-identisch dasselbe Bild liefern
 *  (deterministischer Seed). Reroll ist davon unabhängig: der würfelt den Seed vorher neu
 *  und ist nie an generateEnabled gebunden (generate-panel.ts). */
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

Dann in `buildOrtViewModel`, die `return`-Anweisung (aktuell Zeilen 122-128) ändern:

```ts
// VORHER:
  return {
    status,
    empty,
    generateEnabled: !gpuBlocked && !busy && s.model.kind === "ready" && s.prompt.trim().length > 0,
    insertEnabled: s.image !== null && s.editorActive && !busy,
    showImage: s.image !== null,
  };
```

```ts
// NACHHER:
  return {
    status,
    empty,
    generateEnabled:
      !gpuBlocked && !busy && s.model.kind === "ready" && s.prompt.trim().length > 0 && !recipeUnchanged(s),
    insertEnabled: s.image !== null && s.editorActive && !busy,
    showImage: s.image !== null,
  };
```

Und in `buildMfluxViewModel`, die `return`-Anweisung (aktuell Zeilen 164-170) ändern:

```ts
// VORHER:
  return {
    status,
    empty,
    generateEnabled: !busy && m.binary !== null && m.weights === "ready" && s.prompt.trim().length > 0,
    insertEnabled: s.image !== null && s.editorActive && !busy,
    showImage: s.image !== null,
  };
```

```ts
// NACHHER:
  return {
    status,
    empty,
    generateEnabled:
      !busy && m.binary !== null && m.weights === "ready" && s.prompt.trim().length > 0 && !recipeUnchanged(s),
    insertEnabled: s.image !== null && s.editorActive && !busy,
    showImage: s.image !== null,
  };
```

- [ ] **Step 5: GREEN verifizieren**

Run: `npx vitest run tests/viewmodel.test.ts`
Expected: PASS — alle Tests in der Datei grün (die vier neuen plus alle bestehenden).

- [ ] **Step 6: Vollen Gate laufen lassen**

Run: `npm run gate`
Expected: PASS (typecheck deckt ab, dass `PanelState` überall sonst noch korrekt konstruiert
wird — vor Task 3 betrifft das nur `src/main.ts`, siehe dort).

Falls `npm run gate` an `src/main.ts` (Zeile ~35, initiale `this.state`-Literal) mit einem
Typfehler scheitert („Property 'seed' is missing…"): das ist erwartet, da `main.ts` erst in
Task 3 angepasst wird. In diesem Fall Step 6 hier NICHT als grün abhaken — stattdessen direkt
mit Task 3 fortfahren und den Gate-Lauf dort (Task 3 Step 5) als die maßgebliche Prüfung
behandeln.

- [ ] **Step 7: Commit**

```bash
git add src/core/viewmodel.ts tests/viewmodel.test.ts
git commit -m "$(cat <<'EOF'
feat(viewmodel): Generate-Gating bei unverändertem Rezept (pure Logik)

PanelState trägt jetzt das aktuell im DOM eingestellte Rezept (seed/steps/
width/height). recipeUnchanged() vergleicht es pure gegen das zuletzt
erzeugte Bild und sperrt Generate bei exaktem Match (deterministischer
Seed → identisches Ergebnis). Reroll bleibt unabhängig aktiv. TDD, 4 neue
Tests.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wiring — Rezept vom DOM bis in den ViewModel-Vergleich durchziehen

**Files:**
- Modify: `src/obsidian/view.ts`
- Modify: `src/main.ts`
- Modify: `src/obsidian/generate-panel.ts`

**Interfaces:**
- Consumes: `PanelState` mit `seed`/`steps`/`width`/`height` (Task 2).
- Produces: `ViewHost.setRecipe(steps: number, seed: number, width: number, height: number): void`
  — von `main.ts` implementiert, von `generate-panel.ts` bei jedem `refresh()` aufgerufen.

- [ ] **Step 1: `ViewHost.setRecipe` deklarieren**

In `src/obsidian/view.ts`, Interface `ViewHost` (aktuell Zeilen 14-27) erweitern:

```ts
// VORHER:
export interface ViewHost {
  getPanelState(): PanelState;
  getSettings(): LigSettings;
  setPrompt(p: string): void;
  generate(steps: number, seed: number, width: number, height: number): void;
  setSelectedModel(id: string): void;
```

```ts
// NACHHER:
export interface ViewHost {
  getPanelState(): PanelState;
  getSettings(): LigSettings;
  setPrompt(p: string): void;
  setRecipe(steps: number, seed: number, width: number, height: number): void;
  generate(steps: number, seed: number, width: number, height: number): void;
  setSelectedModel(id: string): void;
```

(restliche Zeilen des Interfaces unverändert)

- [ ] **Step 2: `main.ts` — Initialzustand + `setRecipe`-Implementierung**

In `src/main.ts`, `this.state`-Initialisierung (aktuell Zeilen 35-44) erweitern:

```ts
// VORHER:
  private state: PanelState = {
    gpu: "checking",
    model: { kind: "missing" },
    run: { kind: "idle" },
    image: null,
    editorActive: false,
    prompt: "",
    selectedModel: DEFAULT_MODEL_ID,
    mflux: { binary: null, weights: "missing", download: null },
  };
```

```ts
// NACHHER:
  private state: PanelState = {
    gpu: "checking",
    model: { kind: "missing" },
    run: { kind: "idle" },
    image: null,
    editorActive: false,
    prompt: "",
    selectedModel: DEFAULT_MODEL_ID,
    mflux: { binary: null, weights: "missing", download: null },
    // Platzhalter bis zum ersten GeneratePanel.refresh() (kein Bild vorhanden →
    // recipeUnchanged ist bis dahin ohnehin immer false, siehe viewmodel.ts).
    seed: 0,
    steps: 4,
    width: 512,
    height: 512,
  };
```

Dann im `host`-Objekt (aktuell Zeilen 56-65), `setRecipe` direkt nach `setPrompt` ergänzen:

```ts
// VORHER:
      setPrompt: (p) => {
        this.state.prompt = p;
      },
      generate: (steps, seed, width, height) => void this.generate(steps, seed, width, height),
```

```ts
// NACHHER:
      setPrompt: (p) => {
        this.state.prompt = p;
      },
      setRecipe: (steps, seed, width, height) => {
        this.state.steps = steps;
        this.state.seed = seed;
        this.state.width = width;
        this.state.height = height;
      },
      generate: (steps, seed, width, height) => void this.generate(steps, seed, width, height),
```

- [ ] **Step 3: `generate-panel.ts` — `refresh()` synct das Rezept vor jedem ViewModel-Aufbau**

In `src/obsidian/generate-panel.ts`, `refresh()` (aktuell Zeilen 228-231) erweitern:

```ts
// VORHER:
  refresh(): void {
    const state = this.host.getPanelState();
    this.renderChips();
    const vm = buildViewModel(state);
```

```ts
// NACHHER:
  refresh(): void {
    const { width, height } = this.currentSize();
    this.host.setRecipe(Number(this.stepsEl.value), Number(this.seedEl.value), width, height);
    const state = this.host.getPanelState();
    this.renderChips();
    const vm = buildViewModel(state);
```

- [ ] **Step 4: Fehlende Live-Listener ergänzen (Steps, Seed, Größe, Würfel)**

Vier gezielte Ergänzungen in `src/obsidian/generate-panel.ts`:

**4a — Steps-Slider** (aktuell Zeilen 89-91):

```ts
// VORHER:
    this.stepsEl.addEventListener("input", () => {
      this.stepsValueEl.setText(this.stepsEl.value);
    });
```

```ts
// NACHHER:
    this.stepsEl.addEventListener("input", () => {
      this.stepsValueEl.setText(this.stepsEl.value);
      this.refresh();
    });
```

**4b — Seed-Feld** (neuer Listener, direkt nach der `seedEl`-Erzeugung einfügen, aktuell
Zeilen 93-96, VOR dem Würfel-Button-Block):

```ts
// VORHER:
    this.seedEl = controls.createEl("input", {
      cls: "lig-seed",
      attr: { type: "number", value: String(randomSeed()) },
    });
    const dice = controls.createEl("button", { cls: "clickable-icon" });
```

```ts
// NACHHER:
    this.seedEl = controls.createEl("input", {
      cls: "lig-seed",
      attr: { type: "number", value: String(randomSeed()) },
    });
    this.seedEl.addEventListener("input", () => {
      this.refresh();
    });
    const dice = controls.createEl("button", { cls: "clickable-icon" });
```

**4c — Würfel-Button** (aktuell Zeilen 101-103):

```ts
// VORHER:
    dice.addEventListener("click", () => {
      this.seedEl.value = String(randomSeed());
    });
```

```ts
// NACHHER:
    dice.addEventListener("click", () => {
      this.seedEl.value = String(randomSeed());
      this.refresh();
    });
```

**4d — Größen-Dropdown** (in `rebuildSizeDropdown()`, aktuell Zeilen 178-188, am Ende der
Methode ergänzen):

```ts
// VORHER (Ende der Methode):
    if (preferred && spec.sizes.some((s) => s.width === preferred.width && s.height === preferred.height))
      this.sizeEl.value = `${preferred.width}x${preferred.height}`;
  }
```

```ts
// NACHHER:
    if (preferred && spec.sizes.some((s) => s.width === preferred.width && s.height === preferred.height))
      this.sizeEl.value = `${preferred.width}x${preferred.height}`;
    this.sizeEl.addEventListener("change", () => this.refresh());
  }
```

Beachte: `rebuildSizeDropdown()` hat einen frühen `return` direkt nach `this.sizeEl = null;`,
wenn `spec.sizes.length <= 1` (SD-Turbo). Der neue Listener steht danach — er wird also nur
angehängt, wenn tatsächlich ein Dropdown existiert. Kein weiterer Codepfad nötig.

- [ ] **Step 5: Gate laufen lassen (jetzt inkl. Task 2)**

Run: `npm run gate`
Expected: PASS — typecheck (inkl. `main.ts`s vollständiger `PanelState`-Literal), alle Tests
(199+4 aus Task 2), check:pure, build.

- [ ] **Step 6: Commit**

```bash
git add src/obsidian/view.ts src/main.ts src/obsidian/generate-panel.ts
git commit -m "$(cat <<'EOF'
feat(generate): Rezept-Sync bis zum DOM verdrahtet (Generate-Gating aktiv)

ViewHost.setRecipe() zieht Seed/Steps/Größe bei jedem refresh() aus dem DOM
in den PanelState — vorher lebten diese Werte nur in den Eingabefeldern und
waren für buildViewModel() unsichtbar. Fehlende Listener (Seed-Feld,
Größen-Dropdown, Würfel-Button) ergänzt, damit jede Änderung sofort einen
Refresh auslöst. Schließt das in Task 2 gebaute Gating an die UI an.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Deploy + manuelle Verifikation vorbereiten**

Run:
```bash
OBSIDIAN_PLUGIN_DIR="/Users/Shared/10_ObsidianVaults/10_Pallas/.obsidian/plugins/local-image-generator" npm run deploy
```
Expected: Build + Kopie erfolgreich, keine Fehlerausgabe.

Danach: manuelle Sicht-/Klick-Prüfung (Settings-Layout, Generate-Button-Verhalten) läuft NICHT
hier automatisiert — dafür braucht es Jays Blick in Obsidian. Diese Prüfung als
`/user-handover` an ihn übergeben (siehe Skill-Konvention „Smoke-Test immer als user-handover"),
nicht als loser Chat-Text.

---

## Self-Review-Notizen (für die ausführende Session, keine Aufgabe)

- **Spec-Abdeckung:** §2.1 (Settings-Konsolidierung) → Task 1. §2.2 Datenmodell/Vergleichslogik
  → Task 2. §2.2 Wiring → Task 3. §3 Tests → Task 2 Steps 2-5. §4 Sweep-Scope deckt sich mit den
  drei Task-File-Listen (keine Datei fehlt, keine zusätzliche betroffen).
- **Platzhalter-Scan:** keine TBD/TODO, jeder Step zeigt vollständigen Vorher/Nachher-Code.
- **Typkonsistenz:** `setRecipe(steps, seed, width, height)` — Reihenfolge und Namen identisch
  in `ViewHost` (Task 3 Step 1), `main.ts`-Implementierung (Step 2) und `generate-panel.ts`-Aufruf
  (Step 3); passt zur bestehenden `generate(steps, seed, width, height)`-Signatur (gleiche
  Parameter-Reihenfolge, kein neues Muster). `recipeUnchanged(s: PanelState): boolean` wird nur
  innerhalb von `viewmodel.ts` verwendet, kein Export nötig (kein externer Consumer).
