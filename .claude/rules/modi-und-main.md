---
paths:
  - "src/main.ts"
  - "src/core/viewmodel.ts"
  - "src/core/resolve-endpoint.ts"
  - "src/obsidian/playground-backend.ts"
  - "src/obsidian/settings-tab.ts"
---

# Backend-Modi, Hauptplugin und Endpunkte

Gotchas zu `src/main.ts` (Routing nach `settings.engine`, Fremdläufe), zu den vier Modi, zum Kurzbefehl-Backend und zur Endpunkt-Auflösung über den LLM Endpoint Manager.

- **Ein Fremdlauf hinterlaesst im Panel KEINE Spur — auch nicht als Fehler.** `runGeneration`
  faellt im `catch` bei `external` auf `{ kind: "idle" }` zurueck statt auf `error` mit der
  rohen Backend-Meldung (Ruling 2026-08-23, `f223c8f`). Das sieht wie ein verschluckter Fehler
  aus und ist keiner: der Erfolgsfall schrieb schon immer `idle`, der Aufrufer bekommt den
  Fehler als Rueckgabewert, und die Statuszeile gehoert dem eigenen Klick. Wer hier einen
  Fehlerzustand zurueckbaut, laesst das Panel wieder einen FREMDEN Fehlschlag als eigenen
  melden. Der Fix liegt in `main.ts`, der einzigen Schicht ohne Unit-Test-Ebene — seit
  2026-08-30 deckt ihn **GUI-Smoke-Punkt 18c**, gemessen an der gerenderten Statuszeile gegen
  ihren Wert von VORHER (Gegenprobe: den Fallback zurueckgebaut → rot mit „Statuszeile WEICHT
  AB von „Ready""). Diese Zeile ist damit nicht mehr die einzige Deckung.
- **`PanelState.mode` wird ABGELEITET, nicht gespiegelt.** Der gehaltene State ist
  `Omit<PanelState, "mode">`; `mode` entsteht einzig in `getPanelState()` aus
  `settings.engine`. Das `Omit` ist der eigentliche Fix — es macht ein zweites Spiegeln
  typseitig unmoeglich (Gegenprobe: eine Zuweisung `this.state.mode = …` bricht `tsc` mit
  TS2339). Vorher hielten zwei Zuweisungen in `main.ts` die Kopie von Hand synchron, und das
  ViewModel las die Kopie, waehrend alles Neuere `settings.engine` las.
- **Ein neuer Backend-Modus fällt an rund einem Dutzend Stellen in den else-Zweig, und `tsc` warnt dort nicht.** `PanelState.mode` ist `EngineChoice` (nicht mehr `"builtin" | "server"`), weil `getPanelState()` `settings.engine` hineinschreibt; seit dieser Weitung kompiliert jedes `else` klaglos, ob die Behandlung als Server dort richtig ist oder nicht. Der Wächter ist damit **diese Liste** statt des Compilers: derselbe Fehlermodus wie beim verlorenen Session-Wachhund (nur in einer Datei festgehalten, die beim nächsten Umbau nicht mitgelesen wird). Wer einen fünften Modus einführt, geht sie durch und sucht nicht neu: `EngineChoice` samt `oneOf`, die Ternärkette in `runGeneration()`, `apiReadiness()`, `currentModelName()`, `endpointRole()`/`resolveEndpointFor()` (playground hat KEINEN Endpunkt), den Aufräumzweig in `setEngine()`, den Wächter in `generate()`, die Ternärkette im Settings-Dropdown, `backendCapabilities()`/`toBackendContext()`, `buildViewModel()`, `recheck()` und `makeComfyClient()`.
  Was comfy und playground an diesen Stellen verlangen: `currentModelName` liefert für comfy `null` aus `checkServer()` und fällt auf `"unknown"` zurück, die Notiz nennt also ehrlich „unknown“ und nie den Namen eines fremden A1111-Servers. `apiReadiness` prüft für comfy zuerst `state.workflow.kind !== "ok"` (→ `not-configured`), damit ein Fremdplugin nicht allein deshalb `ready: true` bekommt, weil irgendein Server antwortet. Der Aufräumzweig in `setEngine` hängt an `mode !== "builtin"` (nicht an `=== "server"`): ein Wechsel builtin → comfy oder playground bricht einen laufenden Download ab und gibt die GPU-Sessions frei. Das Settings-Dropdown leitet vierwertig ab, die Auswahl „ComfyUI“ springt beim Speichern nicht auf `builtin` zurück. `recheck()` ist für comfy kein builtin-No-op. `buildViewModel` hat eigene Zweige (`comfyStatus`/`comfyEmpty`). Der `generate()`-Wächter prüft im Nicht-builtin-Zweig zusätzlich `settings.engine !== "comfy" || state.workflow.kind === "ok"`, und `makeComfyClient()` wirft bei nicht-`ok`-Workflow, statt einen leeren Graphen zu senden.
  **Zwei Stellen sind bewusst offen:** `core/viewmodel.ts::recipeUnchanged` faltet comfy und playground in den Server-Vergleich (`s.server.kind === "ok" && s.server.modelName === p?.model`); `modelName` ist dort `null` (comfy) bzw. `s.server.kind` bleibt `"unconfigured"` (playground), der Vergleich schlägt also fehl und `generateEnabled` sperrt ein unverändertes Rezept nie. Ein UI-Komfortverlust, kein Datenfehler (die Notiz bleibt ehrlich). Und die initiale `state.engine`-Zuweisung im `onload` (`settings.engine === "builtin" ? "gpu-checking" : "not-downloaded"`) schickt comfy und playground in den Server-Zweig mit einem Engine-Zustand, den dort niemand liest; wer den Engine-Zustand je modusübergreifend liest, sieht hier zuerst hin.
