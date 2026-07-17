# Spec: History-Tab + Button-Redesign (0.3, Teil 1)

**Datum:** 2026-07-17 · **Status:** genehmigt (Brainstorming mit Jay)
**Deckt Backlog-Befunde ab:** Knopf-Redesign (Schloss redundant) + Historie merkt sich nur den Prompt.

## 1. Ziel & Kontext

Aus Jays 0.2-Smoke-Test kamen zwei gekoppelte Befunde am **einen** Sidebar-View:

1. **Das Seed-Schloss ist redundant.** „Generate" nimmt den Seed aus dem Feld und würfelt nie,
   „Regenerate" würfelt; das Schloss macht aus Regenerate → Generate — ein Modus, der einen Knopf
   in einen anderen verwandelt, den es schon gibt. Das eigentliche Problem ist die Benennung.
2. **Die Historie merkt sich nur den Prompt**, nicht Seed/Steps → ein Klick stellt das Rezept nur
   zur Hälfte her. Zusätzlich soll die Historie ein **eigenes Tab** mit Löschen-je-Eintrag +
   Reset-gesamt bekommen, getrennt vom (unveränderten) Ergebnis-Notiz-Feature.

Beide Änderungen sind Chirurgie am selben View und werden deshalb in **einer** Session/Branch
umgesetzt.

**Explizit außerhalb dieses Scopes** (eigene spätere Sessions): i18n (DE/EN), Robustheits-Block
(Backlog 4/5/6), Ergebnis-Notizen-Änderungen.

## 2. Architektur — der eine View wird ein Tab-Hub

