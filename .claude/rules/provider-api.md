---
paths:
  - "src/core/plugin-api.ts"
  - "src/core/params.ts"
  - "src/core/note.ts"
  - "src/core/txt2img.ts"
  - "src/core/settings.ts"
  - "src/core/filename.ts"
  - "src/core/history.ts"
  - "src/vendor/kit/image-gen-provider.ts"
---

# Provider-API und Härtung

Gotchas zur öffentlichen Plugin-API (`apiVersion` 1, `status`/`generate`/`save`/`recheck`, `generateImage`) und zur einen Härtung der Parameter (`src/core/plugin-api.ts`, `params.ts`). Die Download-Zusage („ohne Klick fließt kein Byte“) steht im Kern der `AGENTS.md`.

- **`recheck()` ist im builtin-Modus ein NO-OP — und das ist die Zusage, nicht die Luecke.**
  `status()` ist per Vertrag netzfrei und synchron und kann deshalb einen veralteten
  `unreachable`-Zustand nicht heilen; `recheck()` (0.10.0, additiv, `apiVersion` bleibt 1) macht
  GENAU EINEN Netzaufruf und liefert den frischen Stand. Im builtin-Modus unterbleibt der Aufruf,
  weil es dort keinen entfernten Zustand gibt, der sich hinter unserem Ruecken aendern koennte —
  ein „Neupruefen", das nichts prueft, waere dieselbe Attrappe wie ein CFG-Regler ohne Wirkung.
  Die Modus-Entscheidung sitzt in der FASSADE (`src/core/plugin-api.ts`), nicht im Dep: nur dort
  ist sie ohne Obsidian testbar (`tests/plugin-api.test.ts` zaehlt die Netzaufrufe am Fake, was
  am Wirt gar nicht ginge). Der Server-Zweig wird am Wirt von GUI-Smoke-Punkt 18e gemessen.
  ⚠️ `status()` wird dadurch NICHT asynchron — wer die Bequemlichkeit sucht und `recheck()` in
  `status()` zieht, bricht die Zusage „synchron und netzfrei", auf die jeder Konsument baut.
- **Die Provider-API laedt NIE nach.** `generate()` gibt bei fehlenden Assets
  `model-not-downloaded` zurueck. „Ohne Klick fliesst kein Byte" ist eine Zusage an den
  Nutzer — ein Fremdplugin darf sie nicht umgehen.
- **`isBusy()` deckt beide Wege.** Panel-Laeufe UND API-Laeufe; sonst zieht ein
  Moduswechsel die GPU-Sessions unter einem Fremdlauf weg.