- **Der Kurzbefehl schreibt die Bilddatei direkt in den Vault (Spec `shortcuts-bridge`,
  `expectFile`) — die normale Panel-Pipeline schreibt danach TROTZDEM noch einmal.**
  `PlaygroundBackend.generate()` (`src/obsidian/playground-backend.ts`) liest die vom
  Kurzbefehl gefundene Datei zurueck, base64-kodiert sie (der `ImageBackend`-Vertrag
  verlangt genau das, wie bei den anderen drei Backends) und LOESCHT die Rohdatei danach
  (`fileManager.trashFile`) — sonst laege ein Duplikat im Vault: die Panel-Pipeline
  schreibt das zurueckgegebene Base64-Bild ohnehin noch einmal an den ueblichen Zielpfad
  (`resolveImagePath()`, korrekte Namensgebung/Dedup). Der Zielordner fuer `expectFile` ist
  bewusst `settings.outputFolder` — dieselbe Ablage wie der Rest des Plugins, kein eigenes
  Zielordner-Setting (Auftrag Welle 13: „bestehende Attachment-Logik nutzen").
- **Endpunkte koennen seit 0.15.0 vom LLM Endpoint Manager kommen — zwei ROLLEN an einem
  Manager, nicht zwei Settings-Felder (Entscheidung Johannes 2026-09-17, Welle 7).**
  `src/core/resolve-endpoint.ts::resolveImageEndpoint(role, choice, localEndpoint, manager,
  ping)` loest fuer `role` ("server" | "comfy") GENAU EINEN Endpunkt der Capability "image"
  auf. **Ohne Manager aendert sich NICHTS:** `main.ts::resolveEndpointFor()` gibt dann
  `settings.endpoint.trim() || null` direkt zurueck, ungepingt — ein Ping hier haette eine
  Generierung verhindert, die heute (ohne geklickten „Verbindung testen"-Knopf) trotzdem
  funktioniert. **Mit Manager entscheidet der Kit-Vertrag `resolveEndpointSource` ALLEIN,
  OHNE stillen Ruckfall** auf das geteilte `endpoint`-Feld (dieselbe Regel wie
  yijing-oracle/lingotuner: eine Fehlermeldung soll auf die Manager-Einstellungen zeigen).
  `checkServer()`, `runGeneration()` (Backend-Bau + `ProgressPoller`) und `makeComfyClient()`
  teilen sich EINE Aufloesung pro Lauf/Check — kein zweiter Manager-Zugriff je Baustein.
  ⚠️ **Der Manager filtert die angebotene Liste NICHT nach Provider** (a1111 vs. comfy):
  `buildEndpointSourceSection()` zeigt in BEIDEN Rollen dieselben Capability-"image"-Eintraege,
  die Trennung ist reine Nutzerwahl (zwei unabhaengige `EndpointChoice`, kein Filter). Wer
  einen Draw-Things-Endpunkt versehentlich in der Comfy-Rolle waehlt, bekommt keinen Fehler
  beim Waehlen — erst der naechste Verbindungstest/Lauf zeigt es.
  **Geschichte, seit der Pin-Hebung `f5dda87` (2026-10-25) entfallen:** Vendoring lief bis Welle 12 EINZELN, außerhalb von `tools/sync-kit.sh` (Rahmen-Regel 2 der Welle-7-Auftragsnote: das damalige Skript pinnte eine gemeinsame Ref für alle neun gelisteten Module und hätte sie beim Aufnehmen dieser vier Dateien auf 0.39.0 gehoben). Von Welle 12 (2026-09-27, zentrales `kit-sync`) bis `f5dda87` trug `tools/kit-sync.json` Einzelpins: für `src/vendor/kit/endpoint-source.ts` und `src/vendor/kit-obsidian/{endpoint-source,model-picker}.ts` je `{ "name": …, "ref": "0.39.0" }` (obsidian-kit), für `src/vendor/kit/{endpoint_config,model-choice}.ts` die Quelle `code-kit@0.6.0`; beide `VENDOR.json` listeten die Abweichung inline im `vendored`-Schlüssel (`datei.ts (quelle@version, sha)`). Heute gibt es einen Pin je Quelle (obsidian-kit `0.69.1`, code-kit `0.36.0`). Re-vendor gegen einen neuen Tag: `ref` in `tools/kit-sync.json` anheben, `node ../tools/kit-sync/kit-sync.mjs` laufen lassen.
