# Spec: Robustheits-Block (Backlog 4/5/6)

**Datum:** 2026-07-18 · **Status:** genehmigt (Brainstorming mit Jay, autonome Umsetzung freigegeben)

## 1. Ziel & Kontext

Letzter offener Punkt aus dem 0.2-Smoke-Test-Backlog (Cockpit, Punkte 4/5/6), bewusst als eigene
Sonnet-Session zurückgestellt (Trennung von Feature-Arbeit, Modell-Ökonomie). Drei zusammengehörige
Robustheits-Lücken, alle mit derselben Grundmotivation: **der User soll nie rätseln müssen, ob das
Plugin hängt oder arbeitet.**

1. **Download-Fortschritt** — `settings-tab.ts` bindet den Fortschritt aktuell an eine
   Button-Closure, die einen Re-Render (z.B. `presets.rerender()`) nicht übersteht (live bestätigter
   Bug: Kreisel ohne Zahlen). Zusätzlich fehlt Datei-Detail (aktuelle Datei, MB-Stand) — nur ein
   Gesamt-Prozentwert existiert.
2. **Ladephasen-Status** — zwischen fertigem Download und erstem Generierungs-Step gibt es aktuell
   **keinen eigenen Zustand**: `InferenceSession.create` (Weight-Upload + Shader-Compile, laut
   Cockpit „minutenlang auf Apple Silicon" normal) läuft komplett ohne Statuszeilen-Feedback — wirkt
   wie ein Hänger.
3. **Watchdog** — der dokumentierte jsep/asyncify-WASM-Vorfall (Fix `7673961`) hing lautlos für
   immer, weil ORTs interne Init-Rejection nie das `await` erreichte. Kein Timeout, kein
   `unhandledrejection`-Listener existiert bisher im Repo (verifiziert per grep).

**Explizit außerhalb dieses Scopes:** Uplink-Seiten-Refresh, Versions-Bump (gehört zum
Release-Schritt), Spec-§6-Hub-Unittest-Carryover (braucht Test-Infrastruktur, die es noch nicht
gibt).

## 2. Architektur

### 2.1 Datenmodell (`src/core/viewmodel.ts`, pure, keine obsidian-Imports)

```ts
export type ModelState =
  | { kind: "missing" }
  | {
      kind: "downloading";
      overallPct: number;
      fileKey: ModelFileKey;
      fileIndex: number; // 1-basiert
      totalFiles: number;
      receivedBytes: number; // aktuelle Datei
      totalBytes: number; // aktuelle Datei
    }
  | { kind: "ready" };

export type RunState =
  | { kind: "idle" }
  | { kind: "loading"; elapsedSec: number } // NEU: GPU-Session-Aufbau läuft
  | { kind: "running"; step: number; total: number }
  | { kind: "error"; message: string };
```

`downloading` bekommt Datei-Detail zusätzlich zum bisherigen Gesamt-%. `loading` ist ein neuer
Zwischenzustand zwischen `idle` und `running` — dort, wo heute der State-Übergang fehlt. Kein neues
`retryable`-Flag auf `error`: **jeder** `error`-Zustand ist bereits heute über den bestehenden
Generate-Button erneut anstoßbar (§2.4).

### 2.2 Download-Fortschritt (Punkt 4)

**`src/obsidian/model-store.ts`** — `download()`s Callback-Signatur:

```ts
export interface DownloadProgress {
  overallPct: number;
  fileKey: ModelFileKey;
  fileIndex: number;
  totalFiles: number;
  receivedBytes: number;
  totalBytes: number;
}
async download(onProgress: (p: DownloadProgress) => void): Promise<void>
```

Die bestehende Lese-Schleife (aktuell Z.71-77) füttert bei jedem Chunk sowohl `overallPct` (wie
bisher über `grandTotal`/`receivedTotal`) als auch die neuen Datei-Detail-Felder aus der
äußeren `for (const file of todo)`-Schleife.

**`src/main.ts`** — `downloadModel()` schreibt `DownloadProgress` unverändert in `this.state.model`
und ruft `refreshViews()`. Kein neuer Mechanismus, nur ein reicheres State-Objekt.

**`src/obsidian/settings-tab.ts`** — der eigentliche Fix. `renderModel()` (aktuell Z.71-97) prüft
heute asynchron `modelStore.isComplete()` und bindet den Fortschritt an eine Button-Closung
(`b.setButtonText(...)`, Z.87) — zwei unabhängige Fehlerquellen (Race beim initialen Check *und*
die stale Closure danach). Neu:

- `renderModel()` liest **synchron** aus `this.plugin.state.model` (Single Source of Truth, kein
  zweiter Cache-API-Check nötig — `state.model` wird bereits in `initStatus()`/`downloadModel()`/
  `onModelDeleted()` korrekt gepflegt) und leitet Button-Text, Fortschrittsbalken und Datei-
  Detailzeile (`"unet.onnx (2/5) — 850 MB / 1.7 GB"`) bei **jedem** Aufruf frisch daraus ab — nie
  aus einer alten Closure.
- `LigSettingTab.refreshModel(): void` — neue Methode, rendert nur die Model-Sektion neu (leert und
  baut den übergebenen Container-Node), nicht die ganze Settings-Seite.
- `main.ts.refreshViews()` bekommt einen zusätzlichen Schritt: hält die Settings-Tab-Instanz eine
  Referenz auf ihren Model-Sektions-Container, und ist dieser noch im DOM (`el.isConnected`-Check —
  kein separates "ist Tab offen"-Tracking nötig), wird `refreshModel()` aufgerufen.

Damit ist der Bug **strukturell** behoben, nicht nur für den Download-Fall: jeder künftige
Re-Render-Auslöser in einer anderen Sektion (z.B. `presets.rerender()`) kann die Model-Sektion nicht
mehr desynchronisieren, weil sie nie eigenen Zustand hält.

### 2.3 Ladephasen-Status (Punkt 5)

**`src/main.ts`** — `ensureEngine()` (aktuell Z.167-180) setzt zu Beginn
`this.state.run = { kind: "loading", elapsedSec: 0 }` + `refreshViews()`, startet einen
`window.setInterval(…, 1000)`, der `elapsedSec` hochzählt und pro Tick `refreshViews()` ruft
(gestoppt im `finally`, sobald Laden fertig oder fehlgeschlagen ist). `generate()`s Re-Entry-Guard
(aktuell Z.183: `if (this.state.run.kind === "running") return;`) wird um `"loading"` erweitert —
sonst könnte ein Doppelklick während des Ladens einen zweiten Ladeversuch parallel anstoßen.

**`src/core/viewmodel.ts`** — neuer Status-Zweig zwischen `downloading` und `running`:

```ts
else if (s.run.kind === "loading")
  status = { icon: "loader", text: t("status.loadingGpu", formatElapsed(s.run.elapsedSec)), cls: "is-checking" };
```

`busy` (aktuell Z.43) wird um `s.run.kind === "loading"` erweitert, damit Generate/Insert
währenddessen weiter gesperrt bleiben. Neue pure Hilfsfunktion `formatElapsed(sec: number): string`
(`m:ss`, z.B. `65` → `"1:05"`) in `viewmodel.ts`.

**`src/i18n/strings.ts`** — neuer Key `status.loadingGpu`, EN `"Loading model into GPU… ({0})"`,
DE `"Lädt Modell auf GPU… ({0})"`.

**`src/i18n/strings.ts`** — zweiter neuer Key (für §2.4) `status.engineLoadFailed`, EN
`"Loading the model into the GPU is taking unusually long or failed silently. Click Generate to try again."`,
DE `"Das Laden des Modells auf die GPU dauert ungewöhnlich lange oder ist lautlos fehlgeschlagen.
Klicke auf Generieren, um es erneut zu versuchen."`. Der Text benennt explizit die Retry-Handlung
(Generate-Button), da es kein eigenes Retry-Element gibt (§2.4).

### 2.4 Watchdog + `unhandledrejection` (Punkt 6)

**`src/core/timeout.ts`** (neu, pure) — Kit-Kandidat (siehe §4):

```ts
export async function raceTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
```

Gleiches Muster wie yijing-oracles `httpPostJson`/`probeEndpoint`/`probeImageEndpoint`
(`src/obsidian/http.ts`): globales `setTimeout`, kein `ClockPort` (der treibt einen
`AbortController` für APIs mit Abort-Unterstützung — ORT hat keine). Node-testbar ohne
Obsidian-Mock.

**`src/main.ts`** — `ensureEngine()` bekommt eine **Generation-ID**, um verwaiste späte Resolves zu
erkennen (ORT bietet kein Abort für `InferenceSession.create`; ein Timeout kann den Aufruf nicht
wirklich abbrechen, nur der UI melden und die Promise im Hintergrund verwaisen lassen):

```ts
private engineLoadGeneration = 0;

private async ensureEngine(): Promise<SdTurboEngine> {
  if (this.engine) return this.engine;
  const myGen = ++this.engineLoadGeneration;
  this.state.run = { kind: "loading", elapsedSec: 0 };
  this.refreshViews();
  const tick = window.setInterval(() => {
    if (this.state.run.kind === "loading") {
      this.state.run = { kind: "loading", elapsedSec: this.state.run.elapsedSec + 1 };
      this.refreshViews();
    }
  }, 1000);
  try {
    const engine = await raceTimeout(this.loadEngine(), 5 * 60_000, "engine load timed out");
    if (myGen !== this.engineLoadGeneration) {
      void engine.dispose().catch(() => {});
      throw new Error("stale engine load result");
    }
    this.engine = engine;
    this.state.run = { kind: "idle" };
    return engine;
  } catch (e) {
    if (myGen === this.engineLoadGeneration) this.state.run = { kind: "error", message: t("status.engineLoadFailed") };
    throw e;
  } finally {
    window.clearInterval(tick);
  }
}

// loadEngine(): die bisherige Promise.all-Ladelogik aus ensureEngine, unverändert extrahiert.
```

Timeout: **5 Minuten** (deutlich über der als normal dokumentierten „minutenlang"-Ladezeit auf
Apple Silicon, fängt aber einen echten Ewig-Hänger zuverlässig ein).

**`unhandledrejection`-Listener** — einmalig in `onload()`:

```ts
this.registerDomEvent(window, "unhandledrejection", () => {
  if (this.state.run.kind === "loading") {
    this.state.run = { kind: "error", message: t("status.engineLoadFailed") };
    this.refreshViews();
  }
});
```

Bewusst **kein** Auswerten von `event.reason` (fragil, ORT-Fehlerformate nicht stabil) — die
Korrelation läuft rein über den State: eine `unhandledrejection` genau während der Ladephase ist mit
hoher Wahrscheinlichkeit die verschluckte ORT-Init-Rejection (der dokumentierte jsep/asyncify-
Vorfall). Außerhalb der Ladephase wird nichts angefasst — kein Risiko, fremde Rejections (andere
Plugins, Obsidian selbst) fälschlich zu kapern. `preventDefault()` wird nicht aufgerufen, das
Standard-Konsolen-Logging bleibt erhalten.

**Retry:** Sobald `state.run.kind` auf `"error"` wechselt (Watchdog, `unhandledrejection` oder ein
normaler `generate()`-Fehler wie OOM), wird `generateEnabled` in `buildViewModel()` automatisch
wieder `true` — das ist bereits heute so (`!busy && …`, `error` zählt nicht zu `busy`). Die
„Retry-Funktion" ist damit **der bereits vorhandene Generate-Button**, kein neues UI-Element. Ein
Klick ruft `generate()` → `ensureEngine()` neu auf (neue Generation-ID; ein eventuell doch noch spät
resolvender alter Ladeversuch wird verworfen und sofort `.release()`t — Wiederholung des bekannten
GPU-Leak-Bugs aus 0.1 wird damit strukturell vermieden).

## 3. Sonderfälle

**Kein `retryable`-Unterschied zwischen Fehlerarten.** Watchdog-Timeout, `unhandledrejection` und
normale `generate()`-Fehler (z.B. OOM) landen alle im selben `RunState.error`-Zweig mit derselben
Retry-Semantik (Generate-Button wird wieder aktiv). Der einzige Unterschied ist der Fehlertext
(`status.engineLoadFailed` vs. der bestehende `status.error`/`notice.oomHint`-Pfad).

**`totalFiles`/`fileIndex` bei Teil-Downloads:** `model-store.ts`s `download()` iteriert nur über
`missingFiles(...)` (Retry-Granularität pro Datei, bereits bestehendes Verhalten). Ist z.B. schon
1 von 5 Dateien gecacht, zeigt `totalFiles = 4`, nicht `5` — korrekt, weil es die tatsächlich noch zu
ladende Menge widerspiegelt, keine Verwirrung stiftet.

**Elapsed-Sekundenzähler ist kein echter Fortschritt.** `formatElapsed` zeigt nur „wie lange läuft
das schon", nicht „wie weit ist es" — ORT liefert während `InferenceSession.create` keine
granularen Zwischenstände. Bewusst kein Pseudo-Fortschrittsbalken, der etwas vorgaukelt, das nicht
gemessen wird.

## 4. Kit-first-Befund

`raceTimeout` (§2.4) wäre die **vierte** Instanz desselben Musters „Promise.race + setTimeout, weil
die Ziel-API kein Timeout/Abort kennt" — yijing-oracle hat es bereits dreimal für `requestUrl`
gebaut (`httpPostJson`, `probeEndpoint`, `probeImageEndpoint`, `src/obsidian/http.ts`). Regel-der-
Drei ist erreicht. **Bewusst keine Kit-Extraktion in diesem Spec** (Repo-Konvention: läuft separat
über `/drift-audit`, siehe `2026-07-17-i18n-design.md §1` für den gleichen Präzedenzfall) — hier nur
eine vierte, noch unabhängige Kopie in `src/core/timeout.ts`, mit einem Kommentar, der auf die
anderen drei Instanzen verweist.

## 5. Sweep-Scope (Dateien)

- `src/core/timeout.ts` (neu) — `raceTimeout`.
- `src/core/viewmodel.ts` — `ModelState`/`RunState` erweitert, neuer `loading`-Statuszweig,
  `formatElapsed`.
- `src/obsidian/model-store.ts` — `DownloadProgress`-Typ, `download()`-Signatur.
- `src/obsidian/settings-tab.ts` — `renderModel()`/`refreshModel()` state-getrieben statt
  Closure-getrieben.
- `src/main.ts` — `downloadModel()` reicht `DownloadProgress` durch; `ensureEngine()` mit
  Generation-ID + Watchdog + Sekundenzähler; `generate()`-Guard erweitert; `unhandledrejection`-
  Listener in `onload()`; `refreshViews()` ruft zusätzlich `refreshModel()` der Settings-Tab, falls
  offen.
- `src/i18n/strings.ts` — neuer Key `status.loadingGpu` (EN/DE), `status.engineLoadFailed` (EN/DE).

**Nicht betroffen:** `src/core/pipeline/*`, `src/obsidian/generate-panel.ts` (liest weiterhin nur
`buildViewModel()`, keine Struktur-Änderung nötig), `src/core/engine.ts`.

## 6. Tests

Passend zum bestehenden Repo-Muster (kein Obsidian-Mock; Gate deckt `src/core/` +
`src/vendor/kit/` per Vitest ab, obsidian-Layer läuft über Gate-Typecheck + manuellen Smoke-Test):

- **`src/core/timeout.ts`** (neue Testdatei) — `raceTimeout` löst normal auf; wirft bei Timeout mit
  der übergebenen Message; räumt den Timer in beiden Fällen auf (`vi.useFakeTimers()`).
- **`src/core/viewmodel.ts`** — neue `buildViewModel()`-Zweige (`loading`-Status-Text inkl.
  `formatElapsed`-Interpolation, erweitertes `busy`/`generateEnabled` bei `loading`); `formatElapsed`
  selbst (`0` → `"0:00"`, `65` → `"1:05"`, `3661` → `"61:01"`).
- **`src/obsidian/model-store.ts`** — bestehende Testsuite (bereits über `StoreDeps` injizierbar)
  bekommt zusätzliche Assertions für die neuen `DownloadProgress`-Felder (`fileIndex`, `totalFiles`,
  `receivedBytes`, `totalBytes` pro Callback-Aufruf, über mehrere Dateien hinweg korrekt).
- **`src/main.ts`-Generation-ID-Logik** (verwaiste Promise wird verworfen+released,
  `unhandledrejection`-Handler, Settings-Tab-Refresh-Wiring) bleibt **ungetestet** — konsistent mit
  dem offenen Carryover-Punkt aus der i18n-Session (kein Obsidian-Mock im Repo). Gate (Typecheck) +
  finaler Smoke-Test decken das ab.

## 7. Offene Nicht-Entscheidungen (bewusst außerhalb dieses Scopes)

Eine eigene, separat beschriftete „Retry"-Schaltfläche (statt Wiederverwendung des bestehenden
Generate-Buttons) wurde im Brainstorming erwogen und verworfen — der bestehende Button erfüllt den
Zweck bereits ohne neues UI-Element (§2.4).