- **`cfg: null` heisst „vom Backend bestimmt", `cfg: 1` heisst „keine Guidance" — die zwei
  nicht zusammenlegen.** Die Haertung verzweigt fuer `cfg` ueber `ctx.mode`, nicht ueber
  `caps.cfg`: builtin traegt eine echte 1 (SD-Turbo ist destilliert), comfy traegt `null`
  (`patchWorkflow` fasst das CFG-Feld des Samplers nicht an, der Nutzer-Workflow entscheidet),
  server traegt den gesetzten Wert. `note.ts` laesst das Feld bei `null` weg — wie `denoising`
  und `negative_prompt`. Vorher stand in JEDER ComfyUI-Notiz `cfg: 1`, ein Wert, der nie galt
  (C1, Branch-Abschlussreview 2026-09-06). Das ist dieselbe Erfindung, gegen die die
  Steps-Abweisung (`.claude/rules/comfy.md`) steht, nur in die andere Richtung entschieden — wer `caps.cfg === false`
  wieder als „also 1" liest, baut sie zurueck. Zwei Folgestellen haengen daran: die
  Historien-Migration muss FEHLEND (Alt-Eintrag → 7) von ausdruecklich `null` unterscheiden
  (`typeof null` ist "object"), und `applyRecipe` laesst den Regler bei `null` stehen, statt
  ihn ueber die Klemme auf `CFG.min` zu reissen. `apiVersion` bleibt trotzdem 1: `ApiParams`
  ist per Vertrag „was die Haertung still ueberschrieben hat", und im comfy-Modus hat sie
  nichts ueberschrieben.
  **Seit 2026-09-06 ist das LIVE gedeckt, nicht nur unit-getestet: GUI-Smoke-Punkt 39** misst
  am laufenden Wirt, dass die comfy-Notiz keine `cfg:`-Zeile traegt — und prueft davor
  `seed:`/`model:`, weil ein Punkt auf die ABWESENHEIT einer Zeile sonst gerade dann gruen
  waere, wenn die Notiz gar nicht geschrieben wurde. Gegenprobe gefahren (comfy-Zweig auf `1`
  zurueckgestellt → rot mit „Notiz behauptet cfg: 1", waehrend Punkt 38 gruen blieb).
- **`signal` ist im builtin-Modus ein ECHTER Abbruch und in den HTTP-Modi nur ein Ende der
  WARTEZEIT — und diese Asymmetrie ist die Zusage, nicht ihr Mangel.** Die eingebaute Engine
  prueft zwischen zwei Diffusionsschritten (`runDiffusion`, `throwIfAborted`) und laesst den
  VAE-Decoder gar nicht erst laufen; `A1111Client` und `ComfyClient` koennen einen laufenden
  Aufruf nicht zuruecknehmen (`requestUrl` kennt weder Abort noch Timeout) und pruefen
  deshalb VOR dem Absenden bzw. zwischen zwei Polls. Der Server rechnet fertig.
  **Nicht „vereinheitlichen"**: ein `signal`, das in beiden Modi dasselbe verspricht, muesste
  im Server-Modus luegen — dieselbe Attrappe wie ein CFG-Regler ohne Wirkung. Der Nutzen im
  Server-Modus ist trotzdem echt und der Grund fuer das Feature: bei einem Stapellauf laeuft
  das begonnene Bild aus, das NAECHSTE startet nicht mehr.
  ⚠️ **`tsc` verengt `req.signal?.aborted` nach der ersten Pruefung auf `false | undefined`**
  und meldet die zweite (nach `await deps.run(...)`) als TS2367 — der Compiler haette hier
  also die noetige Pruefung wegargumentiert, weil er nicht weiss, dass das Feld genau
  waehrend des `await` umspringt. Deshalb steht in `plugin-api.ts` eine kleine Funktion
  (`abgebrochen()`) statt zweier direkter Vergleiche: ein Aufruf sagt „neu lesen". Wer sie
  wieder inline schreibt, bekommt den Typfehler zurueck — oder, schlimmer, loescht die
  zweite Pruefung, und dann meldet ein Abbruch waehrend des Laufs `failed` mit roher
  Backend-Meldung.
  ⚠️ **`reason: "aborted"` steht bewusst NICHT in `ApiFailure`:** den Union teilt sich
  `generate()` mit `status()`, und ein Status kann nicht „abgebrochen" sein — dieselbe
  Trennung wie bei `failed`. `apiVersion` bleibt 1: wer kein `signal` schickt, sieht den Wert
  nie.
  ⓘ Der Abbruch waehrend des Laufs wird am ZUSTAND des Signals erkannt, nie am Meldungstext
  des Backends — ein Textvergleich braeche bei jeder Uebersetzung und bei jedem Backend, das
  anders formuliert. Die Gegenprobe dazu ist ein eigener Test („meldet einen ECHTEN
  Fehlschlag weiter als failed, auch wenn ein Signal mitlaeuft"): ohne ihn verschluckte ein
  gesetztes `signal` jede Backend-Meldung.
- **Die Haertung hat genau eine Quelle** (`src/core/params.ts`, `hardenParams`). Zwei
  Haertungen bedeuten, dass die API andere Werte meldet, als das Panel in die Notiz schreibt.
- **`save()` prueft `created` und `seed`, bevor daraus ein Vault-Pfad wird**
  (`unusableParams` in `src/core/plugin-api.ts`). Sieht redundant aus, weil `ApiParams` beide
  typisiert — TypeScript schuetzt aber keinen JS-Aufrufer, und `buildImageFilename`
  interpoliert beide direkt in den Dateinamen (`lig-NaNNaNNaN-NaNNaNNaN-s7.png` aus einem
  kaputten `created`). Die Abweisung faellt VOR dem Write und als `write-failed`, damit die
  Fehler-Union von v1 unveraendert bleibt.
- **Ein Fallback-Argument, das einen injizierten Callback ruft, gehoert lazy.**
  `finite(value, fallback)` in `src/core/params.ts` nimmt deshalb `number | (() => number)`:
  `finite(input.seed, ctx.randomSeed())` haette `randomSeed()` bei JEDER Haertung gezogen, auch
  mit brauchbarem Seed. Konstante Fallbacks bleiben Werte — kein Thunk-Rauschen. Die
  Gegenprobe ist ein Test, der die Ziehungen ZAEHLT; der Rueckgabewert stimmte immer.
- **`ApiParams.created` vs. `GenParams.date`** ist Absicht, kein Versehen: der Vertrag darf
  nicht mitwandern, wenn intern umbenannt wird.
- **Der Erstellungs-Zeitstempel wird AM ANFANG gesetzt, nicht am Ende.** `GenParams.date`
  traegt den Moment der ANFRAGE, nicht der Fertigstellung — die Haertung ist die einzige Quelle
  fuer Panel und API, und eine Doppel-Zeitstempel-Setzung wuerde die zwei berichten
  unterschiedliche Zeiten, im Server-Modus Sekunden, im builtin-Modus Minuten. Folge: eine
  Notiz traegt die Anfrage-Zeit statt der Fertig-Zeit; die Datei traegt diese Zeit im Namen.
- **`generateImage()` (Kit-Vertrag `image-gen-provider`) ist ein ZUSAETZLICHER Export auf
  demselben API-Objekt, keine zweite Fassade.** Die bestehende Provider-API
  (`IMAGE_GENERATION_API_VERSION` bleibt 1, `status/generate/save/recheck`) ist unveraendert;
  `ImageGenerationApi extends ImageGenProviderApi` traegt zusaetzlich `version` (Kit-eigenes
  Versionsfeld, ABSICHTLICH ein anderes Feld als `apiVersion` — die beiden Vertraege koennen
  unabhaengig voneinander wachsen) und `generateImage(prompt, opts)`. Schreibt ueber eine
  NEUE `ApiDeps.saveToFolder(folder, params, base64)` in einen vom AUFRUFER benannten Ordner
  (`opts.targetFolder`) — bewusst NICHT ueber `save()`/`resolveImagePath()`, die immer
  `settings.outputFolder` (die Einstellung DIESES Nutzers) verwenden: ein Fremdplugin wie
  Koda soll seine Bilder nicht dorthin mischen.
