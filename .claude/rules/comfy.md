---
paths:
  - "src/core/comfy/**"
  - "src/obsidian/workflow-picker.ts"
  - "scripts/mock-comfy.mjs"
---

# ComfyUI-Backend

Gotchas zum ComfyUI-Backend: Workflow-Abweisung, Fork von `workflow.ts` und `client.ts` gegenüber `yijing-oracle`, Ergebniskanal `/history` (`src/core/comfy/`).

- **Ein ComfyUI-Workflow ohne setzbare Steps oder Bildmasse wird ABGEWIESEN, nicht mit
  Luecken uebernommen — und der Grund ist die Ergebnis-Notiz, nicht Vorsicht um ihrer
  selbst willen.** `inspectWorkflow()` (`src/core/comfy/workflow.ts`) prueft, bevor sie
  `ok: true` liefert, ob der gefundene Sampler ein `steps`-Feld hat und der aufgeloeste
  Latent-Node `width`/`height` traegt; fehlt eines, kommt `no-steps-field` bzw.
  `no-size-fields` statt eines Slot-Objekts mit `null`-Luecken zurueck. Grund: `GenParams`
  hat keinen Null-Fall fuer Steps oder Groesse — es gibt keinen ehrlichen Eintrag fuer „das
  Plugin hat den Wert nicht bestimmt", nur einen erfundenen. Ein Fallback (z. B. „dann
  nimm einen Default-Wert und schreib ihn in die Notiz") waere die Keine-Attrappen-Linie an
  genau der Stelle gebrochen, die sie am staerksten schuetzt: die Notiz behauptete einen
  Wert, den der Workflow gar nicht kennt. Wer hier bei einem kuenftigen Umbau eine
  Kulanzregel einbauen will ("wenn kein Steps-Feld da ist, nimm halt 20"), baut den Fehler
  bewusst wieder ein — die Abweisung ist die Spec-Entscheidung (Spec §4), keine
  uebertriebene Strenge, die man sich sparen koennte.
- **`src/core/comfy/workflow.ts` ist KEIN Vendoring mehr, sondern ein FORK von
  `yijing-oracle` mit einer benannten inhaltlichen Abweichung — `client.ts` dagegen liegt
  nahe am Original.** Der Herkunftsstempel in Zeile 1 deklariert beide Male die Uebernahme,
  nicht die Abweichung; wer die Dateien neu zieht und nur den Stempel liest, ueberschreibt
  in `workflow.ts` eine Zusage, die dieses Repo gegeben hat. Der Unterschied zwischen den
  beiden Dateien ist der Punkt dieses Eintrags:
  - **`client.ts`:** technische Anpassungen an diesen Baum, keine Verhaltensaenderung.
    Non-null-Assertions traegt die Datei ⚠️ **keine** — eine frueher hier stehende Fassung
    behauptete das fuer beide Module und war fuer `client.ts` gemessen falsch. Eigene
    Abweichung ist dagegen der gefangene `/history`-Poll in `waitForImage` (I1,
    Branch-Abschlussreview 2026-09-06): ein geworfener Poll beendet den Lauf hier nicht.
    **Zweite eigene Abweichung seit 2026-09-06: `generate` und `waitForImage` kennen ein
    `AbortSignal`** (Provider-API `signal`). Ein Re-Sync aus `yijing-oracle` entfernt sie —
    und damit die halbe Zusage des Vertrags fuer den comfy-Modus.
    **Dritte eigene Abweichung seit Welle 24 (2026-10-18): der Fortschritts-Socket.** `ComfyTransport.openProgress` (optional) und `ComfyClient.openProgressSocket` öffnen `/ws?clientId=…` VOR dem POST (gleiche `client_id`), `core/comfy/progress.ts` liest nur `progress`-Nachrichten des eigenen `prompt_id`, der Transport ist das Kit-Modul `text-socket` (`openTextSocket`, obsidian-kit 0.63.1, einzeln gepinnt in `tools/kit-sync.json`; Herkunft war dieses Plugin, das Bibliothek-Gate hat es ins Kit verlegt). Der Socket liefert nur den Balken, der Ergebnisweg bleibt `/history`; öffnet er sich nicht (ComfyUI 0.30.0 wies Obsidians Origin mit 403 ab), zählt die Statuszeile Sekunden wie vorher. Gemessen 2026-10-18: Der Handshake aus dem Renderer gegen ein echtes ComfyUI 0.37 öffnet, der Mock-Lauf (Smoke-Punkt 47) liefert 25/50/75/100 %. Ein Re-Sync aus `yijing-oracle` entfernt auch das.
  - **`workflow.ts`:** vier zusammenhaengende inhaltliche Aenderungen, die zusammen die
    Keine-Attrappen-Zusage fuer Steps und Groesse TRAGEN — (1) `WorkflowSlots.stepsField` ist
    nicht mehr nullable, (2) das Feld `workflowSteps` ist neu (Startwert des Reglers), (3)
    die Fehlerausgaenge `no-steps-field` und `no-size-fields` samt ihrer Pruefungen in
    `inspectWorkflow` sind neu, (4) `patchWorkflow` schreibt Steps deshalb unbedingt statt
    bedingt. Wer diese Datei neu zieht und nur „die `!` wieder einsetzen" abarbeitet, hat
    die ganze Abweisungsregel entfernt — und das Plugin schriebe wieder erfundene Werte in
    die Ergebnis-Notiz (Begruendung im Eintrag „Ein ComfyUI-Workflow ohne setzbare Steps
    oder Bildmasse wird ABGEWIESEN" weiter oben).
  Non-null-Assertions in `workflow.ts` (`noUncheckedIndexedAccess` ist hier `true`, im
  Original nicht) sind daneben die kleinere Sorte Abweichung: an jeder Stelle entweder INTERN
  bewiesen (ein Guard schliesst `undefined` vorher aus, z. B. `candidates[0]!` nach
  ausgeschlossenem `length > 1`) oder EXTERN bedingt und mit Doc-Kommentar versehen (z. B.
  `out[slots.positive]!` in `patchWorkflow`, sicher nur wenn `slots` aus `inspectWorkflow()`
  desselben Graphen stammt). **Ein Re-Sync ist damit keine Kopie, sondern ein Merge** — die
  vier Punkte oben gehoeren danach wieder drin, nicht nur die Assertionen.
- **`/history` ist ComfyUIs ERGEBNISkanal, nicht sein Fortschritt — ein geworfener Poll darf
  den Lauf nicht beenden.** `comfyTransport().getJson` faehrt bewusst mit kurzem Zeitlimit
  (3 s, im Sekundentakt gepollt) und `httpGetJson` WIRFT beim Ablauf; `waitForImage` faengt
  das und pollt weiter, die Deadline der Schleife ist die Notbremse. Ohne das Fangen beendete
  ein einziger langsamer Poll `generate()`, waehrend das Bild auf dem Server fertig war —
  ComfyUI stallt seinen Loop regelmaessig (Modell-Laden beim ersten Lauf, VAE-Decode grosser
  Bilder). Dieselbe Doktrin wie beim A1111-Fortschritt („Timeout und 5xx sind voruebergehend
  und pollen weiter"), und derselbe Grund, warum der kurze Timeout hier bleiben DARF: er ist
  nur zulaessig, solange das try/catch daneben steht. Die Gesamtfrist setzt der Wirt
  (`makeComfyClient`, 30 min) auf dieselbe Groessenordnung wie den A1111-Weg — der
  Client-Default von 10 min laesst einen Lauf mit Upscaler-Kette an einer Grenze scheitern,
  die in keinem Setting steht (I1, Branch-Abschlussreview 2026-09-06).
