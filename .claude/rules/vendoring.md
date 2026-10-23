---
paths:
  - "tools/kit-sync.json"
  - "tools/sync-kit.sh"
  - "src/vendor/**"
  - "package.json"
  - "styles.css"
  - "src/obsidian/help-row.ts"
  - "tests/help-row.test.ts"
---

# Kit-Vendoring und Hilfe-Zeile

Gotchas zum Vendoring aus obsidian-kit und code-kit (`tools/kit-sync.json`, `src/vendor/`): feste Refs, Zielordner, Einzelpins.

- **Vendoring (nie von Hand):** `sh tools/sync-kit.sh` ist seit Welle 12 (2026-09-27) nur noch
  ein Wrapper und delegiert an das zentrale `../tools/kit-sync/kit-sync.mjs`; Pins und
  Modul-/Zielordner-Zuordnung stehen in `tools/kit-sync.json`, nicht mehr in Env-Variablen
  (`KIT_REF`/`KIT_HELP_REF` sind Geschichte). Ein Kit-Upgrade ist weiter eine bewusste Handlung —
  jetzt per Editieren der `ref`-Werte in `tools/kit-sync.json`, kein Nebeneffekt davon, dass
  jemand nebenan im Nachbar-Checkout einen Branch auscheckt (Inhalt kommt per `git show <ref>:…`,
  CORE-META-22). Vor 2026-09-27 lief das ueber ein repo-eigenes Skript mit `KIT_REF`/`KIT_HELP_REF`;
  die dort gemessenen Lehren gelten fuer das zentrale Werkzeug sinngemaess (Fix bereits dort
  gebaut): Inhalt kommt aus einer FESTEN REF, nie aus dem Arbeitsstand des Nachbar-Repos: bis
  2026-09-02 war das hier umgekehrt und seit Kit 0.28.0 ein DEFEKT (pure-Module nach `code-kit`
  abgewandert, ein Lauf gegen den Arbeitsstand waere abgebrochen, ohne dass der alte
  Ordner-Existenz-Guard es gesehen haette). Ebenso: Schreiben ueber `.tmp` + `mv`, nie eine
  Umleitung direkt aufs Ziel (sonst bleibt bei fehlgeschlagenem `git show` ein Torso mit
  gueltig aussehender Stempelzeile stehen) — `kit-sync.mjs` macht das. **Zielordner ist Vertrag,
  nicht Geschmack:** `obsidian-kit/src/pure/*` → `src/vendor/kit/`,
  `obsidian-kit/src/obsidian/*` → `src/vendor/kit-obsidian/` — ein obsidian-importierendes Modul
  unter `src/vendor/kit/` bricht `npm run check:pure` und damit das Gate. Ein neues Modul kommt
  in die `modules`-Liste von `tools/kit-sync.json`, nicht per `cp` in den Baum; danach muss
  `node ../tools/kit-sync/kit-sync.mjs --check` Exit 0 liefern (Reproduzierbarkeit).
  ⚠️ `HUB_CSS` aus `src/vendor/kit-obsidian/hub.ts` ist zusaetzlich in `styles.css` uebernommen —
  das Kit injiziert kein CSS. Wer das Modul neu vendoriert, gleicht den Block mit ab.
- **Hilfe-Zeile:** `src/vendor/kit-obsidian/help-setting.ts` hat seit Welle 12 einen Einzelpin
  `{ "name": "help-setting", "ref": "0.43.0" }` in `tools/kit-sync.json` (vorher `KIT_HELP_REF`
  in `tools/sync-kit.sh`); die uebrigen Module bleiben auf der Quell-Ref `0.27.0`. Die Zeile ist
  das erste Element von `getSettingDefinitions()` (`src/obsidian/help-row.ts`), Test
  `tests/help-row.test.ts`, Smoke-Punkt 41.
