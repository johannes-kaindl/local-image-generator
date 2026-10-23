---
paths:
  - "src/obsidian/png.ts"
  - "src/obsidian/image-picker.ts"
  - "src/core/pipeline/scheduler.ts"
  - "src/core/engine.ts"
  - "src/core/engine-sdxl.ts"
  - "src/obsidian/generate-panel.ts"
  - "src/core/viewmodel.ts"
  - "src/vendor/kit/crop.ts"
  - "src/core/params.ts"
  - "src/core/settings.ts"
  - "src/core/plugin-api.ts"
  - "src/core/txt2img.ts"
  - "src/obsidian/local-engine.ts"
---

# img2img — Vorlage, Denoise, Ausschnitt

Gotchas zu img2img in beiden Backends: Vorlage als Pfad und als Bytes, Denoise-Regler, Einstiegspunkt im Zeitplan, Ausschnitt (`initCrop`).

- **Das Ausgangsbild (img2img) ist KEIN Rezept-Parameter.** `GenParams.initImage` ist ein
  VAULT-PFAD, `ImageRequest.initImageData` sind die BASE64-Bytes — bewusst verschiedene
  Namen. Grund fuer die Trennung: `GenParams` wandert in `settings.history`, also in
  `data.json`, das bei jedem `saveSettings()` komplett geschrieben wird; ein eingebettetes
  PNG waere dort ein Megabyte pro Eintrag. Grund fuer die verschiedenen NAMEN: `runGeneration`
  baut den Auftrag als `{ ...params, initImageData }`, und bei gleichem Namen haette ein
  vergessener Override still einen Pfad als Bilddaten an den Server geschickt. Als
  Pflichtfeld mit eigenem Namen faengt das der Typecheck.
- **Ob img2img gerechnet wurde, sagt `denoising` — nicht `initImage`.** Der Pfad darf null
  sein, waehrend sehr wohl ein Bild mitlaeuft: ein Fremdplugin schickt ueber die API Bytes
  ohne Vault-Datei. Deshalb ist auch `HardenInput.initImage` ein `{ ref: string | null }`:
  die ANWESENHEIT des Objekts ist das Signal, `ref` nur die Herkunft. Haengte das Signal am
  Pfad, verlore jeder API-Lauf sein `denoising` und die Notiz meldete einen img2img-Lauf als
  txt2img. Aus demselben Grund darf `ApiRequest` NIE ungeprueft als `HardenInput`
  durchgereicht werden (`deps.harden(req)`) — dort heisst `initImage` Base64.
- **Der Denoise-Regler hat ZWEI Sichtbarkeitsbedingungen, nicht eine.**
  `controls.initImage` = kann das Backend es, `controls.denoising` = gibt es eine
  Vorlage zu aendern. Seit 0.11 ist die erste Bedingung in BEIDEN Modi erfuellt (builtin kann
  img2img) — die Vorlagen-Zeile ist immer sichtbar, und `.lig-init-row`/`.lig-init-from-result`
  sind aus `MODUS_REGLER` des Smoke-Treibers RAUS (dort gefuehrt, meldete Punkt 17 die gewollte
  Sichtbarkeit als Defekt; gemessen 2026-08-31). Ein Regler ohne Vorlage bewirkt weiter nichts
  und waere dieselbe Attrappe wie ein CFG-Regler ohne CFG. Deshalb steht `.lig-denoise` auch
  NICHT in `MODUS_REGLER`: dort gefuehrt, wuerde Punkt 17 die zweite Stufe als Defekt melden.
