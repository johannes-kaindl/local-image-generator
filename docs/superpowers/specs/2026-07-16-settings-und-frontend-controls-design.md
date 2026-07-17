# local-image-generator — Settings & Frontend-Controls (0.2)

**Datum:** 2026-07-16 · **Status:** beschlossen (Brainstorming mit Jay)
**Repo:** `/Users/Shared/code/obsidian-plugins/local-image-generator`
**Vorgänger:** `2026-07-16-local-image-generator-mvp-design.md` (0.1, ausgeliefert)

## 1. Kontext & Ziel

0.1 kann genau drei Dinge einstellen: Prompt, Steps (1–4), Seed. Der Smoke-Test am
2026-07-16 hat gezeigt, was fehlt — Jay hat die Ergebnis-Notiz mit Frontmatter von Hand
gebaut (`00_Inbox/Apple - Sumi-e painting - 199801046.md`) und den Stil-Suffix jedes Mal
neu getippt.

**Ziel 0.2 (dieser Schnitt):** Die wiederkehrenden Handgriffe verschwinden. Presets statt
Tippen, Seed-Sperre statt Neu-Würfeln, Historie statt Erinnern, Notiz-Erzeugung statt
Handarbeit — plus die Settings-Struktur, die das trägt.

**Erfolgskriterium:** Jay generiert ein Bild, klickt einen Stil-Chip statt zu tippen,
sperrt den Seed und variiert den Prompt, und bekommt per Create eine fertige Notiz mit
korrektem Frontmatter — ohne einen Handgriff außerhalb der Sidebar.

## 2. Beschlossene Eckpunkte (Brainstorming 2026-07-16)

| Frage | Entscheidung |
|---|---|
| Modell-Weiche | **SD-Turbo bleibt allein.** Keine Knöpfe für Negative Prompt, CFG-Scale, Auflösung — SD-Turbo ist ohne Classifier-Free Guidance trainiert und auf 512×512/1–4 Steps destilliert; solche Regler wären Attrappen (`engine.ts:48-50`, Guidance konstant 1.0) |
| Sidebar-Knöpfe | **Seed-Sperre, Stil-Presets als Chips, Prompt-Historie** |
| Create | **Toggle** in den Settings: nur Bild (wie 0.1) **oder** Bild + Notiz mit Frontmatter + Embed |
| Frontmatter-Serializer | **Vendoren** aus `vault-rag/src/frontmatter.ts` nach `src/vendor/kit/frontmatter.ts`. Kit-Extraktion + Registry-Korrektur laufen separat als `/drift-audit` |
| Collapsible-Sektionen | **Vendoren** aus `obsidian-kit/src/obsidian/collapsible.ts` (existiert samt Persistenz-Callback) |
| Folder-Suggest | **Vendoren** aus `vault-rag/src/settings.ts:64` |

## 3. Kit-first-Befund (verifiziert 2026-07-16)

Vorab-Recherche über alle Repos unter `obsidian-plugins/`. Zwei verbreitete Annahmen
haben sich als **falsch** erwiesen — hier festgehalten, damit sie nicht wiederkehren:

- **Das obsidian-kit hat KEINEN Frontmatter-Baustein.** `src/pure/` enthält endpoint,
  i18n, sse, num, reasoning, settings, think-splitter, pdf/*. Nichts für YAML.
- **`letterhead` und `paperize` haben KEINEN Folder-Suggest.** Beide nutzen ein nacktes
  `addText`-Feld (`obsidian-paperize/src/obsidian/settings.ts:152`). Der einzige echte
  Suggest im Workspace ist `vault-rag/src/settings.ts:64` (modul-privat, ~25 Zeilen).

Verwertbare Quellen:

- **`vault-rag/src/frontmatter.ts:172`** — `serializeFrontmatter(data, order)`, pure,
  testgedeckt (`vault-rag/tests/frontmatter.test.ts`). Escapt die teuren Fälle:
  `[[Wikilinks]]`, `: `, `#`, führende YAML-Sonderzeichen, Emoji-Codepoints,
  `true/false/null/yes/no/on/off/~`, zahl-aussehende Strings. **Anpassung beim Vendoren:**
  `FmValue` ist heute `string | string[]` — für native Zahlen (`seed: 199801046` statt
  `seed: "199801046"`) muss `number` ergänzt werden.
- **`image-to-markdown/src/img_to_md.ts:83`** — liefert das **Muster** (pure `lines[]`-Builder:
  `---` → Frontmatter → `---` → `![[embed]]` → Body; `io.createNote` injiziert). Sein
  Escaping (`s.replace(/"/g, '\\"')`, keine Backslashes) ist zu schwach und wird **nicht**
  übernommen.
- **`yijing-oracle/src/core/frontmatter.ts:58`** — domänengebunden (`FieldId` als fixer
  Union), **kein** Vendor-Ziel.
- **`obsidian-kit/src/obsidian/collapsible.ts`** — `collapsibleSection(containerEl, opts)`
  gibt den Body-Container zurück; `resolveCollapsed(key, default, storage)` ist pure.
  Braucht CSS für `.okit-collapsible*` in `styles.css`.

**Registry-Lücke (nicht Teil dieser Spec):** REGISTRY.md Zeile 34 zählt für
„Frontmatter serialisieren" n=2, tatsächlich sind es n=3–4 (vault-rag und
`finance-ledger-plugin/…/categorizer-rules/writer.ts:60` fehlen). Die Regel-der-Drei ist
damit erreicht → Kit-Extraktions-Entscheidung, gehört in einen `/drift-audit`-Lauf.

## 4. Zuschnitt

**Drin:** Seed-Sperre · Stil-Presets · Prompt-Historie · Create-as-note mit Toggle ·
Ausgabeziel mit Ordner-Autocomplete · einklappbare Settings-Sektionen.
(Deckt 0.2-Backlog-Punkte 1, 2, 7, 8 aus dem Cockpit ab.)

**Bewusst draußen:**

- **0.2-Backlog 4/5/6** (Download-Fortschritt robust, Ladephasen-Status, Watchdog um
  `InferenceSession.create`) — das ist Robustheit, nicht Einstellung. Eigener Schnitt.
- **0.2-Backlog 3** (wählbares Modell-Download-Ziel statt Cache API) — berührt den
  ModelStore, nicht die Bedien-Oberfläche.
- **Konfigurierbare Frontmatter-Keys** — laut REGISTRY Zeile 34 ein Kit-Thema mit offener
  Abstraktionsfrage; nicht verlangt (YAGNI).
- **LLM-gestützte Prompt-Verbesserung** — eigene Spec, eigener Provider, eigene
  Fehlerpfade. Explizit „später".

## 5. Datenmodell

### 5.1 Settings (`src/core/settings.ts`)

```ts
export interface StylePreset {
  id: string;      // stabil, für Reihenfolge/Löschen
  label: string;   // Chip-Beschriftung
  suffix: string;  // wird an den Prompt gehängt
}

export interface LigSettings {
  outputFolder: string;            // "" = Obsidians Attachment-Logik (wie 0.1)
  noteFolder: string;              // "" = neben dem Bild
  defaultSteps: number;            // 1..4, Default 4
  createMode: "image" | "note";    // Default "image" (0.1-Verhalten bleibt Default)
  presets: StylePreset[];
  promptHistory: string[];            // MRU, neueste zuerst
  sectionsCollapsed: Record<string, boolean>;  // Auf-/Zu-Zustand der Settings-Sektionen
}
```

Das Limit der Historie ist **kein** Setting, sondern eine Konstante in `history.ts`
(`HISTORY_LIMIT = 20`) — ein Regler, den niemand verlangt hat und der im Settings-Tab nur
Platz kostet, wäre YAGNI; ein Feld in `data.json` ohne UI wäre ein Fremdkörper.

`defaultSteps` wird beim Mounten der View in den Steps-Slider geschrieben
(`view.ts:73` hat heute `value: "1"` hartkodiert). Danach gehört der Slider dem Nutzer —
die Einstellung ist ein Startwert, kein Zwang, und wird nicht zurückgeschrieben.

`promptHistory` ist streng genommen Zustand, keine Einstellung. Sie wohnt trotzdem in
`data.json`: es gibt keinen zweiten Speicher, und der vendorte `mergeSettings`
(`src/vendor/kit/settings.ts`) klont Arrays bereits sauber (`value.slice()`). Ein eigener
Persistenzweg wäre Overhead ohne Gegenwert.

**Migration:** keine nötig. `mergeSettings(DEFAULT_SETTINGS, await this.loadData())`
(`main.ts:30`) legt fehlende Felder aus den Defaults auf; bestehende `data.json` mit nur
`{outputFolder}` laufen unverändert weiter.

**Default-Presets** werden mitgeliefert (sonst ist die Chip-Zeile beim ersten Start leer
und das Feature unsichtbar): Sumi-e, Aquarell, Foto, Ölgemälde — je ein knapper Suffix.

### 5.2 Panel-State (`src/core/viewmodel.ts`)

```ts
export interface GenParams {
  prompt: string;
  seed: number;
  steps: number;
  model: string;   // "sd-turbo"
  date: string;    // ISO-8601, beim Generieren gestempelt
}

// vorher: image: { seed: number; dataUrl: string } | null
image: { dataUrl: string; params: GenParams } | null;
```

**Warum das nötig ist (latenter Bug in 0.1):** `state.image` hält heute nur
`{seed, dataUrl}` (`main.ts:145`), der Prompt lebt live in `state.prompt`, die Steps nur
im DOM-Slider. Generierst du, änderst dann den Prompt und drückst *dann* Create, schriebe
die Notiz den **neuen** Prompt ins Frontmatter — obwohl das Bild aus dem alten stammt.
Heute unsichtbar, weil niemand die Parameter ausliest; mit Create-as-note würde es still
falsche Metadaten produzieren. Die Parameter werden deshalb **beim Generieren
eingefroren**, nicht beim Speichern eingesammelt.

Betroffene Leser: `viewmodel.ts` prüft nur `s.image !== null` (unverändert), `view.ts:134`
liest `state.image.dataUrl` (unverändert), `main.ts:183` liest `img.seed` → wird
`img.params.seed`.

## 6. Komponenten

Neue Dateien, alle klein und einzeln testbar. Der Pure-Core-Schnitt bleibt gewahrt
(`scripts/check-pure.mjs`): `src/core/` und `src/vendor/kit/` importieren nie `obsidian`.

| Datei | Zweck | Pure? |
|---|---|---|
| `src/core/history.ts` | `pushHistory(list, prompt)` — MRU, Duplikat wandert nach vorn, `HISTORY_LIMIT` | ja |
| `src/core/presets.ts` | `togglePresetInPrompt(prompt, suffix)`, `presetActive(prompt, suffix)` | ja |
| `src/core/note.ts` | `buildImageNote(params, imageLink)` → kompletter Notiz-Text | ja |
| `src/vendor/kit/frontmatter.ts` | vendorter `serializeFrontmatter` (+ `number` in `FmValue`) | ja |
| `src/obsidian/folder-suggest.ts` | vendorter `FolderSuggest` (exportiert) | nein |
| `src/obsidian/collapsible.ts` | vendorter `collapsibleSection` | nein |
| `src/obsidian/preset-editor.ts` | Preset-Liste im Settings-Tab | nein |

Erweitert: `src/core/settings.ts`, `src/core/filename.ts` (`buildNoteFilename`),
`src/core/viewmodel.ts`, `src/obsidian/view.ts`, `src/obsidian/settings-tab.ts`,
`src/main.ts`, `styles.css`.

`view.ts` (147 Zeilen) und `settings-tab.ts` (74 Zeilen) wachsen spürbar. Der
Preset-Editor wandert deshalb in eine eigene Datei; wenn `view.ts` über ~250 Zeilen geht,
wird die Prompt-Leiste (Textarea + Chips + Historie) nach
`src/obsidian/prompt-controls.ts` ausgelagert.

## 7. Bedienung

### 7.1 Stil-Presets

Chip-Zeile unter dem Prompt-Feld. Klick hängt den Suffix an den Prompt (kommasepariert),
erneuter Klick entfernt ihn. Der Chip leuchtet, solange sein Suffix im Prompt steht.

**Das Textfeld ist die einzige Wahrheit** — der Chip-Zustand wird daraus *abgeleitet*
(`presetActive(prompt, suffix)`), nicht parallel geführt. Entfernt Jay den Suffix von
Hand, geht der Chip von selbst aus. Das erspart eine zweite State-Quelle, die
auseinanderlaufen kann.

### 7.2 Seed-Sperre

Schloss-Icon neben dem Würfel. Gesperrt = „Neu generieren" behält den Seed statt zu
würfeln (Fix für `view.ts:107`). Der Würfel bleibt unberührt — bewusstes Neu-Würfeln geht
auch im gesperrten Zustand. Die Sperre lebt nur in der View und überlebt keinen
Obsidian-Neustart; sie gehört zum Arbeiten an *einem* Bild.

### 7.3 Prompt-Historie

Uhr-Icon neben dem Prompt öffnet ein natives Obsidian-`Menu` mit den letzten Prompts, auf
lesbare Länge gekürzt. Klick setzt den Prompt. Ein Eintrag wird **nur bei erfolgreicher
Generierung** aufgenommen — sonst füllt sich die Liste mit Halbsätzen.

### 7.4 Create-as-note

`createMode: "image"` → exakt das Verhalten aus 0.1 (Bild anlegen, Bild öffnen).

`createMode: "note"` → Bild anlegen, **zusätzlich** Notiz anlegen, **Notiz** öffnen.

```markdown
---
prompt: "an apple, sumi-e painting, monochrome"
seed: 199801046
steps: 4
model: sd-turbo
created: 2026-07-16T21:52:43
image: "[[lig-20260716-215243-s199801046.png]]"
---

![[lig-20260716-215243-s199801046.png]]
```

Werte kommen aus den eingefrorenen `GenParams` (§5.2). Wikilinks werden gequotet
(unquoted bricht `[[` das YAML — Muster von image-to-markdown).

**Notiz-Dateiname:** `buildNoteFilename(prompt, seed)` → Prompt-Slug (max 60 Zeichen) +
` - ` + Seed, nach Jays handgebautem Vorbild: `Apple - Sumi-e painting - 199801046.md`.
Slug entfernt die in Obsidian/Dateisystemen verbotenen Zeichen (`[ ] # ^ | / \ : * ? " < >`),
kollabiert Whitespace und streift führende Punkte (sonst versteckte Datei). Leerer Slug →
Fallback `lig-<seed>`. Kollisionen über die vorhandene `dedupeFilename` (`filename.ts:11`).

**Notiz-Ort:** `noteFolder`, leer = neben dem Bild. Eigenes Feld, weil das Bild in den
Anhang-Ordner darf, die Notiz aber in den Inbox gehört.

### 7.5 Settings-Tab

Vier Sektionen über `collapsibleSection`, Reihenfolge nach UI-STANDARD §5 (Modell zuerst,
Gefährliches ans Ende):

1. **Modell** — wie heute (Download/Status)
2. **Ausgabe** — Bild-Ordner (mit `FolderSuggest`), Notiz-Ordner (mit `FolderSuggest`),
   Create-Modus (Toggle), Default-Steps (Slider 1–4)
3. **Presets** — Preset-Editor
4. **Gefährliches** — Modell löschen (wie heute)

Der Auf-/Zu-Zustand wird über den `CollapsibleStorage`-Callback des Kit-Bausteins in
`data.json` persistiert.

**Preset-Editor:** je Preset zwei Textfelder (Beschriftung, Suffix) + Löschen-Button,
darunter „Preset hinzufügen".

> **Fallstrick, explizit adressiert:** Obsidians `onChange` feuert **pro Tastendruck**.
> Ein Editor, der bei jeder Änderung speichert *und neu rendert*, verliert den Fokus nach
> jedem Buchstaben und arbeitet mit stale Render-Indizes. Die Felder committen deshalb auf
> **`blur`** (`registerDomEvent`), neu gerendert wird **nur** bei Hinzufügen/Löschen.
> (Quelle: `_docs/LESSONS.md`, vim-dojo 0.5.0 — dort exakt dieser Bug, Fix = commit-on-blur.)

## 8. Fehlerpfade

- **Notiz-Schreiben scheitert** (Ordner fehlt, Vault-Fehler): dieselbe `Notice`-Behandlung
  wie `saveImage` heute (`main.ts:193`). **Das bereits geschriebene Bild wird nicht
  zurückgenommen** — Jay bekommt Bild + Fehlermeldung, nicht den Verlust von beidem.
  Reihenfolge daher: Bild schreiben → Notiz schreiben → Notiz öffnen.
- **`noteFolder` existiert nicht:** anlegen (wie `resolveImagePath` es für `outputFolder`
  tut, `main.ts:169`).
- **Historie/Presets in `data.json` beschädigt** (handeditiert, falscher Typ):
  `mergeSettings` macht einen Shallow-Merge **ohne jede Formprüfung** — `Object.assign`
  reicht `presets: null` unverändert durch. Deshalb bereinigt eine pure
  `sanitizeSettings()` den geladenen Stand **einmal beim Laden** (in `main.ts` direkt nach
  `mergeSettings`), statt an jeder Renderstelle zu filtern: es gibt vier Stellen, die auf
  die Form vertrauen (Chips, Preset-Editor, Collapsible-Storage, Historie-Push), und eine
  Quelle abzusichern ist testbar, vier Renderstellen zu flicken nicht.

  **Warum das scharf ist:** `renderChips()` ist die erste Zeile von `refresh()`, und
  `refresh()` läuft bei jedem Tastendruck. Wirft `presetActive` an einem Preset ohne
  `suffix`, ist das Panel nicht degradiert, sondern tot — jeder weitere Tastendruck läuft
  in denselben Wurf. Analog reißt ein `presets: null` den Settings-Tab ins Leere, weil
  `display()` sein `containerEl.empty()` schon hinter sich hat.

  `sanitizeSettings` coerct: `presets` → Array, nur Einträge mit `id`/`label`/`suffix` als
  String · `promptHistory` → `string[]` · `sectionsCollapsed` → Plain-Object ·
  `defaultSteps` → 1..4 · `createMode` → Union.
- **Create ohne Bild:** unverändert No-op (`main.ts:181`).

## 9. Tests

Pure-Kern, vitest, TDD:

- **`history.ts`** — leere Liste; Anhängen; Duplikat wandert nach vorn statt zu doppeln;
  Limit schneidet ältestes ab; leerer/whitespace-Prompt wird nicht aufgenommen.
- **`presets.ts`** — Suffix anhängen an leeren/befüllten Prompt; Toggle entfernt ihn
  wieder; `presetActive` nach manuellem Entfernen `false`; Suffix als Teilstring eines
  längeren Worts zählt nicht als aktiv.
- **`note.ts`** — Frontmatter + Embed; Prompt mit Doppelpunkt; Prompt mit `[[`; Prompt mit
  Anführungszeichen; Seed als native Zahl (nicht gequotet).
- **`filename.ts`** — `buildNoteFilename` mit verbotenen Zeichen, Überlänge (>60),
  leerem Slug (Fallback), Unicode.
- **`viewmodel.ts`** — bestehende Tests an die neue `image`-Form anpassen.
- **`vendor/kit/frontmatter.ts`** — Tests aus vault-rag mit vendoren, plus ein Fall für
  die `number`-Erweiterung.

Die Obsidian-Schicht (Suggest, Menu, Collapsible, Preset-Editor-DOM) bleibt ungetestet —
dort liegt keine Entscheidungslogik. Gate (`npm run gate`) muss grün sein.

## 10. Offene Punkte für später

- **Kit-Extraktion `serializeFrontmatter`** (Regel-der-Drei erreicht) + REGISTRY-Zeile-34-
  Korrektur → `/drift-audit`.
- **`FolderSuggest` als Kit-Kandidat** — mit diesem Repo n=2. Bei n=3 extrahieren.
- **0.2-Backlog 3/4/5/6** — ModelStore-Ziel + Robustheits-Block.
- **LLM-Prompt-Verbesserung** — eigene Spec.
