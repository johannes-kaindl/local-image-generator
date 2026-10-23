---
paths:
  - "styles.css"
  - "src/obsidian/view.ts"
  - "src/obsidian/hub.ts"
  - "src/obsidian/generate-panel.ts"
  - "src/obsidian/history-panel.ts"
  - "src/obsidian/settings-tab.ts"
---

# Panel, Settings-Tab und Stylesheet

Gotchas zum Sidebar-Hub, zum Settings-Tab und zu `styles.css` (Sichtbarkeit je Backend, Reihenfolge im Stylesheet).

- **Kit-Hub: `setTab(aktueller Tab)` ist ein No-op — kein `onShow()`, kein Re-Render.** Der
  Guard (`if (id === navState) return`) kam mit dem Vendoring von `buildHubInto` (Kit 0.27.0) und
  ist richtig; er heisst aber, dass ein Klick auf den bereits aktiven Reiter das Panel NICHT
  auffrischt. Wer ein sichtbares Panel neu zeichnen will, nimmt `refreshActive()` (oder den
  Host-Pfad `view.refresh()`), nicht einen zweiten Klick. Der aktive Reiter ueberlebt im
  Workspace-State — was im GUI-Smoke am 2026-08-21 einen flaky Pruefpunkt erzeugte (Punkt 10 mass
  die Historie VOR dem Lauf, weil sein Tab-Klick ins Leere lief; `docs/SMOKE.md` § 2026-08-21).
- **Settings-Tab: bedingte Zeilen weglassen, nicht `visible:false`** — Obsidian 1.13 cacht
  `getSettingDefinitions()` und wertet Praedikate nicht neu aus; nach Modus-/Zustandswechsel
  `refreshUi()` (gemessen 2026-08-19: Server-Zeile blieb im builtin-Modus stehen).
  **Von aussen (Treiber, Test) heisst das: den Modus ueber das DROPDOWN wechseln, nicht ueber
  die Einstellung.** Nur dessen `onChange` ruft `refreshUi()`. Wer den Wert vorher setzt,
  nimmt dem Wechsel sogar seinen Anlass — das Dropdown steht dann schon richtig, das Ereignis
  bleibt aus, und darunter steht die Zeile des alten Modus (gemessen 2026-08-21 an
  `settings-server.png`, zweimal hintereinander).
- **`.is-hidden` steht am ENDE von `styles.css` — und muss dort bleiben.** Es ist die
  Aus-Schaltung fuer jede Zeile, die ein Backend nicht kann (Negativ-Prompt, CFG, Groesse:
  die Keine-Attrappen-Linie). Die Regel traegt nur eine Klasse und verliert deshalb gegen
  jede spaetere Ein-Klassen-Regel, die `display` setzt. Genau so blieb die Negativ-Zeile im
  builtin-Modus sichtbar, obwohl das Panel sie korrekt markiert hatte (`.lig-prompt-row`
  stand weiter unten). Wer etwas anhaengt, haengt es DARUEBER an.
- **Ein range-Input klemmt seinen `value` selbst, sobald `max` sinkt.** Deshalb darf das
  Nachziehen der Anzeige nicht davon abhaengen, ob `clamped !== stepsEl.value` — diese
  Bedingung ist nach dem Setzen von `max` nie erfuellt, und die Zahl neben dem Regler bleibt
  auf ihrem Startwert stehen (gemessen 2026-08-21: Regler auf 4, Beschriftung „20").
  Verallgemeinert: **beide Anzeigefehler waren nur ueber die GERENDERTE Darstellung
  sichtbar** (`getComputedStyle`, DOM-Text), nie ueber den Zustand — Unit-Tests koennen sie
  nicht finden, ein Screenshot findet sie sofort. **Seit 2026-08-22 bewacht sie Smoke-Punkt 17**
  (`runControlVisibilityCheck`): er misst beide Richtungen ueber `getComputedStyle`, laeuft in
  jedem Lauf (auch `--quick`, er braucht weder Server noch Assets) und schiebt den Steps-Regler
  vorher selbst ueber das builtin-Maximum — ohne dieses Klemmen kann die Beschriftung gar nicht
  danebenliegen, und der Punkt blieb in der Gegenprobe gruen, obwohl der Defekt drin war.