- **Ausschnitt der Vorlage (`initCrop`, seit Welle 24, Teil C der img2img-Steuerung).** Normalisiert auf [0,1] relativ zum Original (`src/vendor/kit/crop.ts`, `Crop`), quadratisch in BILDPUNKTEN, damit dasselbe Rezept für 512² und 1024² denselben Bereich meint. `null` heißt „nicht gewählt“ und behält das alte Verhalten bit-genau: builtin rechnet das zentrierte Quadrat (`cropSourceRect(…, null)` rundet bewusst nicht, Smoke-Punkte 26/27 messen daran), der Server bekommt die Datei unverändert. **Mit** Ausschnitt rechnet builtin ihn in `decodeInitImage(base64, size, crop)`, und für die HTTP-Backends schneidet `runGeneration` vor dem Absenden zu (`cropImageToBase64`, PNG in Originalauflösung) — `ImageRequest.initImageData` ist dort schon der Ausschnitt. Der Ausschnitt gehört zur Vorlage: `setInitImage(file, crop = null)` setzt ihn zurück, nur `restoreRecipe` bringt ihn aus der Historie mit; ohne Vorlage verwirft die Härtung ihn (wie `denoising`), ungültige Werte aus einem Fremdplugin werden `null` (`parseCrop`, wirft nie). Er steht als `init_crop: x=… y=… w=… h=…` in der Ergebnis-Notiz und als `ApiParams.initCrop` im Vertrag (additiv, `apiVersion` bleibt 1). Gemessen von Punkt 48 mit echten Mausereignissen (Ziehen mit Haltedauer, Gegenprobe: ohne Vorschnitt sieht der Mock 400×200 statt 170×170).
- **Der Denoise-Einstiegspunkt wird INTERPOLIERT, und die Formel sitzt im Scheduler.**
  `denoiseEntry(steps, denoising, sigmas, timesteps)` (`src/core/pipeline/scheduler.ts`)
  liefert Einstiegsindex, Sigma und Timestep; beide Engines rufen sie und **ersetzen damit
  den Eintrag in der Folge**. Das Ersetzen ist der Punkt: `schedulerStep` liest sein
  Start-Sigma selbst aus dem Array, ein interpolierter Wert nur im Init-Latent verpufft
  und ergibt ein leise falsches Bild — kein Fehler, nur ein schlechteres Ergebnis.
  Der Timestep wird mitinterpoliert, sonst bekommt das UNet die Konditionierung des Ankers.
  Die Haertung (`hardenParams`) reicht `denoising` unveraendert durch und rechnet nichts.
  *Bis 0.11 war es umgekehrt: die Haertung rasterte auf `steps` Positionen. Gemessen
  2026-09-05 (84 Laeufe) uebersprang der Sprung 0.5 → 0.75 bei 4 Steps genau das Optimum.*
- **SD-Turbo ist im Denoise-Bereich NICHT monoton, und das ist kein Defekt — wer es fuer
  einen haelt, „repariert" die Interpolation kaputt.** Gemessen am Wirt (RMSE zur Vorlage,
  gleicher Seed und Prompt, steps 4): SD-Turbo 14.48 / **23.08** / 21.42 bei denoising
  0.5 / 0.625 / 0.75 — der mittlere Wert liegt WEITER weg als der hoechste. SDXL-Turbo ist
  im selben Lauf monoton (19.13 / 34.89 / 36.59).
  Die Ursache steht in `denoiseEntry`: t = (1−d)·steps, also 0.5 → t=2.0 · 0.625 → t=1.5 ·
  0.75 → t=1.0. **Von den dreien ist nur 0.625 interpoliert** (`frac` 0.5), die anderen
  beiden sind exakte Anker (`frac` 0) — und SD-Turbo ist auf genau vier Timesteps
  destilliert, faehrt bei einem Zwischenwert also off-distribution. Der eine interpolierte
  Punkt ist der eine, der aus der Reihe faellt.
  ⚠️ **Das galt vor 0.12 genauso; die Rasterung machte es nur unerreichbar** — der Umbau
  verursacht es nicht, er macht es sichtbar. Deshalb ist es auch KEIN Smoke-Punkt geworden
  (Entscheidung 2026-09-06): ein Pruefpunkt darauf bewachte eine Eigenschaft des MODELLS,
  die dieses Repo nicht kontrolliert, und wuerde bei einer neuen Modellstufe rot, ohne dass
  etwas kaputt waere. Punkt 26/27 messen ohnehin die Unterscheidbarkeit der Zwischenstufe —
  bewusst NICHT die Reihenfolge, genau deswegen. Der Erklaerungsbedarf liegt beim Nutzer und
  steht in beiden READMEs.
- **„Speichern & als Vorlage" speichert wirklich — das ist der Punkt.** Der Knopf legt das
  Ergebnis erst im Vault ab und macht dann dessen Pfad zur Vorlage. Ohne das entstuende eine
  Vorlage ohne benennbare Herkunft, und die Ergebnis-Notiz muesste „Vorlage: das vorige
  Ergebnis" behaupten. Legt nur das Bild an, nie eine Notiz — `createMode` gilt fuer
  Ergebnisse, nicht fuer Zwischenschritte.