Der heutige `GeneratorView` (eine `ItemView`, „one hub view", UI-STANDARD §1/§4) wird zur **Hülle**,
die per vendored Hub-Muster zwei Panels aufbaut.

**Vendoring (Kit-first):** vault-rags Hub-Muster (`buildInto` + `HubController` + `HubPanel`) wird
nach `src/obsidian/hub.ts` übernommen. Das Muster steht in der REGISTRY (Z.82) bei 3 Exemplaren
(vault-crews, finance-ledger, vault-rag) → Regel-der-Drei erreicht; die **Kit-Extraktion** wird für
`/drift-audit` markiert, hier nur vendored (wie 0.2 collapsible/FolderSuggest).

- **`HubPanel`-Interface** (aus vault-rag, `TabId` angepasst): `{ id, label, icon, mount(container),
  onShow?, onHide?, onFileOpen?, destroy() }`. Panels bleiben gemountet, Wechsel per `is-hidden`.
- **`TabId = "generate" | "history"`**.
- **`buildInto(root, panels, defaultTab): HubController`** — Tab-Leiste + Content-Container,
  `is-hidden`-Umschaltung, Default-Panel-Fallback. Node-testbar gegen den Obsidian-Mock.

Zwei Panels:

- **`GeneratePanel`** (`src/obsidian/generate-panel.ts`) — der **heutige View-Inhalt** aus `view.ts`
  (Prompt, History-Button entfällt hier, Chips, Steps, Seed+Würfel, Generate, Bild-Card mit
  Reroll/Create/Insert, Statuszeile), 1:1 in ein `HubPanel` extrahiert. Mount-once bleibt.
- **`HistoryPanel`** (`src/obsidian/history-panel.ts`) — neu (siehe §4).

`view.ts` schrumpft auf die Hülle: `onOpen` instanziiert beide Panels, ruft `buildInto`, verdrahtet
`getState/setState` für Tab-Persistenz.

## 3. Feld 1 — Button-Redesign (im GeneratePanel)

- **Schloss entfällt** komplett (Feld `seedLocked`, `lock`-Button, `applyLock`, zugehörige STRINGS).
- **Oben „Generate"** — unverändert: nimmt den Seed aus dem Feld, würfelt nie.
- **In der Bild-Card: „Regenerate" → „Reroll"** — würfelt einen neuen Seed **und** generiert in
  einem Klick (`seedEl.value = randomSeed(); host.generate(...)`). Erscheint wie bisher nur, wenn
  ein Bild da ist.
- **Würfel** neben dem Seed-Feld **bleibt** (manuelles Neu-Würfeln → dann „Generate").
- STRINGS: `regenerate` → `reroll: "Reroll"`.

## 4. Feld 2 — HistoryPanel

### 4.1 Datenmodell

`src/core/settings.ts`:

```ts
export interface HistoryEntry {
  prompt: string;
  seed: number;
  steps: number;
  model: string;
  created: string;   // ISO-Zeitstempel
}
```

- `LigSettings.promptHistory: string[]` **entfällt**, ersetzt durch `history: HistoryEntry[]`
  (MRU, neueste zuerst).
- `DEFAULT_SETTINGS.history = []`.
- Neu: `LigSettings.historyView: "recent" | "grouped"` (Default `"recent"`), persistiert den
  Umschalter.

### 4.2 Migration (Alt-Historie verwerfen)

`sanitizeSettings`: `promptHistory` (alter `string[]`) wird **verworfen**, `history` frisch als `[]`
gestartet, falls nicht bereits ein gültiges `HistoryEntry[]` vorliegt. Jays 15 Alt-Einträge gehen
beim Upgrade bewusst verloren (mit ihm abgestimmt) — dafür haben `HistoryEntry`-Felder immer volle
Werte, keine Nullable-Sonderfälle.

`sanitizeHistory(raw)`: nur Objekte mit `prompt:string, seed:number, steps:number, model:string,
created:string` behalten. `sanitizeHistoryView(raw)`: `"grouped"` wenn exakt `"grouped"`, sonst
`"recent"`.

### 4.3 Aufzeichnung

Bei **erfolgreicher** Generierung (in `main.ts`, wo heute der Prompt in die Historie geht) wird das
**volle Rezept** aufgezeichnet: `{ prompt, seed, steps, model, created: <jetzt> }`. Der Zeitstempel
wird **einmal beim Erfolg eingefroren** (Muster wie MVP-Fix `4a6dff2` — nie „jetzt" nachträglich
ableiten).

### 4.4 Pure-Core (`src/core/history.ts`, alles TDD)

- `pushHistory(list, entry): HistoryEntry[]` — Dedup **nach vollem Rezept** (prompt+seed+steps
  identisch → nach vorn, kein Duplikat; Modell nicht Teil des Schlüssels, da einmodellig), MRU,
  Cap `HISTORY_LIMIT` (bleibt 20). Leerer/whitespace-Prompt wird ignoriert.
- `groupByPrompt(list): { prompt: string; entries: HistoryEntry[] }[]` — Einträge nach `prompt`
  gruppiert; Gruppen nach jüngstem Eintrag absteigend sortiert, innerhalb einer Gruppe neueste
  zuerst. Pure, testbar.
- `deleteEntry(list, entry): HistoryEntry[]` — entfernt genau einen Eintrag über Wert-Gleichheit
  (prompt+seed+steps+created), nicht über Index (Index-Falle aus REGISTRY Z.84 vermeiden).
- `historyLabel(prompt, max)` bleibt (Kürzung).

### 4.5 UI (mockup-genehmigt)

Tab-Kopf: Umschalter `[ Zuletzt | Nach Prompt ]` + „Alles löschen".

- **„Zuletzt" (flach, MRU):** je Zeile Prompt (gekürzt) + Metazeile `seed <n> · <steps> steps ·
  <HH:MM>` + Papierkorb-Icon. Ganze Zeile klickbar = Rezept laden.
- **„Nach Prompt" (gruppiert):** je Prompt eine **einklappbare** Überschrift (▾/▸) mit
  Variationszahl; darunter eingerückt die Variationen (Metazeile + Papierkorb, klickbar = laden).
- Keine Bild-Miniatur (nur Rezept-Metadaten — Bilder werden in der Historie nicht gespeichert).

### 4.6 Interaktion (Host-Verträge)

Neue `ViewHost`-Methoden:

- `restoreRecipe(entry: HistoryEntry): void` — setzt Prompt+Seed+Steps ins GeneratePanel, wechselt
  zum Generate-Tab, **generiert nicht** (Jay drückt selbst — respektiert die Generate/Reroll-Semantik).
- `deleteHistoryEntry(entry: HistoryEntry): void` — `deleteEntry` + persist + Panel-Refresh.
- `clearHistory(): void` — Rückfrage via bestehendem `confirm-modal.ts`, dann `history = []` +
  persist + Refresh.
- `setHistoryView(v: "recent" | "grouped"): void` — persistiert `historyView` + Refresh.

Tab-Wechsel aus dem HistoryPanel heraus läuft über den `HubController` (der Host hält die Referenz).

## 5. Styles

`styles.css` bekommt: Hub-Tab-Leiste + aktiver Tab, History-Zeilen/Gruppen/Variationen, Umschalter.
**Gotcha (aus collapsible-Lesson, REGISTRY Z.79):** wer nur Funktionen vendored, muss das zugehörige
CSS mitnehmen — das Panel-`is-hidden`-Toggle und der Hub brauchen ihre Klassen in `styles.css`,
sonst klappt/versteckt nichts.

## 6. Tests

- **Pure (Unit, TDD):** `pushHistory` (Dedup-nach-Rezept, MRU, Cap, Variationen bleiben),
  `groupByPrompt` (Gruppen-/Innensortierung), `deleteEntry` (Wert- statt Index-Match),
  `sanitizeHistory`/`sanitizeHistoryView` + Migration (Alt-`string[]` → `[]`).
- **Hub:** `buildInto` gegen Obsidian-Mock — Tab-Wechsel toggelt `is-hidden`, Default-Fallback,
  `onShow/onHide` gefeuert.
- **ViewModel** bleibt pure/unberührt.
- **Gate grün** (`npm run gate`) vor jedem Commit.

## 7. Geänderte/neue Dateien

**Neu:** `src/obsidian/hub.ts` (vendored), `src/obsidian/generate-panel.ts`,
`src/obsidian/history-panel.ts`.
**Geändert:** `src/obsidian/view.ts` (Hülle), `src/core/history.ts` (Entry-Modell + group/delete),
`src/core/settings.ts` (Modell + Migration + `historyView`), `src/core/strings.ts` (Reroll, Tab-/
History-Labels — EN-only, i18n-Sweep zieht später nach), `src/main.ts` (Rezept aufzeichnen +
Host-Methoden), `styles.css`.

## 8. Nicht in diesem Scope (Backlog-Zeiger)

- **i18n (DE/EN):** eigene Sonnet-Session. Kit-i18n (`obsidian-kit/src/pure/i18n.ts`) vendoren nach
  `src/vendor/kit/i18n.ts` + `src/i18n/strings.ts` (EN/DE) + Locale-Detection im `onload`. Der Sweep
  fasst alle Strings an und schluckt die hier neu hinzugefügten mit. Früh priorisieren.
- **Robustheits-Block (Backlog 4/5/6):** Download-Fortschritt, Ladephasen-Status, Watchdog. Eigene
  Sonnet-Session, Plan folgt.
