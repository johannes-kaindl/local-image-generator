---
paths:
  - "scripts/gui-smoke.ts"
  - "scripts/shots.ts"
  - "scripts/mock-a1111.mjs"
  - "scripts/mock-comfy.mjs"
  - "scripts/mock-assets.mjs"
  - "docs/SMOKE.md"
---

# GUI-Smoke dieses Repos — Mocks, Vault-Guard, Soll-Listen

Gotchas zum Treiber `scripts/gui-smoke.ts` und seinen Mocks; die allgemeinen Treiberregeln stehen im Dach (`.claude/rules/gui-smoke-treiber.md`, `obsidian-instanz.md`, `cdp-lock.md`), der Ablauf in `docs/SMOKE.md`.

- **`npm run deploy` ist kein Reload.** Obsidian laedt die kopierte `main.js` erst beim
  Aktivieren des Plugins; ein laufendes Fenster misst sonst den Stand von seinem letzten Start,
  und die Manifest-Version verraet den Unterschied nicht. `scripts/gui-smoke.ts` laedt das Plugin
  deshalb selbst neu, bevor es misst. Wer von Hand prueft: Plugin aus- und einschalten.
- **GUI-Smoke ohne echten Bild-Server:** `node scripts/mock-a1111.mjs` stellt die drei
  Endpunkte auf Port 7861 (`/progress` → 404, zaehlt Anfragen in `.mock-a1111-counts.json`);
  Plugin-Endpunkt darauf stellen, `npm run smoke:gui` fahren. Draw Things' API-Server ist ein
  Schalter in der App-Oberflaeche — `open -a "Draw Things"` allein oeffnet Port 7860 nicht.
- ⚠️ **Nach einem abgebrochenen Smoke-Lauf (Ctrl-C) den Bild-Mock neu starten, bevor ein Nachlauf misst** (gemessen 2026-10-14, Welle 21): Der Mock zählt seine Anfragen in `.mock-a1111-counts.json`, und Anfragen des abgebrochenen Laufs standen noch im Zählerstand. Ein Nachlauf direkt auf demselben Mock war bei Punkt 19 rot (`txt2img-Anfragen: -2`), mit frischem Mock 29 grün. n=1.
- **Der Treiber läuft nur in einem Vault, dessen Name mit `local-image-generator` beginnt** (Vault-Guard seit Welle 21, Selbsttest im Treiber): Er schreibt Einstellungen und legt `_lig-gui-smoke` an. Ein fremder Name (Arbeits-Vault) bricht vor dem ersten Schreibzugriff ab.
- ⚠️ **`scripts/mock-a1111.mjs` hat seit 2026-09-02 einen FREMDEN Konsumenten.** Der Naht-Lauf
  von `epub-exporter` (`npm run smoke:e2e` dort) startet den Mock selbst und faehrt die
  Provider-API v1 ueber die Plugin-Grenze — er belegt damit, was beide Halbe-Seite-Smokes
  ueberspringen (REGISTRY, Zeile „Eine Faehigkeit fuer andere Obsidian-Plugins bereitstellen").
  Praktische Folge fuer dieses Repo: **wer die Endpunkte, den Fehlerschalter `/mock/fail?on=`
  oder die Antwortform des Mocks aendert, bricht einen Treiber im Nachbar-Repo** — und zwar
  still, weil er hier nicht mitlaeuft. Dasselbe gilt fuer die Vertragszusagen, die der Lauf
  misst: `apiVersion` am Plugin-Objekt, `recheck()` heilt `unreachable`, `capabilities.sizes`
  meldet im builtin-Modus GENAU eine Groesse, ein Backend-Fehlschlag kommt als Wert.
- **`scripts/mock-comfy.mjs` ist deshalb eine EIGENE Datei, kein drittes `if` in
  `mock-a1111.mjs`.** ComfyUIs API-Form (Queue-POST auf `/prompt`, Polling auf
  `/history/<id>`, Bildabruf auf `/view`) hat nichts mit A1111s drei Endpunkten gemein, und
  `mock-a1111.mjs` traegt bereits einen fremden Konsumenten (s. o.) — eine Aenderung dort fuer
  ComfyUI haette dessen Vertrag mitverschoben, ohne dass der Naht-Lauf in `epub-exporter` das
  hier sehen wuerde. Zwei getrennte Mocks halten die beiden Vertraege getrennt aenderbar.
- **`.lig-model-pick` gehoert aus demselben Grund wie `.lig-denoise` NICHT in `MODUS_REGLER` (zwei unabhängige Sichtbarkeitsbedingungen, s. `.claude/rules/img2img.md`).** Die
  Modellwahl im Panel hat ebenfalls zwei UNABHAENGIGE Sichtbarkeitsbedingungen —
  `settings.showModelPicker` UND mehr als ein heruntergeladenes Modell — statt der einen
  (`mode`), die `MODUS_REGLER` prueft. Dort gefuehrt, meldete der Modus-Umschalt-Punkt einen
  Defekt in jedem Setup, in dem der Picker aus einem der beiden anderen Gruende zu Recht
  verborgen ist.
- **`MODUS_REGLER` im GUI-Smoke-Treiber traegt fuer DREI Modi nicht mehr — deshalb Punkt 35
  gegen eine eigene Erwartungstabelle statt gegen dieselbe Liste.** Die Liste ist als „im
  builtin-Modus versteckt, im server-Modus sichtbar" gebaut (eine Bedingung, ein Vergleich).
  Im comfy-Modus stimmt das nur fuer die CFG-Zeilen — `.lig-negative-row` ist dort
  SICHTBAR (der Negativ-Slot ist Teil der Sampler-Erkennung und existiert per Definition),
  waehrend CFG weiterhin verborgen bleibt (`patchWorkflow` fasst CFG bewusst nicht an).
  Ein dritter Durchlauf gegen `MODUS_REGLER` haette die Negativ-Zeile als falsch-roten
  Befund gemeldet. `MODUS_ERWARTUNG` (`scripts/gui-smoke.ts`, Punkt 35) fuehrt stattdessen
  je Modus eine eigene `{ sichtbar, versteckt }`-Zeile — drei Modi, drei Zeilen, keine
  gemeinsame Bedingung, die stillschweigend annimmt, es gaebe nur „kann alles" und „kann
  wenig". `MODUS_REGLER` selbst bleibt daneben bestehen (Punkt 17 prueft weiterhin nur
  builtin/server) — die beiden Listen sind nicht dieselbe Datenquelle mit zwei Namen.
